/**
 * LLM Runner AIO - Server Manager
 * 
 * PyQt6 tabs/servers.py'nin Electron karşılığı
 * - 4 Sunucu yönetimi (SearXNG, OpenWebUI, llama.cpp, Vane)
 * - child_process.spawn ile process başlatma/durdurma
 * - tree-kill ile force kill fallback
 * - Port kontrolü
 * - Health check polling
 * - Bind address seçimi (0.0.0.0 / 127.0.0.1)
 */

const { spawn, execSync } = require('child_process');
const net = require('net');
const http = require('http');
const path = require('path');
const EventEmitter = require('events');
const treeKill = require('tree-kill');

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
     * PyQt6'da: is_port_in_use() utility
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
    // Start Servers
    // ============================================
    
    /**
     * SearXNG sunucusunu başlat
     * PyQt6'da: SearXNGWorker.start_server_internal()
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @returns {Promise<Object>} Sonuç
     */
    async startSearXNG(port = 8080, host = '0.0.0.0') {
        return this._startServer('searxng', {
            cmd: 'python',
            args: ['-m', 'searx.webapp'],
            cwd: path.join(this.projectRoot, 'searxng'),
            port,
            host
        });
    }
    
    /**
     * OpenWebUI sunucusunu başlat
     * PyQt6'da: OpenWebUIWorker.start_server_internal()
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @returns {Promise<Object>} Sonuç
     */
    async startOpenWebUI(port = 3000, host = '127.0.0.1') {
        return this._startServer('openwebui', {
            cmd: 'python',
            args: [
                '-m', 'uvicorn', 'open_webui.app:app',
                '--host', host,
                '--port', String(port)
            ],
            cwd: path.join(this.projectRoot, 'openwebui'),
            port,
            host
        });
    }
    
    /**
     * llama.cpp sunucusunu başlat
     * PyQt6'da: LlamaCppWorker.start_server_internal()
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @param {string} model - GGUF model yolu
     * @returns {Promise<Object>} Sonuç
     */
    async startLlamaCPP(port = 1234, host = '0.0.0.0', model = '') {
        const exePath = path.join(
            this.projectRoot,
            'llama.cpp-cuda13+vulkan',
            'llama-server.exe'
        );
        
        return this._startServer('llamacpp', {
            cmd: exePath,
            args: ['--host', host, '--port', String(port), '-m', model].filter(Boolean),
            cwd: path.join(this.projectRoot, 'llama.cpp-cuda13+vulkan'),
            port,
            host
        });
    }
    
    /**
     * Vane sunucusunu başlat
     * PyQt6'da: VaneWorker.start_server_internal()
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @returns {Promise<Object>} Sonuç
     */
    async startVane(port = 8090, host = '0.0.0.0') {
        return this._startServer('vane', {
            cmd: 'node',
            args: ['server.js'],
            cwd: path.join(this.projectRoot, 'Vane'),
            env: { ...process.env, HOST: host, PORT: String(port) },
            port,
            host
        });
    }
    
    /**
     * Genel server başlatma metodu
     * @private
     */
    async _startServer(type, options) {
        // Port kontrolü
        const inUse = await this.isPortInUse(options.port);
        if (inUse) {
            return { success: false, error: `Port ${options.port} already in use!` };
        }
        
        // Zaten çalışıyor mu?
        if (this.servers.has(type)) {
            return { success: false, error: `${type} is already running` };
        }
        
        try {
            const child = spawn(options.cmd, options.args, {
                cwd: options.cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: options.env || process.env,
                detached: false
            });
            
            // Map'e kaydet
            this.servers.set(type, {
                child,
                pid: child.pid,
                port: options.port,
                host: options.host
            });
            
            // stdout/stderr stream'lerini dinle
            child.stdout?.on('data', (data) => {
                const message = data.toString();
                this.emit('log', type, message);
                console.log(`[${type.toUpperCase()}] ${message.trim()}`);
            });
            
            child.stderr?.on('data', (data) => {
                const message = data.toString();
                this.emit('error', type, message);
                console.error(`[${type.toUpperCase()} ERROR] ${message.trim()}`);
            });
            
            child.on('error', (err) => {
                console.error(`[${type}] Spawn failed:`, err.message);
                this.servers.delete(type);
                this.emit('error', type, `Spawn error: ${err.message}`);
            });
            
            child.on('exit', (code, signal) => {
                console.log(`[${type}] Exited (code: ${code}, signal: ${signal})`);
                this.servers.delete(type);
                this.emit('stopped', type, code, signal);
            });
            
            // Health check'a kadar bekle
            const ready = await this.waitForReady(options.port, 30000);
            
            if (!ready) {
                console.warn(`[${type}] Server may not be ready yet`);
            }
            
            return { success: true, pid: child.pid, port: options.port };
        } catch (err) {
            console.error(`[${type}] Start failed:`, err.message);
            return { success: false, error: err.message };
        }
    }
    
    // ============================================
    // Stop Servers
    // ============================================
    
    /**
     * Tek sunucuyu durdur
     * PyQt6'da: ServerWorker.stop_process(timeout=10)
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
        
        const { child } = server;
        
        // Graceful shutdown → force kill fallback
        try {
            child.kill('SIGTERM');
            
            // 10 saniye bekle
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            // Hala çalışıyorsa force kill
            if (!child.killed) {
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
     * @returns {Promise<Array>} Her sunucunun sonucu
     */
    async stopAllServers() {
        const results = [];
        
        for (const type of this.supportedServers) {
            const result = await this.stopServer(type);
            results.push({ type, ...result });
        }
        
        return results;
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
    // Health Check
    // ============================================
    
    /**
     * Background health check timer'ı başlat
     * PyQt6'da: QTimer ile periyodik health check
     */
    startHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        
        this.healthCheckInterval = setInterval(async () => {
            for (const [type, info] of this.servers.entries()) {
                const healthy = await this._checkHealth(info.port);
                
                if (!healthy) {
                    console.warn(`[HEALTH] ${type} not responding on port ${info.port}`);
                    this.emit('unhealthy', type, info.port);
                }
            }
        }, this.healthCheckMs);
        
        console.log(`[HEALTH] Health check started (${this.healthCheckMs}ms interval)`);
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
