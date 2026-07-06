/**
 * LLM Runner AIO - Electron Main Process
 * 
 * PyQt6 main.py'nin Electron karşılığı:
 * - BrowserWindow oluşturma
 * - Context bridge (preload.js)
 * - IPC handlers
 * - Process management (psutil yerine child_process + tree-kill)
 * - Orphan cleanup (startup'ta)
 * - System tray entegrasyonu
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const treeKill = require('tree-kill');

// ============================================
// Path Resolution (Cross-Platform Portability)
// ============================================
// PyQt6'da: ROOT = Path(__file__).parent.parent
// Electron'da: app.getAppPath() kullanıyoruz
const APP_ROOT = app.isPackaged 
    ? process.resourcesPath 
    : __dirname;

const PROJECT_DIR = path.join(APP_ROOT, '..');
const LAUNCHER_DIR = path.join(PROJECT_DIR, 'launcher');
const SRC_DIR = path.join(__dirname, '..', 'src');

// ============================================
// App User Model ID (Windows Taskbar düzeltme)
// ============================================
if (process.platform === 'win32') {
    app.setAppUserModelId('com.llmrunner.app');
}

// ============================================
// Orphan Process Cleanup (Startup)
// PyQt6'daki cleanup_orphan_processes() fonksiyonunun karşılığı
// ============================================
const TARGET_PROCESS_NAMES = [
    'llama-server.exe',
    'node.exe',      // Vane process'leri
    'uvicorn.exe',   // OpenWebUI process'leri
    'python.exe',    // SearXNG process'leri
    'pythonw.exe'    // SearXNG process'leri
];

function cleanupOrphanProcesses() {
    console.log('[CLEANUP] Scanning for orphaned processes...');
    
    const targetNames = TARGET_PROCESS_NAMES.map(n => n.toLowerCase());
    let killedCount = 0;
    
    try {
        // Windows: tasklist komutuyla tum process'leri al (filter without filter for Turkish compatibility)
        let output;
        try {
            output = execSync('tasklist /FO CSV /NH', { 
                encoding: 'utf8',
                timeout: 5000
            });
        } catch {
            console.log('[CLEANUP] tasklist not available, skipping orphan cleanup');
            return { killedCount: 0 };
        }
        
        const lines = output.trim().split('\n');
        
        for (const line of lines) {
            try {
                // CSV formatından parse et: "Process Name","PID",...
                const match = line.match(/^"([^"]+)".*"(\d+)"/);
                if (!match) continue;
                
                const procName = match[1].toLowerCase();
                const pid = parseInt(match[2], 10);
                
                // Hedef isimlerde mi?
                if (!targetNames.some(name => procName.includes(name.replace('.exe', '')))) {
                    continue;
                }
                
                // Kendi process'lerimizi atla
                if (pid === process.pid || pid === process.ppid) continue;
                
                // node.exe için ekstra güvenlik: sadece bizim projemizle ilişkili olanlar
                if (procName === 'node.exe') {
                    try {
                        const taskInfo = execSync(`tasklist /FI "PID eq ${pid}" /V /FO CSV`, {
                            encoding: 'utf8',
                            timeout: 2000
                        });
                        
                        const vaneDir = path.join(PROJECT_DIR, 'Vane');
                        const hasProjectRef = taskInfo.includes('Vane') || 
                                             taskInfo.includes(PROJECT_DIR);
                        
                        if (!hasProjectRef) continue;
                    } catch (e) {
                        // Bilgi alamıyorsak skip
                        continue;
                    }
                }
                
                // Process'i terminate et
                try {
                    console.log(`[CLEANUP] Terminating: ${match[1]} (PID: ${pid})`);
                    execSync(`taskkill /PID ${pid} /T /F`, { timeout: 3000 });
                    killedCount++;
                } catch (e) {
                    // Zaten bitmiş olabilir
                    console.log(`[CLEANUP] Skip (already dead?): PID ${pid}`);
                }
            } catch (e) {
                // Parse hatası - skip
            }
        }
    } catch (e) {
        console.log('[CLEANUP] tasklist command failed:', e.message);
    }
    
    console.log(`[CLEANUP] Cleaned up ${killedCount} orphaned process(es).`);
}

// ============================================
// Browser Window Oluşturma
// ============================================
let mainWindow;
let tray = null;

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 900,
        minHeight: 650,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        },
        icon: path.join(PROJECT_DIR, 'assets', 'icon.ico'),
        titleBarStyle: 'default',
        show: false
    });

    // HTML dosyasını yükle
    mainWindow.loadFile(path.join(SRC_DIR, 'index.html'));
    
    // Geliştirme modunda DevTools aç
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
    
    // Pencere görünür olduğunda göster
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });
    
    // Hata yakalama
    mainWindow.on('unresponsive', () => {
        console.error('[MAIN] Window became unresponsive!');
    });
    
    return mainWindow;
}

// ============================================
// System Tray Oluşturma
// ============================================
function createTray() {
    const trayIconPath = path.join(PROJECT_DIR, 'assets', 'icon.ico');
    
    tray = new Tray(trayIconPath);
    
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: 'Show LLM Runner',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Exit',
            click: () => {
                app.quit();
            }
        }
    ]);
    
    tray.setToolTip('LLM Runner AIO');
    tray.setContextMenu(contextMenu);
    
    // Tıklayınca pencereyi göster
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            } else if (!mainWindow.isVisible()) {
                mainWindow.show();
            }
            mainWindow.focus();
        }
    });
    
    return tray;
}

// ============================================
// IPC Handlers (Renderer ↔ Main iletişimi)
// ============================================
function setupIPC() {
    // Process Cleanup isteği
    ipcMain.handle('cleanup-orphan-processes', async () => {
        cleanupOrphanProcesses();
        return { success: true };
    });
    
    // Config okuma/yazma
    ipcMain.handle('config-read', async () => {
        const configPath = path.join(PROJECT_DIR, 'launcher', 'config.json');
        try {
            if (fs.existsSync(configPath)) {
                const data = fs.readFileSync(configPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error('[IPC] Failed to read config:', e.message);
        }
        return {};
    });
    
    ipcMain.handle('config-write', async (event, configData) => {
        const configPath = path.join(PROJECT_DIR, 'launcher', 'config.json');
        const tempPath = configPath + '.tmp';
        
        try {
            fs.writeFileSync(tempPath, JSON.stringify(configData, null, 2), 'utf8');
            fs.renameSync(tempPath, configPath); // Atomic write
            return { success: true };
        } catch (e) {
            console.error('[IPC] Failed to write config:', e.message);
            return { success: false, error: e.message };
        }
    });
    
    // Dil okuma
    ipcMain.handle('lang-read', async (event, langCode) => {
        const langPath = path.join(SRC_DIR, 'lang', `${langCode}.json`);
        try {
            if (fs.existsSync(langPath)) {
                const data = fs.readFileSync(langPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error(`[IPC] Failed to read ${langCode}.json:`, e.message);
        }
        // Fallback: English
        const enPath = path.join(SRC_DIR, 'lang', 'en.json');
        try {
            const data = fs.readFileSync(enPath, 'utf8');
            return JSON.parse(data);
        } catch (fallbackErr) {
            console.error('[IPC] Even fallback failed:', fallbackErr.message);
            return {};
        }
    });
    
    // Hardware detection
    ipcMain.handle('detect-hardware', async () => {
        return detectHardware();
    });
    
    // Server start/stop
    ipcMain.handle('server-start', async (event, serverType, options) => {
        return startServer(serverType, options);
    });
    
    ipcMain.handle('server-stop', async (event, serverType) => {
        return stopServer(serverType);
    });
    
    // Model download
    ipcMain.handle('model-download', async (event, url, destFolder) => {
        return downloadModel(url, destFolder);
    });
    
    // INI preset listesi (llama.cpp için)
    ipcMain.handle('get-llama-ini-presets', async () => {
        const iniDir = PROJECT_DIR;
        const presets = [];
        
        try {
            const files = fs.readdirSync(iniDir);
            for (const file of files) {
                // Daha eskek pattern: gpu ile baslayan ve models.ini ile biten dosyalar
                if (file.startsWith('gpu') && file.endsWith('.ini')) {
                    presets.push(file);
                }
            }
        } catch (e) {
            console.error('[IPC] Failed to read INI presets:', e.message);
        }
        
        return presets.sort();
    });
    
    // Picoding - Detect Project
    ipcMain.handle('picoding-detect-project', async () => {
        const projectRoot = PROJECT_DIR;
        const markers = ['package.json', 'requirements.txt', 'pyproject.toml', '.git', 'launcher'];
        
        const foundMarkers = markers.filter(m => fs.existsSync(path.join(projectRoot, m)));
        
        if (foundMarkers.length > 0) {
            return { success: true, path: projectRoot, markers: foundMarkers };
        }
        
        return { success: false, path: null };
    });
    
    // Picoding - Add to PATH
    ipcMain.handle('picoding-add-to-path', async () => {
        const picodingPath = path.join(PROJECT_DIR, 'picoding');
        
        if (!fs.existsSync(picodingPath)) {
            return { success: false, error: 'picoding directory not found' };
        }
        
        // Windows PATH'e ekle
        if (process.platform === 'win32') {
            try {
                const { execSync } = require('child_process');
                const currentPath = execSync('echo %PATH%', { encoding: 'utf8' }).trim();
                
                if (currentPath.includes(picodingPath)) {
                    return { success: true, message: 'Already in PATH' };
                }
                
                execSync(`setx PATH "%PATH%;${picodingPath}"`, { stdio: 'pipe' });
                return { success: true, message: 'Added to PATH successfully' };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
        
        return { success: false, error: 'Platform not supported' };
    });
    
    // Picoding - Save Advisor Settings
    ipcMain.handle('picoding-save-advisor', async (event, advisorData) => {
        const configPath = path.join(PROJECT_DIR, 'launcher', 'config.json');
        let config = {};
        
        try {
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
        } catch (e) {
            console.error('[IPC] Failed to read config:', e.message);
        }
        
        config.mcp_advisor = {
            url: advisorData.url,
            key: advisorData.key,
            model: advisorData.model
        };
        
        try {
            const tempPath = configPath + '.tmp';
            fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
            fs.renameSync(tempPath, configPath);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
    
    // Picoding - Get Advisor Settings
    ipcMain.handle('picoding-get-advisor', async () => {
        const configPath = path.join(PROJECT_DIR, 'launcher', 'config.json');
        
        try {
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                return config.mcp_advisor || {};
            }
        } catch (e) {
            console.error('[IPC] Failed to read advisor settings:', e.message);
        }
        
        return {};
    });
    
    // Model - Get Models from INI
    ipcMain.handle('model-get-models-from-ini', async (event, iniName) => {
        const iniPath = path.join(PROJECT_DIR, iniName);
        
        if (!fs.existsSync(iniPath)) {
            return [];
        }
        
        try {
            const iniContent = fs.readFileSync(iniPath, 'utf8');
            const models = [];
            let currentSection = '';
            
            const lines = iniContent.split('\n');
            for (const line of lines) {
                const sectionMatch = line.match(/^\[(.+)\]$/);
                if (sectionMatch) {
                    currentSection = sectionMatch[1];
                    continue;
                }
                
                if (line.startsWith('model') && line.includes('=')) {
                    const url = line.split('=')[1]?.trim()?.replace(/"/g, '');
                    models.push({ name: currentSection, model_url: url });
                } else if (line.startsWith('mmproj') && line.includes('=')) {
                    const url = line.split('=')[1]?.trim()?.replace(/"/g, '');
                    if (models.length > 0) {
                        models[models.length - 1].mmproj_url = url;
                    }
                }
            }
            
            return models;
        } catch (err) {
            console.error('[INI] Failed to parse INI:', err.message);
            return [];
        }
    });
    
    // Model - Generate Local INI
    ipcMain.handle('model-generate-local-ini', async (event, iniName) => {
        const iniPath = path.join(PROJECT_DIR, iniName);
        
        if (!fs.existsSync(iniPath)) {
            return { success: false, error: 'INI file not found' };
        }
        
        try {
            const iniContent = fs.readFileSync(iniPath, 'utf8');
            const config = parseINI(iniContent);
            
            // Local INI adı oluştur: gpu1vram4ram16models.ini -> models_gpu1vram4ram16.ini
            const baseName = iniName.replace('models.ini', '').replace('.ini', '');
            const localIniName = `models_${baseName}.ini`;
            const localIniPath = path.join(PROJECT_DIR, localIniName);
            
            const localConfig = {};
            
            for (const section of Object.keys(config)) {
                if (section === '*') continue;
                
                const modelUrl = config[section].model || '';
                const mmprojUrl = config[section].mmproj || '';
                
                let localModel = modelUrl;
                let localMmproj = mmprojUrl;
                
                if (modelUrl.startsWith('http')) {
                    const filename = modelUrl.split('/').pop();
                    const folderName = section.replace('-vision', '').replace('-Vision', '');
                    localModel = `models/${folderName}/${filename}`;
                }
                
                if (mmprojUrl.startsWith('http')) {
                    const filename = mmprojUrl.split('/').pop();
                    const folderName = section.replace('-vision', '').replace('-Vision', '');
                    localMmproj = `models/${folderName}/${filename}`;
                }
                
                localConfig[section] = { model: localModel };
                if (localMmproj) {
                    localConfig[section].mmproj = localMmproj;
                }
            }
            
            fs.writeFileSync(localIniPath, stringifyINI(localConfig), 'utf8');
            
            return {
                success: true,
                log: `${localIniName} created with ${Object.keys(config).filter(s => s !== '*').length} sections`
            };
        } catch (err) {
            console.error('[INI] Failed to generate local INI:', err.message);
            return { success: false, error: err.message };
        }
    });
    
    // ============================================
    // NEW: Database Load Handler
    // PyQt6'da: _load_database() metodu
    // ============================================
    ipcMain.handle('db-load', async (event, dbFilePath) => {
        return loadDatabase(dbFilePath);
    });
    
    // ============================================
    // NEW: SHA256 Model Verification
    // PyQt6'da: _calculate_sha256() + hash comparison
    // ============================================
    ipcMain.handle('model-verify-sha256', async (event, filePath, expectedHash) => {
        return verifyModelSHA256(filePath, expectedHash);
    });
    
    // ============================================
    // NEW: MCP Advisor File Update
    // PyQt6'da: _save_advisor_config() — mcp_web_reader.py güncelleme
    // ============================================
    ipcMain.handle('mcp-update-advisor-file', async (event, advisorData) => {
        const configResult = await updateMCPAdvisorFile(advisorData);
        
        // Config dosyasına da kaydet
        const configPath = path.join(PROJECT_DIR, 'launcher', 'config.json');
        let config = {};
        
        try {
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
        } catch (e) {
            console.error('[IPC] Failed to read config:', e.message);
        }
        
        config.mcp_advisor = {
            url: advisorData.url,
            key: advisorData.key,
            model: advisorData.model
        };
        
        const tempPath = configPath + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf8');
        fs.fsyncSync(fs.openSync(tempPath, 'r')); // Atomic write için fsync
        fs.renameSync(tempPath, configPath);
        
        return configResult;
    });
}

// ============================================
// Hardware Detection (PyQt6'daki system_detection.py karşılığı)
// ============================================
async function detectHardware() {
    const result = {
        gpuName: '',
        vramGb: 0.0,
        ramGb: 0.0,
        cpuName: '',
        platform: process.platform
    };
    
    // NVIDIA GPU detection
    try {
        const output = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
            encoding: 'utf8',
            timeout: 5000
        }).trim();
        
        if (output) {
            const lines = output.split('\n');
            const firstLine = lines[0].split(',').map(s => s.trim());
            result.gpuName = firstLine[0];
            result.vramGb = parseFloat(firstLine[1]) / 1024;
        }
    } catch (e) {
        // NVIDIA yok, AMD/Intel kontrolü
        if (process.platform === 'win32') {
            try {
                // wmic degil, PowerShell Get-CimInstance kullan (wmik yeni Windows'larda yok)
                const gpuOutput = execSync(
                    'powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"',
                    { encoding: 'utf8', timeout: 3000 }
                ).trim();
                
                if (gpuOutput) {
                    result.gpuName = gpuOutput;
                }
            } catch (gpuErr) {
                console.log('[DETECT] Could not detect GPU via PowerShell');
            }
        }
    }
    
    // RAM detection — Sistem toplam RAM'i
    const totalMemBytes = require('os').totalmem();
    result.ramGb = Math.round((totalMemBytes / (1024 * 1024 * 1024)) * 10) / 10;
    
    // CPU detection
    try {
        if (process.platform === 'win32') {
            // wmik degil, PowerShell Get-CimInstance kullan
            const cpuOutput = execSync(
                'powershell -Command "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name"',
                { encoding: 'utf8', timeout: 3000 }
            ).trim();
            
            if (cpuOutput) {
                result.cpuName = cpuOutput;
            }
        } else {
            result.cpuName = require('os').cpus()[0]?.model || '';
        }
    } catch (e) {
        result.cpuName = require('os').cpus()[0]?.model || 'Unknown';
    }
    
    // INI Config Eşleştirme — GPU'ya göre otomatik config seç
    try {
        const files = fs.readdirSync(PROJECT_DIR);
        const iniFiles = files.filter(f => f.match(/^gpu.*models\.ini$/));
        
        console.log('[DETECT] Found INI files:', iniFiles);
        
        if (result.gpuName && iniFiles.length > 0) {
            const gpuNameLower = result.gpuName.toLowerCase();
            let bestMatch = null;
            let bestScore = -1;
            
            for (const ini of iniFiles) {
                let score = 0;
                
                // GPU adı içinde ini dosyası varsa yüksek skor
                if (gpuNameLower.includes(ini.toLowerCase().split('.')[0])) {
                    score += 10;
                }
                
                // VRAM'e en yakın INI'yı seç
                const vramMatch = ini.match(/vram(\d+)/);
                if (vramMatch) {
                    const iniVram = parseInt(vramMatch[1]);
                    const diff = Math.abs(result.vramGb * 1024 - iniVram);
                    if (diff < 2048) { // ±2GB tolerans
                        score += (2048 - diff);
                    }
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = ini;
                }
            }
            
            result.iniMatch = bestMatch || null;
            console.log(`[DETECT] Selected INI: ${bestMatch} (score: ${bestScore})`);
        } else {
            result.iniMatch = null;
            console.log('[DETECT] No GPU detected or no INI files found');
        }
    } catch (e) {
        console.warn('[DETECT] INI matching failed:', e.message);
        result.iniMatch = null;
    }
    
    console.log(`[DETECT] Final result: GPU=${result.gpuName}, VRAM=${result.vramGb}GB, INI=${result.iniMatch}`);
    return result;
}

// ============================================
// Server Management (psutil yerine child_process + tree-kill)
// ============================================
const runningServers = new Map(); // serverType → child process

async function startServer(serverType, options = {}) {
    const port = options.port || 8080;
    const host = options.host || '0.0.0.0';
    
    // Port kontrolü
    const isPortInUse = await checkPortInUse(port);
    if (isPortInUse) {
        return { success: false, error: `Port ${port} already in use!` };
    }
    
    let cmd, args, cwd;
    
    switch (serverType) {
        case 'searxng':
            cmd = 'python';
            args = ['-m', 'searx.webapp'];
            cwd = path.join(PROJECT_DIR, 'searxng');
            break;
            
        case 'openwebui':
            cmd = 'python';
            args = ['-m', 'uvicorn', 'open_webui.app:app', '--host', host, '--port', String(port)];
            cwd = path.join(PROJECT_DIR, 'openwebui');
            break;
            
        case 'llamacpp':
            cmd = path.join(PROJECT_DIR, 'llama.cpp-cuda13+vulkan', 'llama-server.exe');
            args = ['--host', host, '--port', String(port)];
            
            // INI preset desteği
            if (options.iniPreset) {
                args.push('--models-max', '1');
                args.push('--models-preset', options.iniPreset);
            }
            
            // Model yolu varsa ekle
            if (options.model) {
                args.push('-m', options.model);
            }
            
            // Jinja template desteği
            args.push('--jinja');
            cwd = path.join(PROJECT_DIR, 'llama.cpp-cuda13+vulkan');
            break;
            
        case 'vane':
            cmd = 'node';
            args = ['server.js'];
            cwd = path.join(PROJECT_DIR, 'Vane');
            break;
            
        default:
            return { success: false, error: `Unknown server type: ${serverType}` };
    }
    
    try {
        const child = spawn(cmd, args, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env }
        });
        
        runningServers.set(serverType, child);
        
        // stdout/stderr stream'lerini dinle
        child.stdout?.on('data', (data) => {
            const message = data.toString();
            mainWindow?.webContents.send('server-log', { type: serverType, message });
            console.log(`[${serverType.toUpperCase()}] ${message.trim()}`);
        });
        
        child.stderr?.on('data', (data) => {
            const message = data.toString();
            mainWindow?.webContents.send('server-error', { type: serverType, message });
            console.error(`[${serverType.toUpperCase()} ERROR] ${message.trim()}`);
        });
        
        child.on('error', (err) => {
            console.error(`[${serverType}] Spawn error:`, err.message);
            runningServers.delete(serverType);
            return { success: false, error: err.message };
        });
        
        child.on('exit', (code, signal) => {
            console.log(`[${serverType}] Exited with code ${code}, signal ${signal}`);
            runningServers.delete(serverType);
            mainWindow?.webContents.send('server-stopped', { type: serverType });
        });
        
        // Health check'a kadar bekle
        await waitForServerReady(port, 30000);
        
        return { success: true, pid: child.pid, port };
    } catch (err) {
        console.error(`[${serverType}] Start failed:`, err.message);
        return { success: false, error: err.message };
    }
}

async function stopServer(serverType) {
    const child = runningServers.get(serverType);
    
    if (!child) {
        // Process zaten durmuş, tasklist'ten temizleyelim
        try {
            const targets = {
                searxng: 'python.exe',
                openwebui: 'uvicorn.exe',
                llamacpp: 'llama-server.exe',
                vane: 'node.exe'
            };
            
            const procName = targets[serverType];
            if (procName) {
                const output = execSync(`tasklist /FI "IMAGENAME eq ${procName}" /FO CSV /NH`, {
                    encoding: 'utf8',
                    timeout: 3000
                });
                
                for (const line of output.trim().split('\n')) {
                    const match = line.match(/"([^"]+)".*"(\d+)"/);
                    if (match) {
                        const pid = parseInt(match[2], 10);
                        if (pid !== process.pid && pid !== process.ppid) {
                            execSync(`taskkill /PID ${pid} /T /F`, { timeout: 3000 });
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore errors during cleanup
        }
        
        runningServers.delete(serverType);
        return { success: true };
    }
    
    // Graceful shutdown → force kill fallback
    try {
        child.kill('SIGTERM');
        
        await new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, 10000); // 10 saniye bekle
        });
        
        // Hala çalışıyorsa force kill
        if (!child.killed) {
            treeKill(child.pid, 'SIGKILL', (err) => {
                if (err) {
                    console.error(`[${serverType}] Force kill failed:`, err.message);
                }
            });
        }
        
        runningServers.delete(serverType);
        return { success: true };
    } catch (err) {
        console.error(`[${serverType}] Stop failed:`, err.message);
        return { success: false, error: err.message };
    }
}

// ============================================
// NEW: Database Load Handler (PyQt6 _load_database)
// ============================================
async function loadDatabase(dbFilePath) {
    const openwebuiDir = path.join(PROJECT_DIR, 'openwebui');
    const destDb = path.join(openwebuiDir, 'openwebui.db');
    
    try {
        // Eski database'i yedekle
        const oldDb = fs.existsSync(destDb);
        if (oldDb) {
            const backupPath = path.join(openwebuiDir, 'openwebui.db.backup');
            if (fs.existsSync(backupPath)) {
                fs.unlinkSync(backupPath);
            }
            fs.renameSync(destDb, backupPath);
            console.log(`[DB] Old database backed up to: ${backupPath}`);
        }
        
        // Yeni database'i kopyala
        fs.copyFileSync(dbFilePath, destDb);
        console.log(`[DB] Database loaded from: ${dbFilePath}`);
        console.log(`[DB] Database saved to: ${destDb}`);
        
        return { success: true, message: 'Database loaded successfully' };
    } catch (err) {
        console.error('[DB] Load failed:', err.message);
        return { success: false, error: err.message };
    }
}

// ============================================
// NEW: SHA256 Model Verification (Bug #5)
// ============================================
async function calculateSHA256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', (chunk) => {
            hash.update(chunk);
        });
        
        stream.on('end', () => {
            resolve(hash.digest('hex'));
        });
        
        stream.on('error', (err) => {
            reject(err);
        });
    });
}

async function verifyModelSHA256(filePath, expectedHash) {
    try {
        const actualHash = await calculateSHA256(filePath);
        return {
            success: true,
            verified: actualHash.toLowerCase() === expectedHash.toLowerCase(),
            actualHash,
            expectedHash: expectedHash.substring(0, 16) + '...'
        };
    } catch (err) {
        console.error('[VERIFY] SHA256 verification failed:', err.message);
        return { success: false, error: err.message };
    }
}

// ============================================
// NEW: MCP Advisor File Update (PyQt6 _save_advisor_config)
// ============================================
async function updateMCPAdvisorFile(advisorData) {
    const mcpPath = path.join(PROJECT_DIR, 'picoding', 'mcp', 'mcp_web_reader.py');
    
    if (!fs.existsSync(mcpPath)) {
        return { success: false, error: 'mcp_web_reader.py not found' };
    }
    
    try {
        let content = fs.readFileSync(mcpPath, 'utf8');
        
        // ADVISOR_URL güncelle
        content = content.replace(
            /ADVISOR_URL = ".*?"/,
            `ADVISOR_URL = "${advisorData.url}"`
        );
        
        // ADVISOR_KEY güncelle
        content = content.replace(
            /ADVISOR_KEY = ".*?"/,
            `ADVISOR_KEY = "${advisorData.key}"`
        );
        
        // ADVISOR_MODEL güncelle
        content = content.replace(
            /ADVISOR_MODEL = ".*?"/,
            `ADVISOR_MODEL = "${advisorData.model}"`
        );
        
        fs.writeFileSync(mcpPath, content, 'utf8');
        console.log('[MCP] Advisor config updated in mcp_web_reader.py');
        
        return { success: true, message: 'MCP file updated successfully' };
    } catch (err) {
        console.error('[MCP] Update failed:', err.message);
        return { success: false, error: err.message };
    }
}

// ============================================
// Simple INI Parser (no external dependency)
// ============================================
function parseINI(content) {
    const result = {};
    let currentSection = '';
    
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
            continue;
        }
        
        // Section header
        const sectionMatch = trimmed.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1];
            if (!result[currentSection]) {
                result[currentSection] = {};
            }
            continue;
        }
        
        // Key=value pair
        const kvMatch = trimmed.match(/^(.+?)=(.*)$/);
        if (kvMatch && currentSection) {
            const key = kvMatch[1].trim();
            let value = kvMatch[2].trim();
            // Remove quotes
            value = value.replace(/^['"]|['"]$/g, '');
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
// Utility Functions
// ========================================
function checkPortInUse(port) {
    return new Promise((resolve) => {
        const net = require('net');
        const socket = new net.Socket();
        socket.setTimeout(2000);
        
        socket.connect(port, '127.0.0.1', () => {
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

function waitForServerReady(port, timeoutMs = 30000) {
    return new Promise((resolve) => {
        let elapsed = 0;
        const interval = setInterval(async () => {
            elapsed += 1000;
            
            const inUse = await checkPortInUse(port);
            if (inUse) {
                clearInterval(interval);
                resolve(true);
                return;
            }
            
            if (elapsed >= timeoutMs) {
                clearInterval(interval);
                resolve(false);
            }
        }, 1000);
    });
}

async function downloadModel(url, destFolder) {
    const fetch = require('node-fetch');
    const fs = require('fs');
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const totalSize = response.headers.get('content-length');
        let downloaded = 0;
        
        const fileStream = fs.createWriteStream(destFolder);
        
        return new Promise((resolve, reject) => {
            response.body.pipe(fileStream);
            
            response.body.on('data', (chunk) => {
                downloaded += chunk.length;
                
                // Progress event gönder
                if (totalSize) {
                    const percent = Math.round((downloaded / parseInt(totalSize, 10)) * 100);
                    mainWindow?.webContents.send('download-progress', { percent, downloaded, total: totalSize });
                }
            });
            
            fileStream.on('finish', () => {
                fileStream.close();
                resolve({ success: true, path: destFolder });
            });
            
            fileStream.on('error', (err) => {
                fs.unlink(destFolder, () => {}); // Partial dosyayı sil
                reject(err);
            });
            
            response.body.on('error', (err) => {
                fs.unlink(destFolder, () => {});
                reject(err);
            });
        });
    } catch (err) {
        console.error('[DOWNLOAD] Failed:', err.message);
        return { success: false, error: err.message };
    }
}

// ============================================
// App Lifecycle Events
// ============================================
app.whenReady().then(() => {
    // Orphan process temizliği
    cleanupOrphanProcesses();
    
    // IPC handlers kurulumu
    setupIPC();
    
    // Ana pencere oluştur
    createMainWindow();
    
    // System tray oluştur
    createTray();
});

// Tüm pencereler kapatıldığında (macOS hariç)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

// Uygulama kapanırken tüm sunucuları durdur
app.on('before-quit', () => {
    console.log('[APP] Shutting down all servers...');
    
    for (const [type, child] of runningServers.entries()) {
        try {
            treeKill(child.pid, 'SIGKILL');
        } catch (e) {
            console.log(`[APP] Could not kill ${type}:`, e.message);
        }
    }
    
    runningServers.clear();
});

// Hata yakalama
app.on('will-finish-launching', () => {
    app.on('uncaughtException', (error) => {
        console.error('[UNCAUGHT EXCEPTION]:', error);
    });
    
    app.on('unhandledRejection', (reason) => {
        console.error('[UNHANDLED REJECTION]:', reason);
    });
});

// ============================================
// Notification Handlers (renderer'dan gelen bildirimler)
// ============================================
ipcMain.handle('notification-info', (_event, title, message) => {
    console.log(`[NOTIFICATION INFO]: ${title} - ${message}`);
    return { success: true };
});

ipcMain.handle('notification-warning', (_event, title, message) => {
    console.warn(`[NOTIFICATION WARNING]: ${title} - ${message}`);
    return { success: true };
});

ipcMain.handle('notification-error', (_event, title, message) => {
    console.error(`[NOTIFICATION ERROR]: ${title} - ${message}`);
    return { success: true };
});

ipcMain.handle('notification-confirm', (_event, title, message) => {
    console.log(`[NOTIFICATION CONFIRM]: ${title} - ${message}`);
    return { confirmed: true };
});

console.log('[ELECTRON] LLM Runner AIO starting...');
console.log('[ELECTRON] App root:', APP_ROOT);
console.log('[ELECTRON] Project dir:', PROJECT_DIR);
