/**
 * LLM Runner AIO - Server Manager
 * 
 * PyQt6 tabs/servers.py'nin Electron karşılığı
 * - 4 Sunucu yönetimi (SearXNG, OpenWebUI, llama.cpp, Vane)
 * - child_process.spawn ile process başlatma/durdurma
 * - tree-kill ile force kill fallback
 * - Port kontrolü
 * - Health check polling + auto-restart
 * - Bind address seçimi (0.0.0.0 / 127.0.0.1)
 * - Process tree kill (leaf-first termination)
 * - Dynamic BAT generation for llama.cpp
 */

const { spawn, execSync, exec } = require('child_process');
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');
const treeKill = require('tree-kill');

// ============================================
// Utility: Parse INI file (no external dependency)
// ============================================
function parseINI(content) {
    const result = {};
    let currentSection = '';
    
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
        
        const sectionMatch = trimmed.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1];
            if (!result[currentSection]) result[currentSection] = {};
            continue;
        }
        
        const kvMatch = trimmed.match(/^(.+?)=(.*)$/);
        if (kvMatch && currentSection) {
            const key = kvMatch[1].trim();
            let value = kvMatch[2].trim().replace(/^['"]|['"]$/g, '');
            result[currentSection][key] = value;
        }
    }
    
    return result;
}

function stringifyINI(obj) {
    let output = '';
    
    for (const [section, keys] of Object.entries(obj)) {
        output += `[${section}]\n`;
        for (const [key, value] of Object.entries(keys)) {
            output += `${key} = ${value}\n`;
        }
        output += '\n';
    }
    
    return output;
}

// ============================================
// Utility: Update YAML settings (simple regex-based)
// PyQt6'da yaml.dump() kullanılır
// ============================================
function updateSettingsYML(settingsPath, updates) {
    try {
        if (!fs.existsSync(settingsPath)) {
            return { success: false, error: 'settings.yml not found' };
        }
        
        let content = fs.readFileSync(settingsPath, 'utf8');
        
        for (const [key, value] of Object.entries(updates)) {
            const lines = content.split('\n');
            let updated = false;
            
            // Try to find and replace existing key
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (trimmed.startsWith(key + ':')) {
                    lines[i] = `    ${key}: ${value}`;
                    updated = true;
                    break;
                }
            }
            
            // Add new key under server section if not found
            if (!updated) {
                const serverIndex = lines.findIndex(l => l.trim().startsWith('server:'));
                if (serverIndex >= 0) {
                    lines.splice(serverIndex + 1, 0, `    ${key}: ${value}`);
                } else {
                    // Add server section at end
                    lines.push('server:', `    ${key}: ${value}`);
                }
            }
        }
        
        fs.writeFileSync(settingsPath, lines.join('\n'), 'utf8');
        return { success: true };
    } catch (err) {
        console.error('[YAML] Failed to update settings:', err.message);
        return { success: false, error: err.message };
    }
}

class ServerManager extends EventEmitter {
    constructor(config = {}) {
        super();
        
        // Running server'ların map'i
        this.servers = new Map(); // serverType → { child, pid, port, host }
        
        // Health check interval
        this.healthCheckInterval = null;
        this.healthCheckMs = config.healthCheckInterval || 60000; // 60 saniye
        
        // Project root path
        this.projectRoot = process.resourcesPath || __dirname;
        
        // Supported servers
        this.supportedServers = ['searxng', 'openwebui', 'llamacpp', 'vane'];
    }
    
    // ============================================
    // Port Check
    // ============================================
    
    /**
     * Port'un meşgul olup olmadığını kontrol et
     * PyQt6'da: is_port_in_use() utility (socket.bind denemesi)
     * @param {number} port - Kontrol edilecek port
     * @param {string} host - Host (varsayılan: 127.0.0.1)
     * @returns {Promise<boolean>} Meşgul mü?
     */
    async isPortInUse(port, host = '127.0.0.1') {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000);
            
            socket.connect(port, host, () => {
                socket.destroy();
                resolve(true);
            });
            
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });
        });
    }
    
    // ============================================
    // Start Servers — PyQt6 Worker Karşılıklari
    // ============================================
    
    /**
     * SearXNG sunucusunu başlat
     * PyQt6'da: SearXNGWorker.start_server_internal()
     * - settings.yml güncelleme (bind_address, port)
     * - PYTHONPATH injection
     * - python -m searx.webapp
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @returns {Promise<Object>} Sonuç
     */
    async startSearXNG(port = 8080, host = '0.0.0.0') {
        const baseDir = path.join(this.projectRoot, 'searxng');
        const venvPython = path.join(this.projectRoot, 'venv', 'Scripts', 'python.exe');
        const settingsPath = path.join(baseDir, 'searx-data', 'settings.yml');
        
        // venv kontrolü
        if (!fs.existsSync(venvPython)) {
            return { success: false, error: `venv\\Scripts\\python.exe not found: ${venvPython}` };
        }
        
        // settings.yml güncelleme (PyQt6'daki gibi)
        try {
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
            
            const yamlUpdate = updateSettingsYML(settingsPath, {
                'port': String(port),
                'bind_address': host
            });
            
            if (yamlUpdate.success) {
                console.log(`[SEARXNG] Port ${port}, Bind: ${host} written to settings.yml`);
            } else {
                console.warn(`[SEARXNG] Could not update settings.yml: ${yamlUpdate.error}`);
            }
        } catch (e) {
            console.warn(`[SEARXNG] Settings update failed: ${e.message}`);
        }
        
        // Environment variables
        const env = {
            ...process.env,
            SEARXNG_SETTINGS_PATH: settingsPath,
            PYTHONPATH: baseDir + ';' + (process.env.PYTHONPATH || '')
        };
        
        // Port kontrolü
        const inUse = await this.isPortInUse(port);
        if (inUse) {
            return { success: false, error: `Port ${port} already in use!` };
        }
        
        // Zaten çalışıyor mu?
        if (this.servers.has('searxng')) {
            return { success: false, error: 'SearXNG is already running' };
        }
        
        try {
            const child = spawn(String(venvPython), ['-m', 'searx.webapp'], {
                cwd: baseDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: env,
                shell: true // Windows'ta python -m için gerekli
            });
            
            this.servers.set('searxng', { child, pid: child.pid, port, host });
            
            child.stdout?.on('data', (data) => {
                const message = data.toString();
                this.emit('log', 'searxng', message);
                console.log(`[SEARXNG] ${message.trim()}`);
            });
            
            child.stderr?.on('data', (data) => {
                const message = data.toString();
                this.emit('error', 'searxng', message);
                console.error(`[SEARXNG ERROR] ${message.trim()}`);
            });
            
            child.on('error', (err) => {
                console.error('[SEARXNG] Spawn error:', err.message);
                this.servers.delete('searxng');
                this.emit('error', 'searxng', `Spawn error: ${err.message}`);
            });
            
            child.on('exit', (code, signal) => {
                console.log(`[SEARXNG] Exited (code: ${code}, signal: ${signal})`);
                this.servers.delete('searxng');
                this.emit('stopped', 'searxng', code, signal);
            });
            
            await this.waitForReady(port, 30000);
            
            return { success: true, pid: child.pid, port };
        } catch (err) {
            console.error('[SEARXNG] Start failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    /**
     * OpenWebUI sunucusunu başlat
     * PyQt6'da: OpenWebUIWorker.start_server_internal()
     * - WEBUI_SECRET_KEY oluşturma (secrets.token_hex(32))
     * - 15+ environment variable ayarlama
     * - delayed import_functions.py execution
     * - uvicorn.run('open_webui.main:app', ...) python -c ile
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @param {number} threads - CPU worker sayısı
     * @returns {Promise<Object>} Sonuç
     */
    async startOpenWebUI(port = 3000, host = '127.0.0.1', threads = 4) {
        const venvDir = path.join(this.projectRoot, 'venv');
        const projectRoot = this.projectRoot;
        const backendDir = path.join(projectRoot, 'openwebui', 'backend');
        const venvPython = path.join(venvDir, 'Scripts', 'python.exe');
        
        // venv kontrolü
        if (!fs.existsSync(venvPython)) {
            return { success: false, error: `venv\\Scripts\\python.exe not found: ${venvPython}` };
        }
        
        // uvicorn kontrolü
        const uvicornPath = path.join(venvDir, 'Scripts', 'uvicorn.exe');
        if (!fs.existsSync(uvicornPath)) {
            return { success: false, error: 'uvicorn.exe not found! Install in venv: pip install uvicorn' };
        }
        
        // WEBUI_SECRET_KEY oluştur/kaydet (PyQt6 secrets.token_hex(32))
        const secretKeyPath = path.join(projectRoot, '.webui_secret_key');
        let secretKey = '';
        if (!fs.existsSync(secretKeyPath)) {
            secretKey = crypto.randomBytes(32).toString('hex');
            fs.writeFileSync(secretKeyPath, secretKey, 'utf8');
        } else {
            secretKey = fs.readFileSync(secretKeyPath, 'utf8').trim();
        }
        
        // Environment variables — PyQt6 ile aynı 15+ değişken
        const env = {
            ...process.env,
            PORT: String(port),
            HOST: host,
            UVICORN_WORKERS: String(threads),
            DATABASE_URL: 'sqlite:///openwebui.db',
            WEBUI_SECRET_KEY: secretKey,
            ENABLE_WEB_SEARCH: 'True',
            WEB_SEARCH_ENGINE: 'searxng',
            SEARXNG_QUERY_URL: `http://127.0.0.1:${port}/search?q=<query>`, // Vane portu kullanılabilir
            BYPASS_WEB_SEARCH_EMBEDDING_AND_RETRIEVAL: 'True',
            BYPASS_WEB_SEARCH_WEB_LOADER: 'True',
            OPENAI_API_BASE_URL: 'http://localhost:1234/v1',
            OPENAI_API_KEY: 'sk-no-key-required',
            ENABLE_OLLAMA_API: 'False',
            ENABLE_SIGNUP: 'True',
            ENABLE_LOGIN_FORM: 'True'
        };
        
        // FRONTEND_BUILD_DIR
        const frontendBuildDir = path.join(projectRoot, 'openwebui', 'build');
        if (fs.existsSync(frontendBuildDir)) {
            env.FRONTEND_BUILD_DIR = frontendBuildDir;
        }
        
        // DATA_DIR
        const dataDir = path.join(projectRoot, 'openwebui', 'database');
        fs.mkdirSync(dataDir, { recursive: true });
        env.DATA_DIR = dataDir;
        
        // PYTHONPATH injection
        if (backendDir.exists && fs.existsSync(backendDir)) {
            env.PYTHONPATH = backendDir + ';' + (env.PYTHONPATH || '');
        }
        env.PYTHONHOME = ''; // PYTHONHOME temizle
        
        // Port kontrolü
        const inUse = await this.isPortInUse(port);
        if (inUse) {
            return { success: false, error: `Port ${port} already in use!` };
        }
        
        // Zaten çalışıyor mu?
        if (this.servers.has('openwebui')) {
            return { success: false, error: 'OpenWebUI is already running' };
        }
        
        try {
            // python -c ile uvicorn.run() çağır (PyQt6 ile aynı pattern)
            const cmdStr = `import sys; sys.path.insert(0, r'${backendDir}'); import uvicorn; uvicorn.run('open_webui.main:app', host='${host}', port=${port}, forwarded_allow_ips='*', ws='auto')`;
            
            const child = spawn(String(venvPython), ['-c', cmdStr], {
                cwd: path.join(projectRoot, 'openwebui'),
                stdio: ['pipe', 'pipe', 'pipe'],
                env: env,
                shell: true
            });
            
            this.servers.set('openwebui', { child, pid: child.pid, port, host });
            
            child.stdout?.on('data', (data) => {
                const message = data.toString();
                this.emit('log', 'openwebui', message);
                console.log(`[OPENWEBUI] ${message.trim()}`);
            });
            
            child.stderr?.on('data', (data) => {
                const message = data.toString();
                this.emit('error', 'openwebui', message);
                console.error(`[OPENWEBUI ERROR] ${message.trim()}`);
            });
            
            child.on('error', (err) => {
                console.error('[OPENWEBUI] Spawn error:', err.message);
                this.servers.delete('openwebui');
                this.emit('error', 'openwebui', `Spawn error: ${err.message}`);
            });
            
            child.on('exit', (code, signal) => {
                console.log(`[OPENWEBUI] Exited (code: ${code}, signal: ${signal})`);
                this.servers.delete('openwebui');
                this.emit('stopped', 'openwebui', code, signal);
            });
            
            // Delayed import_functions.py execution (PyQt6'daki gibi 15sn sonra)
            const importFuncsScript = path.join(projectRoot, 'import_functions.py');
            if (fs.existsSync(importFuncsScript)) {
                setTimeout(async () => {
                    try {
                        await new Promise((resolve, reject) => {
                            exec(
                                `"${venvPython}" "${importFuncsScript}"`,
                                { cwd: projectRoot, timeout: 30000, encoding: 'utf8' },
                                (err, stdout, stderr) => {
                                    if (err) {
                                        console.log('[IMPORT] Functions import failed:', err.message);
                                        this.emit('log', 'openwebui', `[IMPORT] Failed: ${err.message}`);
                                    } else {
                                        console.log('[IMPORT] Functions imported successfully');
                                        this.emit('log', 'openwebui', '[IMPORT] Functions imported OK');
                                    }
                                    resolve();
                                }
                            );
                        });
                    } catch (e) {
                        console.log('[IMPORT] Import skipped:', e.message);
                    }
                }, 15000);
            }
            
            await this.waitForReady(port, 30000);
            
            return { success: true, pid: child.pid, port };
        } catch (err) {
            console.error('[OPENWEBUI] Start failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    /**
     * llama.cpp sunucusunu başlat
     * PyQt6'da: LlamaCppWorker.start_server_internal()
     * - Dinamik BAT dosyası oluşturma (INI preset varsa)
     * - --ctx-size parametresi desteği
     * - .bat subprocess ile çalıştırma
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @param {number} ctxSize - Context boyutu (4096, 8192, ...)
     * @param {string} iniPreset - INI dosyası adı
     * @returns {Promise<Object>} Sonuç
     */
    async startLlamaCPP(port = 1234, host = '0.0.0.0', ctxSize = 8192, iniPreset = '') {
        const exePath = path.join(
            this.projectRoot,
            'llama.cpp-cuda13+vulkan',
            'llama-server.exe'
        );
        
        if (!fs.existsSync(exePath)) {
            return { success: false, error: `llama-server.exe not found at ${exePath}` };
        }
        
        // INI preset varsa dinamik BAT oluştur (PyQt6 LlamaCppWorker pattern)
        let cmd, args;
        
        if (iniPreset) {
            // BAT dosyası oluştur
            const baseName = iniPreset.replace('models.ini', '').replace('.ini', '');
            const batName = `start_${baseName}.bat`;
            const batPath = path.join(this.projectRoot, batName);
            
            const batContent = `@echo off
title llama.cpp (${iniPreset})
color 0a

cd /d "%~dp0"
"llama.cpp-cuda13+vulkan\\llama-server.exe" ^
  --host ${host} ^
  --port ${port} ^
  --ctx-size ${ctxSize} ^
  --models-max 1 ^
  --models-preset "${iniPreset}" ^
  --jinja

pause
`;
            
            try {
                fs.writeFileSync(batPath, batContent, 'utf8');
                console.log(`[LLAMA] Bat file created: ${batName}`);
                console.log(`[LLAMA] Port: ${port}, Ctx-size: ${ctxSize}`);
                
                cmd = batName;
                args = [];
                
                // Port kontrolü
                const inUse = await this.isPortInUse(port);
                if (inUse) {
                    return { success: false, error: `Port ${port} already in use!` };
                }
                
                if (this.servers.has('llamacpp')) {
                    return { success: false, error: 'llama.cpp is already running' };
                }
                
                const child = spawn(cmd, args, {
                    cwd: this.projectRoot,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true // .bat için gerekli
                });
                
                this.servers.set('llamacpp', { child, pid: child.pid, port, host });
                
                child.stdout?.on('data', (data) => {
                    const message = data.toString();
                    this.emit('log', 'llamacpp', message);
                    console.log(`[LLAMA] ${message.trim()}`);
                });
                
                child.stderr?.on('data', (data) => {
                    const message = data.toString();
                    this.emit('error', 'llamacpp', message);
                    console.error(`[LLAMA ERROR] ${message.trim()}`);
                });
                
                child.on('error', (err) => {
                    console.error('[LLAMA] Spawn error:', err.message);
                    this.servers.delete('llamacpp');
                    this.emit('error', 'llamacpp', `Spawn error: ${err.message}`);
                });
                
                child.on('exit', (code, signal) => {
                    console.log(`[LLAMA] Exited (code: ${code}, signal: ${signal})`);
                    this.servers.delete('llamacpp');
                    this.emit('stopped', 'llamacpp', code, signal);
                });
                
                return { success: true, pid: child.pid, port };
            } catch (e) {
                console.error('[LLAMA] Bat creation failed:', e.message);
                return { success: false, error: `Bat creation failed: ${e.message}` };
            }
        } else {
            // Direkt exe çalıştırma (INI yoksa)
            args = ['--host', host, '--port', String(port), '--jinja'];
            
            if (ctxSize) {
                args.push('--ctx-size', String(ctxSize));
            }
            
            // Port kontrolü
            const inUse = await this.isPortInUse(port);
            if (inUse) {
                return { success: false, error: `Port ${port} already in use!` };
            }
            
            if (this.servers.has('llamacpp')) {
                return { success: false, error: 'llama.cpp is already running' };
            }
            
            const child = spawn(exePath, args, {
                cwd: path.dirname(exePath),
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            this.servers.set('llamacpp', { child, pid: child.pid, port, host });
            
            child.stdout?.on('data', (data) => {
                const message = data.toString();
                this.emit('log', 'llamacpp', message);
                console.log(`[LLAMA] ${message.trim()}`);
            });
            
            child.stderr?.on('data', (data) => {
                const message = data.toString();
                this.emit('error', 'llamacpp', message);
                console.error(`[LLAMA ERROR] ${message.trim()}`);
            });
            
            child.on('error', (err) => {
                console.error('[LLAMA] Spawn error:', err.message);
                this.servers.delete('llamacpp');
                this.emit('error', 'llamacpp', `Spawn error: ${err.message}`);
            });
            
            child.on('exit', (code, signal) => {
                console.log(`[LLAMA] Exited (code: ${code}, signal: ${signal})`);
                this.servers.delete('llamacpp');
                this.emit('stopped', 'llamacpp', code, signal);
            });
            
            return { success: true, pid: child.pid, port };
        }
    }
    
    /**
     * Vane sunucusunu başlat
     * PyQt6'da: VaneWorker.start_server_internal()
     * - .next klasör temizleme (Turbopack junction fix)
     * - npm run dev pattern
     * - SEARXNG_API_URL env var
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @returns {Promise<Object>} Sonuç
     */
    async startVane(port = 3001, host = '0.0.0.0') {
        const vaneDir = path.join(this.projectRoot, 'Vane');
        const nextDir = path.join(vaneDir, '.next');
        
        // .next klasör temizleme (Turbopack junction hatası önleme)
        if (fs.existsSync(nextDir)) {
            try {
                fs.rmSync(nextDir, { recursive: true, force: true });
                console.log('[VANE] .next directory cleaned (Turbopack junction fix)');
            } catch (e) {
                console.warn(`[VANE] Could not clean .next: ${e.message}`);
            }
        }
        
        // Node.js kontrolü
        const nodeExe = require('child_process').execFileSync('where', ['node'], { encoding: 'utf8' }).trim().split('\n')[0];
        if (!nodeExe || !require('fs').existsSync(nodeExe)) {
            return { success: false, error: 'Node.js not found! Please install Node.js: https://nodejs.org/' };
        }
        
        // Port çakışması kontrolü (3000 OpenWebUI ile)
        if (port === 3000) {
            port = 3001;
            console.log('[VANE] Port 3000 is used by OpenWebUI, switching to 3001');
        }
        
        // SEARXNG_API_URL
        const searxngPort = 8080; // Varsayılan, config'den alınabilir
        
        const env = {
            ...process.env,
            SEARXNG_API_URL: `http://127.0.0.1:${searxngPort}`,
            PORT: String(port),
            HOST: host
        };
        
        // Vane config.json varsa
        const vaneConfig = path.join(vaneDir, 'config.json');
        if (fs.existsSync(vaneConfig)) {
            env.CONFIG_PATH = vaneConfig;
        }
        
        // Port kontrolü
        const inUse = await this.isPortInUse(port);
        if (inUse) {
            return { success: false, error: `Port ${port} already in use!` };
        }
        
        // Zaten çalışıyor mu?
        if (this.servers.has('vane')) {
            return { success: false, error: 'Vane is already running' };
        }
        
        try {
            // npm run dev -- -p PORT pattern (PyQt6 ile aynı)
            const child = spawn('npm', ['run', 'dev', '--', '-p', String(port)], {
                cwd: vaneDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: env,
                shell: true
            });
            
            this.servers.set('vane', { child, pid: child.pid, port, host });
            
            child.stdout?.on('data', (data) => {
                const message = data.toString();
                this.emit('log', 'vane', message);
                console.log(`[VANE] ${message.trim()}`);
            });
            
            child.stderr?.on('data', (data) => {
                const message = data.toString();
                this.emit('error', 'vane', message);
                console.error(`[VANE ERROR] ${message.trim()}`);
            });
            
            child.on('error', (err) => {
                console.error('[VANE] Spawn error:', err.message);
                this.servers.delete('vane');
                this.emit('error', 'vane', `Spawn error: ${err.message}`);
            });
            
            child.on('exit', (code, signal) => {
                console.log(`[VANE] Exited (code: ${code}, signal: ${signal})`);
                this.servers.delete('vane');
                this.emit('stopped', 'vane', code, signal);
            });
            
            await this.waitForReady(port, 30000);
            
            return { success: true, pid: child.pid, port };
        } catch (err) {
            console.error('[VANE] Start failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    // ============================================
    // Stop Servers — Process Tree Kill
    // ============================================
    
    /**
     * Tek sunucuyu durdur
     * PyQt6'da: ServerWorker.stop_process(timeout=10)
     * - psutil ile process tree traversal
     * - Leaf-first terminate (çocuklar önce)
     * - 10s graceful wait → force kill fallback
     * - Port bazlı emergency kill
     * @param {string} type - Sunucu tipi
     * @returns {Promise<Object>} Sonuç
     */
    async stopServer(type) {
        const server = this.servers.get(type);
        
        if (!server) {
            // Process zaten durmuş, tasklist'ten temizle
            await this._cleanupOrphanProcess(type);
            return { success: true };
        }
        
        const { child, port, host } = server;
        
        // Graceful shutdown → force kill fallback (PyQt6 stop_process pattern)
        try {
            console.log(`[STOP] Killing ${type} process tree...`);
            
            // 1. Child process'i terminate et
            if (!child.killed) {
                child.kill('SIGTERM');
            }
            
            // 2. 10 saniye bekle (graceful shutdown)
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            // 3. Hala çalışıyorsa force kill
            if (!child.killed) {
                console.log(`[STOP] ${type} didn't stop gracefully. Force killing...`);
                await new Promise((resolve, reject) => {
                    treeKill(child.pid, 'SIGKILL', (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
            
            this.servers.delete(type);
            return { success: true };
        } catch (err) {
            console.error(`[${type}] Stop failed:`, err.message);
            return { success: false, error: err.message };
        }
    }
    
    /**
     * Tüm sunucuları durdur
     * PyQt6'da: stop_all_servers() metodu
     * - Tüm aktif process tree'leri topla
     * - 10s graceful shutdown → force kill
     * @returns {Promise<Array>} Her sunucunun sonucu
     */
    async stopAllServers() {
        console.log('[SHUTDOWN] === Stop ALL servers (graceful 10s timeout) ===');
        
        const results = [];
        const activeTypes = this.supportedServers.filter(t => this.servers.has(t));
        
        if (activeTypes.length === 0) {
            console.log('[SHUTDOWN] No active processes to stop.');
            return results;
        }
        
        // 1. Tüm process'leri terminate et
        for (const type of activeTypes) {
            try {
                const server = this.servers.get(type);
                if (server && !server.child.killed) {
                    server.child.kill('SIGTERM');
                    console.log(`[SHUTDOWN] Terminated ${type} (PID: ${server.child.pid})`);
                }
            } catch (e) {
                console.log(`[SHUTDOWN] Could not terminate ${type}:`, e.message);
            }
        }
        
        // 2. 10 saniye bekle
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // 3. Hala çalışanları force kill
        for (const type of activeTypes) {
            try {
                const server = this.servers.get(type);
                if (server && !server.child.killed) {
                    treeKill(server.child.pid, 'SIGKILL');
                    console.log(`[SHUTDOWN] Force killed ${type} (PID: ${server.child.pid})`);
                }
            } catch (e) {
                // Ignore
            }
        }
        
        // 4. Port bazlı emergency kill
        for (const type of activeTypes) {
            await this._emergencyPortKill(type);
        }
        
        // 5. Map'i temizle
        for (const type of activeTypes) {
            this.servers.delete(type);
            results.push({ type, success: true });
        }
        
        console.log('[SHUTDOWN] === All servers stopped ===');
        return results;
    }
    
    /**
     * Port bazlı emergency kill (PyQt6'daki _find_by_port pattern)
     * @private
     */
    async _emergencyPortKill(type) {
        const targets = {
            searxng: 'python.exe',
            openwebui: 'uvicorn.exe',
            llamacpp: 'llama-server.exe',
            vane: 'node.exe'
        };
        
        const procName = targets[type];
        if (!procName) return;
        
        try {
            // netstat ile port kullanan process'leri bul
            const output = execSync(`netstat -ano | findstr :`, { encoding: 'utf8', timeout: 3000 });
            
            for (const line of output.trim().split('\n')) {
                if (!line.includes(procName)) continue;
                
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                
                if (pid && !isNaN(parseInt(pid))) {
                    try {
                        execSync(`taskkill /PID ${pid} /F`, { timeout: 2000 });
                        console.log(`[EMERGENCY] Killed orphan ${procName} PID ${pid}`);
                    } catch (e) {
                        // Ignore
                    }
                }
            }
        } catch (e) {
            // No processes found or command failed
        }
    }
    
    /**
     * Orphan process temizleme (tasklist komutuyla)
     * @private
     */
    async _cleanupOrphanProcess(type) {
        const targets = {
            searxng: 'python.exe',
            openwebui: 'uvicorn.exe',
            llamacpp: 'llama-server.exe',
            vane: 'node.exe'
        };
        
        const procName = targets[type];
        if (!procName) return;
        
        try {
            const output = execSync(`tasklist /FI "IMAGENAME eq ${procName}" /FO CSV /NH`, {
                encoding: 'utf8',
                timeout: 3000
            });
            
            for (const line of output.trim().split('\n')) {
                const match = line.match(/"([^"]+)".*"(\d+)"/);
                if (match) {
                    const pid = parseInt(match[2], 10);
                    if (pid !== process.pid && pid !== process.ppid) {
                        try {
                            execSync(`taskkill /PID ${pid} /T /F`, { timeout: 3000 });
                            console.log(`[CLEANUP] Killed orphan ${procName} PID ${pid}`);
                        } catch (e) {
                            // Ignore errors
                        }
                    }
                }
            }
        } catch (e) {
            // No processes found or command failed
        }
    }
    
    // ============================================
    // Health Check — Auto-Restart
    // ============================================
    
    /**
     * Background health check timer'ı başlat
     * PyQt6'da: QTimer ile periyodik health check
     * - Her 60 saniyede bir HTTP ping yapar
     * - Yanıt yoksa otomatik restart
     */
    startHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        this.healthCheckInterval = setInterval(async () => {
            for (const [type, info] of this.servers.entries()) {
                const healthy = await this._checkHealth(info.port);
                
                if (!healthy) {
                    console.warn(`[HEALTH] ${type} not responding on port ${info.port} — restarting...`);
                    this.emit('unhealthy', type, info.port);
                    
                    // Otomatik restart (PyQt6 _check_servers_health pattern)
                    await this._autoRestartServer(type);
                }
            }
        }, this.healthCheckMs);
        
        console.log(`[HEALTH] Health check started (${this.healthCheckMs}ms interval)`);
    }
    
    /**
     * Otomatik sunucu restart (PyQt6'daki _check_servers_health pattern)
     * @private
     */
    async _autoRestartServer(type) {
        try {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2s bekle
            
            let result;
            
            switch (type) {
                case 'searxng':
                    result = await this.startSearXNG(
                        this.servers.get('searxng')?.port || 8080,
                        this.servers.get('searxng')?.host || '0.0.0.0'
                    );
                    break;
                case 'openwebui':
                    result = await this.startOpenWebUI(
                        this.servers.get('openwebui')?.port || 3000,
                        this.servers.get('openwebui')?.host || '127.0.0.1',
                        4 // threads
                    );
                    break;
                case 'llamacpp':
                    result = await this.startLlamaCPP(
                        this.servers.get('llamacpp')?.port || 1234,
                        this.servers.get('llamacpp')?.host || '0.0.0.0',
                        8192 // ctxSize
                    );
                    break;
                case 'vane':
                    result = await this.startVane(
                        this.servers.get('vane')?.port || 3001,
                        this.servers.get('vane')?.host || '0.0.0.0'
                    );
                    break;
            }
            
            if (result.success) {
                console.log(`[HEALTH] ${type} restarted successfully`);
                this.emit('restarted', type);
            } else {
                console.error(`[HEALTH] ${type} restart failed:`, result.error);
                this.emit('restart-failed', type, result.error);
            }
        } catch (e) {
            console.error(`[HEALTH] ${type} restart exception:`, e.message);
        }
    }
    
    /**
     * Health check timer'ı durdur
     */
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            console.log('[HEALTH] Health check stopped');
        }
    }
    
    /**
     * HTTP ile sağlık kontrolü
     * @private
     */
    async _checkHealth(port) {
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 3000 }, (res) => {
                res.destroy();
                resolve(res.statusCode >= 200 && res.statusCode < 400);
            });
            
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }
    
    /**
     * Sunucunun hazır olmasını bekle
     * @private
     */
    async waitForReady(port, timeoutMs = 30000) {
        return new Promise((resolve) => {
            let elapsed = 0;
            const check = setInterval(async () => {
                elapsed += 1000;
                
                const inUse = await this.isPortInUse(port);
                if (inUse) {
                    clearInterval(check);
                    resolve(true);
                    return;
                }
                
                if (elapsed >= timeoutMs) {
                    clearInterval(check);
                    resolve(false);
                }
            }, 1000);
        });
    }
    
    // ============================================
    // Status Query
    // ============================================
    
    /**
     * Tüm sunucu durumlarını döndür
     * @returns {Object} Durum map'i
     */
    getStatus() {
        const status = {};
        
        for (const type of this.supportedServers) {
            const server = this.servers.get(type);
            status[type] = {
                running: !!server,
                pid: server?.pid || null,
                port: server?.port || null,
                host: server?.host || null
            };
        }
        
        return status;
    }
    
    /**
     * Belirli bir sunucunun durumu
     * @param {string} type - Sunucu tipi
     * @returns {Object} Durum objesi
     */
    getServerStatus(type) {
        const server = this.servers.get(type);
        return {
            running: !!server,
            pid: server?.pid || null,
            port: server?.port || null,
            host: server?.host || null
        };
    }
    
    // ============================================
    // Cleanup
    // ============================================
    
    /**
     * Uygulama kapanırken tüm process'leri temizle
     */
    async cleanup() {
        console.log('[SERVERS] Cleaning up all servers...');
        
        await this.stopAllServers();
        this.stopHealthCheck();
        
        console.log('[SERVERS] All servers stopped');
    }
}

// ============================================
// Singleton Instance
// ============================================
let instance = null;

function getServerManager(config) {
    if (!instance) {
        instance = new ServerManager(config);
    }
    return instance;
}

module.exports = ServerManager;
module.exports.getServerManager = getServerManager;
module.exports.parseINI = parseINI;
module.exports.stringifyINI = stringifyINI;
module.exports.updateSettingsYML = updateSettingsYML;
