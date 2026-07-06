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
const SRC_DIR = __dirname;

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
        // Windows: tasklist komutuyla tüm process'leri al
        const output = execSync('tasklist /FI "IMAGENAME eq *.exe" /FO CSV /NH', { 
            encoding: 'utf8',
            timeout: 5000
        });
        
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
        icon: path.join(APP_ROOT, 'assets', 'icon.ico'),
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
    const trayIconPath = path.join(APP_ROOT, 'assets', 'icon.ico');
    
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
        const configPath = path.join(LAUNCHER_DIR, 'config.json');
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
        const configPath = path.join(LAUNCHER_DIR, 'config.json');
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
        const langPath = path.join(LAUNCHER_DIR, 'lang', `${langCode}.json`);
        try {
            if (fs.existsSync(langPath)) {
                const data = fs.readFileSync(langPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error(`[IPC] Failed to read ${langCode}.json:`, e.message);
        }
        // Fallback: English
        const enPath = path.join(LAUNCHER_DIR, 'lang', 'en.json');
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
                const wmicOutput = execSync('wmic path win32_VideoController get Name', {
                    encoding: 'utf8',
                    timeout: 3000
                }).trim();
                
                const lines = wmicOutput.split('\n').filter(l => l.trim() && !l.includes('Name'));
                if (lines.length > 0) {
                    result.gpuName = lines[0].trim();
                }
            } catch (wmicErr) {
                console.log('[DETECT] Could not detect GPU via WMIC');
            }
        }
    }
    
    // RAM detection
    result.ramGb = Math.round(process.memoryUsage().heapTotal / (1024 * 1024 * 1024));
    // Gerçek RAM için sysinfo kullanacağız (daha gelişmiş versiyonda)
    
    // CPU detection
    try {
        if (process.platform === 'win32') {
            const cpuOutput = execSync('wmic cpu get Name', {
                encoding: 'utf8',
                timeout: 3000
            }).trim();
            
            const lines = cpuOutput.split('\n').filter(l => l.trim() && !l.includes('Name'));
            if (lines.length > 0) {
                result.cpuName = lines[0].trim();
            }
        } else {
            result.cpuName = require('os').cpus()[0]?.model || '';
        }
    } catch (e) {
        result.cpuName = require('os').cpus()[0]?.model || 'Unknown';
    }
    
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
            args = ['--host', host, '--port', String(port), '-m', options.model || ''];
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
// Utility Functions
// ============================================
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

console.log('[ELECTRON] LLM Runner AIO starting...');
console.log('[ELECTRON] App root:', APP_ROOT);
console.log('[ELECTRON] Project dir:', PROJECT_DIR);
