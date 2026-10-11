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

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execSync, spawnSync } = require('child_process');
const { bootstrapGitDir } = require('./git-bootstrap');
const treeKill = require('tree-kill');
const presetStore = require('./preset-store');
const wan2gpDetect = require('./wan2gp-detect');
const strata = require('./strata');

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

function cleanupOrphanProcesses() {
    console.log('[CLEANUP] Scanning for orphaned processes...');

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

        // Guvenli eslestirme (HAT-07):
        // - Isim-ozel process'ler (llama-server/llama-bench): isim uzerinden kill
        // - Genel yorumlayicilar (node/python/pythonw/uvicorn): YALNIZCA komut
        //   satiri BU projeyi referans veriyorsa kill — sistemdeki baska
        //   python/node process'lerine ASLA dokunulmaz.
        const SAFE_NAME_MATCHES = ['llama-server', 'llama-bench'];
        const INTERPRETER_BASES = ['node', 'python', 'pythonw', 'uvicorn'];
        const projLower = PROJECT_DIR.toLowerCase().replace(/\\/g, '/');

        for (const line of lines) {
            try {
                const match = line.match(/^"([^"]+)".*"(\d+)"/);
                if (!match) continue;

                const procName = match[1].toLowerCase();
                const pid = parseInt(match[2], 10);

                // Kendi process'lerimizi atla
                if (pid === process.pid || pid === process.ppid) continue;

                const baseName = procName.replace('.exe', '');
                const isSafeName = SAFE_NAME_MATCHES.some(n => procName.includes(n));
                const isInterpreter = INTERPRETER_BASES.includes(baseName);

                if (!isSafeName && !isInterpreter) continue;

                // Yorumlayici process'lerinde proje baglantisini dogrula
                if (isInterpreter) {
                    let cmdLine = '';
                    try {
                        cmdLine = execSync(
                            `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
                            { encoding: 'utf8', timeout: 4000 }
                        ).trim().toLowerCase().replace(/\\/g, '/');
                    } catch (e) {
                        continue; // Bilgi alinamadiysa dokunma
                    }
                    if (!cmdLine.includes(projLower)) continue;
                }

                // Process'i terminate et
                try {
                    console.log(`[CLEANUP] Terminating: ${match[1]} (PID: ${pid})`);
                    execSync(`taskkill /PID ${pid} /T /F`, { timeout: 3000 });
                    killedCount++;
                } catch (e) {
                    // Zaten bitmis olabilir
                    console.log(`[CLEANUP] Skip (already dead?): PID ${pid}`);
                }
            } catch (e) {
                // Parse hatasi - skip
            }
        }    } catch (e) {
        console.log('[CLEANUP] tasklist command failed:', e.message);
    }

    console.log(`[CLEANUP] Cleaned up ${killedCount} orphaned process(es).`);
}

// ============================================
// Browser Window Oluşturma
// ============================================
let mainWindow;
let tray = null;

// Server durumları (tray menüsü için)
const serverStates = {
    searxng: { running: false, port: 8080 },
    openwebui: { running: false, port: 3000 },
    llamacpp: { running: false, port: 1234 },
    vane: { running: false, port: 3001 },
    wan2gp: { running: false, port: 7860 },
    strata: { running: false, port: 1235 }
};

// ============================================
// Safe IPC sender — window destroy olduktan sonra hata vermez
// ============================================
function safeSend(channel, data) {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, data);
        }
    } catch {}
}

// ============================================
// Single Source of Truth: Server State Setter
// Tüm state güncellemeleri buradan geçer
// ============================================
function setServerState(type, isRunning, port = null) {
    // Mevcut port'u koru, yeni port gelirse güncelle
    const currentPort = port || (serverStates[type]?.port ?? 0);
    
    serverStates[type] = { 
        ...serverStates[type], 
        running: isRunning,
        port: currentPort
    };
    
    // 1. Tray menüsünü güncelle
    updateTrayMenu();
    
    // 2. UI'ya güvenli bildirim gönder
    const eventName = isRunning ? 'server-running' : 'server-stopped';
    safeSend(eventName, { type, port: serverStates[type].port });
    
    console.log(`[STATE] ${type} → ${isRunning ? 'RUNNING' : 'STOPPED'} (port: ${currentPort})`);
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 900,
        minHeight: 650,
        frame: false, // Custom title bar
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // Canli olcer/log/animasyon uygulamasi: pencere arka plandayken Chromium
            // kare/zamanlama kisitlamasi animasyonlari ve led guncellemelerini donduruyordu.
            backgroundThrottling: false
        },
        icon: path.join(PROJECT_DIR, 'assets', 'icon.ico'),
        show: false
    });

    // HTML dosyasını yükle
    mainWindow.loadFile(path.join(SRC_DIR, 'index.html'));

    // Geliştirme modunda DevTools aç
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    // Menu.setApplicationMenu(null) tum Chromium kisayollarini da siliyor (frame:false
    // yuzunden menu akseleratori yok) -> DevTools fiziksel tuslarla elle baglanir:
    // Ctrl+Shift+I / F12 ac-kapa; Ctrl+Shift+C konsol+denetimi dogrudan secili acar.
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const key = (input.key || '').toLowerCase();
        const comboI = (input.control && input.shift && key === 'i');
        const comboJ = (input.control && input.shift && key === 'j');
        const f12 = key === 'f12';
        if (comboI || f12) {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        } else if (comboJ) {
            if (!mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.openDevTools({ mode: 'detach' });
            mainWindow.webContents.inspectElement(10, 10);
            event.preventDefault();
        }
    });

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
// Registry Sync — Portable Autostart
// ============================================
function syncAutostartRegistry() {
    try {
        const vbsPath = path.join(PROJECT_DIR, 'electron', 'launch_app.vbs');
        
        // VBS varsa registry'yi guncelle ve baslangica kisayol ekle
        if (!fs.existsSync(vbsPath)) {
            console.log('[AUTOSTART] VBS not found — skipping registry sync');
            return;
        }
        
        // Mevcut registry degerini oku
        let currentPath = '';
        try {
            const regResult = execSync(`reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v LLMRunnerAIO 2>nul`, { encoding: 'utf8' });
            const match = regResult.match(/LLMRunnerAIO\s+REG_SZ\s+(.+)/);
            if (match) currentPath = match[1].trim();
        } catch {
            // Kayit yok
        }
        
        // Normalize kiyaslama (her iki yolda da \\ → \)
        const normalizedCurrent = currentPath.replace(/\\/g, '/');
        const normalizedNew = vbsPath.replace(/\\/g, '/');
        
        if (normalizedCurrent === normalizedNew) {
            console.log('[AUTOSTART] Registry already synced:', vbsPath);
        } else {
            // Guncelle
            const tempPs = path.join(app.getPath('temp'), '_llm_sync_reg.ps1');
            const escaped = vbsPath.replace(/\\/g, '\\\\');
            const psContent = `Set-ItemProperty -Path "Registry::HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name 'LLMRunnerAIO' -Value '"${escaped}"'
Write-Host 'Synced to ${escaped}'`;
            fs.writeFileSync(tempPs, psContent, 'utf8');
            execSync(`powershell -ExecutionPolicy Bypass -File "${tempPs}"`, { stdio: 'pipe' });
            fs.unlinkSync(tempPs);
            
            console.log('[AUTOSTART] Registry updated:', vbsPath);
        }
        
        // === BASLANGICA KISAYOL (.lnk) OLUSTURMAK ===
        const startupDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        if (!fs.existsSync(startupDir)) {
            console.log('[AUTOSTART] Startup directory not found, skipping shortcut creation');
            return;
        }
        
        const startupLnk = path.join(startupDir, 'LLM Runner.lnk');
        
        // PowerShell ile .lnk kısayol oluştur (WScript.Shell.CreateShortcut)
        const tempPs = path.join(app.getPath('temp'), '_llm_create_shortcut.ps1');
        const vbsAbsPath = vbsPath.replace(/\\/g, '\\\\');
        const startupDirEscaped = startupDir.replace(/\\/g, '\\\\');
        const lnkContent = `
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("${startupDirEscaped}\\LLM Runner.lnk")
$shortcut.TargetPath = "${vbsAbsPath}"
$shortcut.WorkingDirectory = "${PROJECT_DIR.replace(/\\/g, '\\\\')}"
$shortcut.WindowStyle = 1
$shortcut.Description = "LLM Runner AIO"
$shortcut.Save()
`;
        fs.writeFileSync(tempPs, lnkContent.trim(), 'utf8');
        execSync(`powershell -ExecutionPolicy Bypass -File "${tempPs}"`, { stdio: 'pipe' });
        fs.unlinkSync(tempPs);
        
        console.log('[AUTOSTART] Shortcut created in Startup:', startupLnk);
        
    } catch (e) {
        console.error('[AUTOSTART] Sync failed:', e.message);
    }
}

// ============================================
// System Tray Oluşturma
// ============================================
function createTray() {
    const icoPath = path.join(PROJECT_DIR, 'assets', 'icon.ico');
    const pngPath = path.join(PROJECT_DIR, 'assets', 'icon.png');
    
    let trayIconPath = icoPath;
    
    // ICO dosyasi yoksa direkt PNG kullan
    if (!fs.existsSync(icoPath)) {
        trayIconPath = pngPath;
    }
    
    try {
        tray = new Tray(trayIconPath);
        console.log('[TRAY] Icon loaded:', trayIconPath);
    } catch (err) {
        console.warn('[TRAY] ICO failed, trying PNG...:', err.message);
        // ICO calismiyorsa PNG dene
        trayIconPath = pngPath;
        try {
            tray = new Tray(trayIconPath);
            console.log('[TRAY] PNG icon loaded:', trayIconPath);
        } catch (err2) {
            console.error('[TRAY] PNG also failed, running without tray icon');
            tray = null;
        }
    }

    // Dinamik menü oluştur (server durumlarına göre)
    const contextMenu = buildTrayMenu();

    tray.setToolTip('LLM Runner AIO');
    tray.setContextMenu(contextMenu);

    // Tıklayınca pencereyi göster
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });

    // Minimize edildiginde sistem tepsisine tasima
    if (mainWindow) {
        mainWindow.on('minimize', () => {
            mainWindow.hide();
            console.log('[TRAY] Window minimized → hidden in system tray');
        });
    }

    return tray;
}

/**
 * Tray menüsünü server durumlarına göre günceller
 */
function buildTrayMenu() {
    const menuItems = [];
    
    // Ana menü başlığı
    menuItems.push({
        label: 'Show LLM Runner',
        click: () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
    
    menuItems.push({ type: 'separator' });
    
    // Server kontrolleri
    const serverNames = {
        searxng: 'SearXNG',
        openwebui: 'Open WebUI',
        llamacpp: 'llama.cpp',
        vane: 'Vane',
        wan2gp: 'Wan2GP',
        strata: 'Strata'
    };
    
    for (const [type, name] of Object.entries(serverNames)) {
        const state = serverStates[type];
        if (state) {
            if (state.running) {
                // Sunucu çalışıyor → Durdur seçeneği
                menuItems.push({
                    label: `${name} ⏹ Stop`,
                    click: async () => {
                        console.log(`[TRAY] Stopping ${type}...`);
                        try {
                            await stopServer(type);
                            console.log(`[TRAY] ${type} stopped successfully`);
                        } catch (err) {
                            console.error(`[TRAY] Failed to stop ${type}:`, err.message);
                        }
                    }
                });
            } else {
                // Sunucu duruyor → Başlat seçeneği
                menuItems.push({
                    label: `${name} ▶ Start`,
                    click: async () => {
                        console.log(`[TRAY] Starting ${type}...`);
                        try {
                            const result = await startServer(type);
                            if (result.success) {
                                console.log(`[TRAY] ${type} started successfully on port ${result.port}`);
                            } else {
                                console.error(`[TRAY] Failed to start ${type}:`, result.error);
                            }
                        } catch (err) {
                            console.error(`[TRAY] Failed to start ${type}:`, err.message);
                        }
                    }
                });
            }
        }
    }
    
    menuItems.push({ type: 'separator' });
    
    // Çıkış
    menuItems.push({
        label: 'Exit',
        click: () => {
            app.quit();
        }
    });
    
    return Menu.buildFromTemplate(menuItems);
}

/**
 * Tray menüsünü yeniden oluşturur (server durumu değiştiğinde çağrılır)
 */
function updateTrayMenu() {
    if (!tray) return;
    
    try {
        const newMenu = buildTrayMenu();
        tray.setContextMenu(newMenu);
    } catch (err) {
        console.error('[TRAY] Failed to update menu:', err.message);
    }
}

// ============================================
// IPC Handlers (Renderer ↔ Main iletişimi)
// ============================================
function setupIPC() {
    // Window controls (frameless icin)
    ipcMain.on('window-minimize', () => {
        if (mainWindow) mainWindow.minimize();
    });
    
    ipcMain.on('window-maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });
    
    ipcMain.on('window-close', () => {
        if (mainWindow) mainWindow.close();
    });

    // Path utilities
    ipcMain.handle('paths-project-root', () => PROJECT_DIR);
    ipcMain.handle('paths-launcher-dir', () => LAUNCHER_DIR);
    ipcMain.handle('paths-models-dir', () => path.join(PROJECT_DIR, 'models'));
    
    // Shell — URL açma (tarayıcıda)
    ipcMain.handle('shell-open-url', (_event, url) => {
        const { shell } = require('electron');
        shell.openExternal(url);
        return { success: true };
    });

    // Shell — function/ dizinini ac
    ipcMain.handle('shell-open-path-func-folder', async () => {
        const { shell } = require('electron');
        const funcFolder = path.join(PROJECT_DIR, 'openwebui', 'function');
        try {
            await shell.openPath(funcFolder);
            console.log(`[SHELL] Opened function folder: ${funcFolder}`);
        } catch (err) {
            console.error('[SHELL] Failed to open function folder:', err.message);
        }
    });

    // Dosya var mı kontrolü
    ipcMain.handle('file-exists', async (_event, filePath) => {
        return fs.existsSync(filePath);
    });

    // ============================================
    // File Dialog (QFileDialog.getOpenFileName karşılığı)
    // ============================================
    ipcMain.handle('dialog-open-file', async (_event, options) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
                { name: 'Database Files', extensions: ['db'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            ...options
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
            return { success: true, filePath: result.filePaths[0] };
        }
        return { success: false, cancelled: true };
    });

    ipcMain.handle('dialog-open-folder', async (_event, options) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            ...options
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
            return { success: true, folderPath: result.filePaths[0] };
        }
        return { success: false, cancelled: true };
    });

    ipcMain.handle('dialog-save-file', async (_event, options) => {
        const result = await dialog.showSaveDialog(mainWindow, {
            filters: [
                { name: 'Database Files', extensions: ['db'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            ...options
        });
        
        if (!result.canceled && result.filePath) {
            return { success: true, filePath: result.filePath };
        }
        return { success: false, cancelled: true };
    });

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
            fs.mkdirSync(path.dirname(configPath), { recursive: true }); // HAT-01: dizin yoksa olustur
            fs.writeFileSync(tempPath, JSON.stringify(configData, null, 2), 'utf8');
            fs.renameSync(tempPath, configPath); // Atomic write
            return { success: true };
        } catch (e) {
            console.error('[IPC] Failed to write config:', e.message);
            return { success: false, error: e.message };
        }
    });

    // ============================================
    // Autostart Registry Handlers (Windows)
    // ============================================
    const AUTOSTART_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\LLMRunnerAIO';
    
    ipcMain.handle('autostart-enable', async () => {
        try {
            const ps1Path = path.join(app.getPath('temp'), '_llm_autostart_enable.ps1');
            // Electron exe degil, VBS dosyasini kullan (sessiz baslatma icin)
            // PROJECT_DIR = proje koku (electron/'in bir ustu) — her makinede dinamik
            const vbsAbsPath = path.join(PROJECT_DIR, 'electron', 'launch_app.vbs');
            if (!fs.existsSync(vbsAbsPath)) {
                console.error('[AUTOSTART] VBS not found:', vbsAbsPath);
                return { success: false, error: 'VBS dosyasi bulunamadi' };
            }
            // PowerShell icerisinde \\ kullan (Windows path separator)
            const vbsEscaped = vbsAbsPath.replace(/\\/g, '\\\\');
            const psContent = `
Set-ItemProperty -Path "Registry::HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name 'LLMRunnerAIO' -Value '"${vbsEscaped}"'
Write-Host 'Autostart enabled successfully'
`;
            fs.writeFileSync(ps1Path, psContent, 'utf8');
            execSync(`powershell -ExecutionPolicy Bypass -File "${ps1Path}"`, { stdio: 'pipe' });
            fs.unlinkSync(ps1Path); // Cleanup
            console.log('[AUTOSTART] Enabled via registry:', vbsAbsPath);
            return { success: true };
        } catch (e) {
            console.error('[AUTOSTART] Enable failed:', e.message);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('autostart-disable', async () => {
        try {
            const ps1Path = path.join(app.getPath('temp'), '_llm_autostart_disable.ps1');
            const psContent = `
Remove-ItemProperty -Path "Registry::HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name 'LLMRunnerAIO' -ErrorAction SilentlyContinue
Write-Host 'Autostart disabled successfully'
`;
            fs.writeFileSync(ps1Path, psContent, 'utf8');
            execSync(`powershell -ExecutionPolicy Bypass -File "${ps1Path}"`, { stdio: 'pipe' });
            fs.unlinkSync(ps1Path); // Cleanup
            console.log('[AUTOSTART] Disabled via registry');
            return { success: true };
        } catch (e) {
            console.error('[AUTOSTART] Disable failed:', e.message);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('autostart-check', async () => {
        try {
            const result = execSync(`reg query "${AUTOSTART_KEY}" 2>nul`, { encoding: 'utf8' });
            return { enabled: result.includes('LLMRunnerAIO') };
        } catch {
            return { enabled: false };
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

    // Canli sistem olcerleri (sidebar altbilgisi: GPU kullanimi/VRAM/watt + RAM)
    let sysStatsCache = { ts: 0, data: null };
    ipcMain.handle('get-system-stats', async () => {
        const now = Date.now();
        if (sysStatsCache.data && now - sysStatsCache.ts < 1500) return sysStatsCache.data;
        const stats = {};
        try {
            const os = require('os');
            const total = os.totalmem(), free = os.freemem();
            stats.ramTotalGb = Math.round(total / 1073741824 * 10) / 10;
            stats.ramUsedPct = Math.round((1 - free / total) * 100);
        } catch (e) { /* os okunamadi */ }
        try {
            const out = execSync('nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader,nounits', {
                encoding: 'utf8',
                timeout: 2000
            }).trim().split('\n')[0];
            const p = out.split(',').map(s => s.trim());
            if (p.length >= 4) {
                stats.gpuUtilPct = parseInt(p[0]);
                stats.gpuMemUsedGb = Math.round(parseInt(p[1]) / 102.4) / 10;
                stats.gpuMemTotalGb = Math.round(parseInt(p[2]) / 102.4) / 10;
                stats.gpuWatt = Math.round(parseFloat(p[3]));
            }
        } catch (e) { /* nvidia-smi yok veya timeout */ }
        sysStatsCache = { ts: now, data: stats };
        return stats;
    });

    // Server start/stop
    ipcMain.handle('server-start', async (event, serverType, options) => {
        return startServer(serverType, options);
    });

    ipcMain.handle('server-stop', async (event, serverType) => {
        // stopServer() zaten setServerState() üzerinden güncelliyor
        return await stopServer(serverType);
    });
    // ============================================
    // Wan2GP (video üretimi) — durum & kurulum
    // ============================================
    ipcMain.handle('wan2gp-status', async () => {
        const hw = await detectHardware();
        const recommended = wan2gpDetect.mapGpuToWan2gpPreset(hw.gpuName);
        const presets = wan2gpDetect.listPresets(WAN2GP_PRESETS_DIR);
        let prereqs = [];
        if (recommended) {
            try {
                const mdPath = path.join(WAN2GP_PRESETS_DIR, recommended.path, 'KURULUM.md');
                prereqs = wan2gpDetect.extractPrereqs(fs.readFileSync(mdPath, 'utf8'));
            } catch {}
        }
        return {
            gpuName: hw.gpuName || '',
            recommended: recommended ? recommended.path : null,
            presets,
            cloned: fs.existsSync(path.join(WAN2GP_DIR, 'wgp.py')),
            venvExists: fs.existsSync(path.join(WAN2GP_VENV_DIR, 'Scripts', 'python.exe')),
            installed: fs.existsSync(path.join(WAN2GP_VENV_DIR, '.wan2gp-installed')),
            prereqs,
            setupRunning: wan2gpSetupRunning
        };
    });

    ipcMain.handle('wan2gp-setup', async (event, options = {}) => {
        if (wan2gpSetupRunning) return { success: false, error: 'Setup already in progress.' };
        wan2gpSetupRunning = true;
        const send = (message) => safeSend('wan2gp-setup-log', { message });
        try {
            const presetRel = options.preset;
            if (!presetRel || !/^[a-z]+\/[a-z0-9-]+$/.test(presetRel)) {
                throw new Error('No valid preset selected.');
            }
            const reqFile = path.join(WAN2GP_PRESETS_DIR, presetRel, 'requirements.txt');
            if (!fs.existsSync(reqFile)) throw new Error('Preset requirements.txt not found: ' + presetRel);

            // 1) Git kontrolü
            try { execSync('git --version', { encoding: 'utf8', timeout: 5000 }); }
            catch { throw new Error('Git was not found in PATH. Install Git for Windows first.'); }

            // 2) Clone (yalnızca bir kez, shallow)
            if (!fs.existsSync(path.join(WAN2GP_DIR, 'wgp.py'))) {
                send('[SETUP] Cloning Wan2GP repository (can take a few minutes)...');
                execSync('git clone --depth 1 ' + WAN2GP_REPO_URL, { cwd: PROJECT_DIR, timeout: 15 * 60 * 1000, stdio: 'pipe' });
                send('[SETUP] Repository cloned.');
            }

            // 3) Python bul (3.11 tercih edilir)
            const py = findWan2gpPython();
            send('[SETUP] Using Python: ' + [py.cmd].concat(py.args).join(' '));

            // 4) Ayrı sanal ortam (venv) oluştur
            const venvPy = path.join(WAN2GP_VENV_DIR, 'Scripts', 'python.exe');
            if (!fs.existsSync(venvPy)) {
                send('[SETUP] Creating virtual environment: venvs\\wan2gp');
                fs.mkdirSync(path.dirname(WAN2GP_VENV_DIR), { recursive: true });
                const mk = spawnSync(py.cmd, py.args.concat(['-m', 'venv', WAN2GP_VENV_DIR]), { cwd: PROJECT_DIR, timeout: 5 * 60 * 1000 });
                if (!fs.existsSync(venvPy)) {
                    throw new Error('Virtual environment creation failed: ' + ((mk && mk.stderr) ? String(mk.stderr).slice(-500) : 'unknown error'));
                }
            }

            // 5) Bağımlılıkları kur (akışlı çıktı)
            send('[SETUP] Installing dependencies for "' + presetRel + '" — this can take 10-30 minutes...');
            await runWan2gpStreaming([venvPy, '-m', 'pip', 'install', '-r', reqFile], send);

            // 5b) Repo'nun kendi requirements.txt — paket surumleri kodla senkron kalsin (mmgp vb.)
            const repoReqFile = path.join(WAN2GP_DIR, 'requirements.txt');
            if (fs.existsSync(repoReqFile)) {
                send('[SETUP] Syncing packages with repo requirements.txt (fixes any version drift)...');
                await runWan2gpStreaming([venvPy, '-m', 'pip', 'install', '-r', repoReqFile], send);
            }
            // 6) Tamamlandı işareti
            fs.writeFileSync(path.join(WAN2GP_VENV_DIR, '.wan2gp-installed'), new Date().toISOString());
            send('[SETUP] Setup complete. You can now start Wan2GP.');
            return { success: true };
        } catch (err) {
            console.error('[WAN2GP-SETUP] Failed:', err.message);
            send('[SETUP] FAILED: ' + err.message);
            return { success: false, error: err.message };
        } finally {
            wan2gpSetupRunning = false;
        }
    });


    // Wan2GP repo guncelleme (git pull)
    ipcMain.handle('wan2gp-update', async (event) => {
        const wgpFile = path.join(WAN2GP_DIR, 'wgp.py');
        if (!fs.existsSync(wgpFile)) {
            return { success: false, error: 'Wan2GP repo not found. Run Setup first.' };
        }
        const send = (message) => safeSend('wan2gp-setup-log', { message });
        wan2gpSetupRunning = true;
        try {
            // 1) Local changes (runtime settings like models/_settings.json, EOL drift) can block pull -> stash
            send('[UPDATE] Stashing local changes (if any)...');
            const stashRes = await runWan2gpCapture(['git', '-C', WAN2GP_DIR, 'stash', 'push', '-m', 'aio-wan2gp-update-stash']);
            if (stashRes.code !== 0) throw new Error('git stash failed: ' + (stashRes.out || '').trim());
            const hadStash = /saved working (directory|tree)/i.test(stashRes.out);
            send(hadStash ? '[UPDATE] Local changes stashed (will restore after update).' : '[UPDATE] No local changes to stash.');

            send('[UPDATE] Pulling latest Wan2GP code (git pull --ff-only)...');
            await runWan2gpStreaming(['git', '-C', WAN2GP_DIR, 'pull', '--ff-only'], send);
            // Pull sonrasi bagimlilik senkronu — repo'nun kendi requirements.txt (mmgp vb. kodla senkron)
            const wgpVenvPy = path.join(WAN2GP_VENV_DIR, 'Scripts', 'python.exe');
            const wgpRepoReq = path.join(WAN2GP_DIR, 'requirements.txt');
            if (fs.existsSync(wgpRepoReq) && fs.existsSync(wgpVenvPy)) {
                send('[UPDATE] Syncing dependencies with repo requirements.txt...');
                await runWan2gpStreaming([wgpVenvPy, '-m', 'pip', 'install', '-r', wgpRepoReq], send);
            }
            // 2) Stash edilen yerel degisiklikleri geri yuks (pop basarisiz olsa bile guncelleme basarili sayilir)
            if (hadStash) {
                send('[UPDATE] Restoring local changes (git stash pop)...');
                const popRes = await runWan2gpCapture(['git', '-C', WAN2GP_DIR, 'stash', 'pop']);
                if (popRes.code !== 0) {
                    send('[UPDATE] WARNING: Could not auto-restore stashed changes. Recover manually: git stash list / git stash pop');
                }
            }
            send('[UPDATE] Repository updated.');
            return { success: true };
        } catch (err) {
            console.error('[WAN2GP-UPDATE] Failed:', err.message);
            send('[UPDATE] FAILED: ' + err.message);
            return { success: false, error: err.message };
        } finally {
            wan2gpSetupRunning = false;
        }
    });

    // Tray menu guncelleme (renderer'dan manuel trigger icin)
    ipcMain.handle('tray-update-menu', () => {
        updateTrayMenu();
        return { success: true };
    });

    // Server durumlarini al (renderer'dan sorgulama icin)
    ipcMain.handle('get-server-states', () => {
        return { ...serverStates };
    });

    // Model download (taskId ile progress takibi)
    ipcMain.handle('model-download', async (event, url, destFolder, taskId) => {
        return downloadModel(url, destFolder, taskId);
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

    // Picoding - Detect Project (PyQt6 _detect_project ile birebir aynı)
    ipcMain.handle('picoding-detect-project', async () => {
        const projectRoot = PROJECT_DIR;
        
        // PyQt6'daki markers listesi ile tam uyumlu
        const markers = [
            'package.json',      // Node.js
            'requirements.txt',  // Python
            'pyproject.toml',    // Python
            '.git',              // Git repo
            'CMakeLists.txt',    // CMake
            'launcher'           // Bu projenin kendisi
        ];

        const foundMarkers = [];
        for (const marker of markers) {
            if (fs.existsSync(path.join(projectRoot, marker))) {
                foundMarkers.push(marker);
            }
        }

        if (foundMarkers.length > 0) {
            return { 
                success: true, 
                path: projectRoot, 
                markers: foundMarkers,
                message: `Detected: ${foundMarkers.join(', ')}`
            };
        }

        // Hiçbir marker bulunamadı — kullanıcıdan manuel seçim iste
        return { success: false, path: null, needManualSelect: true };
    });

    // Picoding - Add to PATH (KULLANICI + SISTEM, cift kapsam)
    // Hem kullanci PATH (HKCU) hem de sistem PATH (HKLM) guncellenir; boylece
    // hangi ortamdan cagrilsa da 'pi' cozumlenir.
    // Sistem PATH yazi islemi yonetici yetkisi gerektirir: once normal calistirilir,
    // izin reddedilirse UAC (RunAs) ile yuksektili tekrar denetlenir.
    // ONEMLI: Hicbir .ps1 diska yazilmaz (AV heuristicleri dosyayi izole etmesin);
    // scriptler -EncodedCommand (base64) olarak bellekten iletir, sonuc kucuk bir temp txt'tedir.
    ipcMain.handle('picoding-add-to-path', async () => {
        const picodingPath = path.resolve(path.join(PROJECT_DIR, 'picoding'));

        if (!fs.existsSync(picodingPath)) {
            return { success: false, error: 'picoding directory not found' };
        }

        if (process.platform !== 'win32') {
            return { success: false, error: 'Platform not supported' };
        }

        try {
            const { execSync } = require('child_process');
            const os = require('os');
            const fsLocal = require('fs');

            const resultFile = path.join(os.tmpdir(), 'picoding_path_result.txt');
            const q = (p) => "'" + String(p).replace(/'/g, "''") + "'";
            // PowerShell -EncodedCommand formati: UTF-16LE metnin base64 hali
            const enc = (s) => Buffer.from(s, 'utf16le').toString('base64');

            // Verilen kapsami guncelleyen PS scripti (disk'e DUSMEZ, encoded iletir)
            const scopeScript = (scope) => [
                "$ErrorActionPreference = 'Stop'",
                'try {',
                '    $target = ' + q(picodingPath) + ';',
                '    $res = ' + q(resultFile) + ';',
                "    $cur = [Environment]::GetEnvironmentVariable('Path', '" + scope + "')",
                "    if ([string]::IsNullOrEmpty($cur)) { $cur = '' }",
                '    if ($cur.IndexOf($target, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {',
                "        Set-Content -LiteralPath $res -Value 'EXISTS' -Encoding ASCII",
                '    } else {',
                "        [Environment]::SetEnvironmentVariable('Path', $target + ';' + $cur, '" + scope + "') | Out-Null",
                "        Set-Content -LiteralPath $res -Value 'OK' -Encoding ASCII",
                '    }',
                '} catch {',
                "    Set-Content -LiteralPath $res -Value ('ERROR: ' + $_.Exception.Message) -Encoding ASCII",
                '}',
            ].join('\r\n');

            const cleanResult = () => { try { fsLocal.unlinkSync(resultFile); } catch {} };
            const readResult = () => {
                try { return fsLocal.readFileSync(resultFile, 'utf8').trim(); } catch { return ''; }
            };

            // Encoded komutla dogrudan (yuksektili olmadan) calistirir — dosya uretmez
            const runEncodedDirect = (scriptText) => {
                cleanResult();
                execSync(`powershell -NoProfile -EncodedCommand ${enc(scriptText)}`, {
                    encoding: 'utf8', timeout: 15000
                });
                return readResult();
            };

            // Makine kapsamini UAC ile yuksektili calistirir (bootstrap da encoded)
            const runElevated = () => {
                cleanResult();
                const innerEnc = enc(scopeScript('Machine'));
                const bootText = [
                    "$inner = '" + innerEnc + "'",
                    "Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Minimized -ArgumentList @('-NoProfile','-EncodedCommand',$inner)",
                ].join('\r\n');
                execSync(`powershell -NoProfile -EncodedCommand ${enc(bootText)}`, {
                    encoding: 'utf8', timeout: 180000
                });
                return readResult();
            };

            try {
                // 1) KULLANICI PATH (yetki gerektirmez)
                let userOutcome = '';
                try {
                    userOutcome = runEncodedDirect(scopeScript('User'));
                } catch (err) {
                    userOutcome = 'ERROR: ' + String((err && err.message) || err);
                }

                // 2) SISTEM PATH (yonetici yetkisi: once dogrudan, olmazsa UAC)
                let machineOutcome = '';
                try {
                    machineOutcome = runEncodedDirect(scopeScript('Machine'));
                    if (!machineOutcome || machineOutcome.startsWith('ERROR')) {
                        machineOutcome = runElevated();
                    }
                } catch (err) {
                    const msg = String((err && err.message) || '');
                    if (/cancel/i.test(msg)) {
                        machineOutcome = 'ERROR: Elevation cancelled by user';
                    } else {
                        machineOutcome = 'ERROR: ' + msg;
                    }
                }

                // Bos sonuclari normallestir (zaman asimi / iptal / yanitsiz)
                if (!userOutcome) userOutcome = 'ERROR: no response';
                if (!machineOutcome) machineOutcome = 'ERROR: no response (UAC prompt may have been cancelled or timed out)';

                const ok = (v) => v === 'OK' || v === 'EXISTS';
                const strip = (v) => String(v).replace(/^ERROR: /, '');
                const userDone = ok(userOutcome);
                const machineDone = ok(machineOutcome);

                if (userDone && machineDone) {
                    return { success: true, message: 'Added to PATH successfully' };
                }
                if (userDone || machineDone) {
                    // Bir taraf basarili, digerinde sorun var → uyarıyla don
                    const failedScope = userDone ? 'system' : 'user';
                    const failedOutcome = userDone ? machineOutcome : userOutcome;
                    return {
                        success: true,
                        warning: `${failedScope}: ${strip(failedOutcome)}`
                    };
                }
                return {
                    success: false,
                    error: `user: ${strip(userOutcome)}; system: ${strip(machineOutcome)}`,
                    picodingPath
                };
            } finally {
                // Sonuc dosyasini temizle (artik script dosyasi uretilmiyor)
                try { fsLocal.unlinkSync(resultFile); } catch {}
            }
        } catch (err) {
            console.error('[PATH] Failed to update:', err.message);
            return { success: false, error: String((err && err.message) || err), picodingPath };
        }
    });

    // Picoding - Save Advisor Settings (PyQt6 _save_advisor_config ile birebir aynı)
    ipcMain.handle('picoding-save-advisor', async (event, advisorData) => {
        // 1️⃣ advisor_config.json'a kaydet (picoding/ klasöründe)
        const configDir = path.join(PROJECT_DIR, 'picoding');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const configPath = path.join(configDir, 'advisor_config.json');

        try {
            fs.writeFileSync(configPath, JSON.stringify({
                url: advisorData.url,
                key: advisorData.key,
                model: advisorData.model
            }, null, 2), 'utf8');
            console.log('[MCP] Saved advisor_config.json');
        } catch (e) {
            console.error('[MCP] Failed to write advisor_config.json:', e.message);
            return { success: false, error: e.message };
        }

        // 2️⃣ mcp_web_reader.py dosyasını güncelle
        const mcpPath = path.join(PROJECT_DIR, 'picoding', 'mcp', 'mcp_web_reader.py');
        if (!fs.existsSync(mcpPath)) {
            console.warn('[MCP] mcp_web_reader.py not found at', mcpPath);
            return { success: true, message: 'Config saved, but mcp_web_reader.py not found' };
        }

        try {
            let content = fs.readFileSync(mcpPath, 'utf8');

            // URL'nin sonu /chat/completions ile bitmiyorsa ekle
            let finalUrl = advisorData.url;
            if (!finalUrl.endsWith('/chat/completions')) {
                finalUrl += '/chat/completions';
            }
            console.log(`[MCP] Final Advisor URL: ${finalUrl}`);

            // ADVISOR_URL güncelle
            content = content.replace(
                /ADVISOR_URL = ".*?"/,
                `ADVISOR_URL = "${finalUrl}"`
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
            console.log('[MCP] Updated mcp_web_reader.py');
        } catch (e) {
            console.error('[MCP] Failed to update mcp_web_reader.py:', e.message);
            return { success: false, error: e.message };
        }

        return { success: true, message: 'Advisor config saved and mcp_web_reader.py updated' };
    });

    // Picoding - Get Advisor Settings (PyQt6 _load_advisor_config ile birebir aynı)
    ipcMain.handle('picoding-get-advisor', async () => {
        const configPath = path.join(PROJECT_DIR, 'picoding', 'advisor_config.json');

        try {
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                return {
                    url: config.url || '',
                    key: config.key || '',
                    model: config.model || ''
                };
            }
        } catch (e) {
            console.error('[IPC] Failed to read advisor_config.json:', e.message);
        }

        // PyQt6'daki gibi varsayılan değerler döndür
        return {
            url: 'http://192.168.1.177:3000/api/chat/completions',
            key: '',
            model: ''
        };
    });

    // Picoding - Providers (Faz 14): picoding/providers.json tek doğruluk kaynağı.
    // Kaydetme anında %USERPROFILE%\.pi\agent\providers.json'e de yansıtılır
    // (auto-model-discovery.ts buradan okur; run.bat senkronu zaten aynısını yapar).
    const PROVIDERS_JSON = path.join(PROJECT_DIR, 'picoding', 'providers.json');
    const DEFAULT_PROVIDERS = [
        { id: 'llama-cpp-185', baseUrl: 'http://192.168.1.185:1234', apiKey: '', enabled: true },
        { id: 'strata-185', baseUrl: 'http://192.168.1.185:1235', apiKey: '', enabled: true },
        { id: 'llama-cpp-177', baseUrl: 'http://192.168.1.177:1234', apiKey: '', enabled: true }
    ];

    function validateProviders(list) {
        if (!Array.isArray(list)) return { ok: false, error: 'Provider list must be an array' };
        const seen = new Set();
        const clean = [];
        for (const p of list) {
            const id = String((p && p.id) || '').trim().replace(/\s+/g, '-');
            let baseUrl = String((p && p.baseUrl) || '').trim();
            // Kullanıcı /v1/models gibi endpoint yazdıysa sade base'e indirge
            baseUrl = baseUrl.replace(/\/v1\/(chat\/completions|models).*$/, '').replace(/\/v1\/$/, '').replace(/\/models\/$/, '').replace(/\/+$/, '');
            if (!/^[A-Za-z0-9._-]{1,40}$/.test(id)) return { ok: false, error: 'Invalid provider name (letters/digits/-/_ only): ' + id };
            if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: 'Base URL must start with http:// or https://: ' + baseUrl };
            if (seen.has(id.toLowerCase())) return { ok: false, error: 'Duplicate provider name: ' + id };
            seen.add(id.toLowerCase());
            clean.push({ id, baseUrl, apiKey: String((p && p.apiKey) || '').trim(), enabled: p.enabled !== false });
        }
        return { ok: true, providers: clean };
    }

    function writeProvidersFile(list) {
        fs.writeFileSync(PROVIDERS_JSON, JSON.stringify({ providers: list }, null, 2), 'utf8');
        // Onaylı senkron hedefi: ~/.pi/agent/providers.json
        try {
            const agentDir = path.join(require('os').homedir(), '.pi', 'agent');
            fs.mkdirSync(agentDir, { recursive: true });
            fs.writeFileSync(path.join(agentDir, 'providers.json'), JSON.stringify({ providers: list }, null, 2), 'utf8');
        } catch (e) {
            console.error('[IPC] providers.json ayna kopyası yazılamadı:', e.message);
        }
    }

    ipcMain.handle('picoding-get-providers', async () => {
        try {
            if (fs.existsSync(PROVIDERS_JSON)) {
                const raw = JSON.parse(fs.readFileSync(PROVIDERS_JSON, 'utf8'));
                return { success: true, providers: Array.isArray(raw.providers) ? raw.providers : DEFAULT_PROVIDERS };
            }
        } catch (e) {
            console.error('[IPC] Failed to read providers.json:', e.message);
        }
        // İlk kullanım: varsayılanları tohumla
        try { writeProvidersFile(DEFAULT_PROVIDERS); } catch (e) { /* sonraki denemede tekrar denenir */ }
        return { success: true, providers: DEFAULT_PROVIDERS };
    });

    ipcMain.handle('picoding-save-providers', async (event, list) => {
        const v = validateProviders(list);
        if (!v.ok) return { success: false, error: v.error };
        try {
            writeProvidersFile(v.providers);
            return { success: true, providers: v.providers };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Picoding - Fetch Available Models from API (Universal Provider Support)
    ipcMain.handle('picoding-fetch-models', async (event, apiUrl, apiKey, providerType) => {
        if (!apiUrl) {
            return { success: false, error: 'API URL is required' };
        }

        try {
            // Base URL'i temizle (trailing slash ve bilinen endpoint suffix'leri cikart)
            let baseUrl = apiUrl
                .replace(/\/chat\/?\/completions.*$/, '')  // /chat/completions veya /chat/completions/...
                .replace(/\/models\s*$/, '')               // /models ile bitenleri temizle
                .replace(/\/api\/tags\s*$/, '')             // /api/tags ile bitenleri temizle
                .replace(/\/+$/, '');                       // trailing slash'lar
            
            console.log(`[MCP] Input: ${apiUrl}`);
            console.log(`[MCP] Cleaned base: ${baseUrl}`);
            
            // Provider'a gore endpoint belirle
            let endpointsToTry = [];
            
            if (!providerType || providerType === 'auto') {
                // Otomatik algila - URL pattern'e gore
                if (baseUrl.includes('openrouter.ai')) {
                    endpointsToTry = [`${baseUrl}/models`];
                } else if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
                    endpointsToTry = [
                        `${baseUrl}/v1/models`,           // LM Studio, text-generation-webui
                        `${baseUrl}/openai/v1/models`,    // Bazilari
                        `${baseUrl}/api/tags`             // Ollama
                    ];
                } else if (baseUrl.includes('ollama')) {
                    endpointsToTry = [`${baseUrl}/api/tags`];
                } else if (baseUrl.includes('groq.com')) {
                    endpointsToTry = [`${baseUrl}/models`];
                } else {
                    // Genel fallback - son paraya /models ekle
                    const lastSlash = baseUrl.lastIndexOf('/');
                    const afterLastSlash = baseUrl.substring(lastSlash + 1);
                    
                    if (afterLastSlash === 'v1' || afterLastSlash === 'api') {
                        endpointsToTry = [
                            `${baseUrl}/models`,
                            `${baseUrl}/openai/v1/models`
                        ];
                    } else {
                        endpointsToTry = [
                            `${baseUrl}/v1/models`,
                            `${baseUrl}/models`,
                            `${baseUrl}/openai/v1/models`
                        ];
                    }
                }
            } else if (providerType === 'openrouter') {
                endpointsToTry = [`${baseUrl}/models`];
            } else if (providerType === 'ollama') {
                endpointsToTry = [`${baseUrl}/api/tags`, `${baseUrl}/api/tags`];
            } else if (providerType === 'lmstudio') {
                endpointsToTry = [`${baseUrl}/v1/models`];
            } else if (providerType === 'openai') {
                endpointsToTry = [`${baseUrl}/v1/models`];
            } else if (providerType === 'groq') {
                endpointsToTry = [`${baseUrl}/models`];
            } else if (providerType === 'anthropic') {
                // Anthropic'in kendi API'si — modelleri /v1/messages ile degil,
                // https://docs.anthropic.com/en/docs/about-claude/models listeler
                // Bu durumda kullaniciya manuel model secimi oner
                return { 
                    success: false, 
                    error: 'Anthropic API does not expose /v1/models endpoint. Please enter model name manually.',
                    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022']
                };
            } else {
                // Custom - kullaninin girdigi URL'den temizlenmis base'i kullan
                endpointsToTry = [`${baseUrl}/models`];
            }

            console.log(`[MCP] Provider: ${providerType || 'auto'}`);
            console.log(`[MCP] Base URL: ${baseUrl}`);
            console.log(`[MCP] Trying endpoints:`);
            endpointsToTry.forEach(ep => console.log(`    - ${ep}`));
            
            if (apiKey) {
                console.log(`[MCP] Using API Key: ${apiKey.substring(0, 8)}...`);
            } else {
                console.log(`[MCP] No API Key provided (local API)`);
            }

            // node-fetch v3 ESM kullan (require ile calismaz)
            const fetch = (await import('node-fetch')).default;

            let lastError = null;
            
            for (const endpoint of endpointsToTry) {
                try {
                    console.log(`[MCP] Trying: ${endpoint}`);
                    
                    const headers = {
                        'Content-Type': 'application/json'
                    };
                    
                    // API Key varsa ekle (Ollama haric)
                    if (apiKey && providerType !== 'ollama') {
                        headers['Authorization'] = `Bearer ${apiKey}`;
                    }
                    
                    const response = await fetch(endpoint, {
                        method: 'GET',
                        headers,
                        signal: AbortSignal.timeout(10000) // 10 saniye timeout
                    });

                    if (response.ok) {
                        const data = await response.json();

                        // OpenAI format: { data: [{ id: 'model-name', ... }, ...] }
                        if (data && Array.isArray(data.data)) {
                            const models = data.data.map(m => m.id).filter(Boolean);
                            console.log(`[MCP] ✅ Found ${models.length} models from ${endpoint}`);
                            return { success: true, models: models };
                        }

                        // Ollama format: { models: [{ name: 'model-name', ... }, ...] }
                        if (data && Array.isArray(data.models)) {
                            const models = data.models.map(m => m.name).filter(Boolean);
                            console.log(`[MCP] ✅ Found ${models.length} Ollama models from ${endpoint}`);
                            return { success: true, models: models };
                        }

                        // Fallback: data kendisi array ise
                        if (Array.isArray(data)) {
                            const models = data.map(m => typeof m === 'string' ? m : m.id).filter(Boolean);
                            console.log(`[MCP] ✅ Found ${models.length} models (fallback) from ${endpoint}`);
                            return { success: true, models: models };
                        }

                        console.warn(`[MCP] Got 200 OK but unexpected format from ${endpoint}:`, typeof data);
                        lastError = `Unexpected response format from ${endpoint}`;
                    } else {
                        console.log(`[MCP] ❌ ${endpoint} → ${response.status}`);
                        lastError = `${endpoint} returned ${response.status}`;
                    }
                } catch (err) {
                    console.log(`[MCP] ❌ ${endpoint} → ${err.message}`);
                    lastError = err.message;
                }
            }

            return { success: false, error: `All endpoints failed. Last: ${lastError}` };

        } catch (err) {
            console.error('[MCP] Failed to fetch models:', err.message);
            return { success: false, error: `Fetch failed: ${err.message}` };
        }
    });

    // ============================================
    // Untracked Merge Engelleyici Karantinası (HAT-41):
    // Yarim kalmis guncellemelerden arta kalan dosyalar calisma agacinda "untracked" durur.
    // Ust akis bu dosyalari tracked olarak eklediginde `git pull` iptal olur:
    // "The following untracked working tree files would be overwritten by merge".
    // Engelleyen kopyalar .tmp/untracked_backup_<ts>/ altina tasinir; pull temiz ilerler.
    // ============================================
    function quarantineUntrackedOverwriteBlockers(dir, log) {
        try {
            const fetchRes = spawnSync('git', ['fetch'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
            if (fetchRes.status !== 0) return; // offline vb.: normal pull akisi karar verir
            const incoming = spawnSync('git', ['diff', '--name-only', 'HEAD..FETCH_HEAD'], { cwd: dir, encoding: 'utf8' })
                .stdout.split(/\r?\n/).filter(Boolean);
            if (!incoming.length) return;
            const untracked = new Set(spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: dir, encoding: 'utf8' })
                .stdout.split(/\r?\n/).filter(Boolean).map(p => p.replace(/\\/g, '/')));
            const clashes = incoming.filter(p => untracked.has(p));
            if (!clashes.length) return;
            const backupDir = path.join(PROJECT_DIR, '.tmp', 'untracked_backup_' + Date.now());
            for (const rel of clashes) {
                const src = path.join(dir, rel);
                const dst = path.join(backupDir, rel.split('/').join(path.sep));
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.renameSync(src, dst);
            }
            log(`🧹 Merge'i engelleyen ${clashes.length} untracked dosya .tmp\\${path.basename(backupDir)} altina tasindi.`);
        } catch (err) {
            log(`⚠️ Karantina adimi atlandi: ${err.message}`);
        }
    }

    // ============================================
    // PiCoding Update Handler (Git Pull)
    // ============================================
    ipcMain.handle('picoding-update', async () => {
        console.log('[IPC] picoding-update called');
        
        const logs = [];
        const log = (msg) => {
            logs.push(msg);
            console.log(`[UPDATE] ${msg}`);
        };
        
        try {
            const picodingDir = path.join(PROJECT_DIR, 'picoding');
            
            if (!fs.existsSync(picodingDir)) {
                return { success: false, message: `PiCoding dizini bulunamadı: ${picodingDir}`, logs };
            }
            
            log(`Starting PiCoding update...`);
            
            // 0) Yarim guncelleme artigi untracked dosyalar merge'i engellerse karantinaya al
            quarantineUntrackedOverwriteBlockers(picodingDir, log);
            
            // 1) Stash — local değişiklikleri geçici kaydet
            const stashCmd = process.platform === 'win32' ? 'cmd' : '/bin/sh';
            const stashArgs = process.platform === 'win32'
                ? ['/c', 'git', 'stash', 'save', 'auto-picoding-update-stash']
                : ['-c', 'git', 'stash', 'save', 'auto-picoding-update-stash'];
            
            return new Promise((resolve) => {
                const stashChild = require('child_process').spawn(stashCmd, stashArgs, {
                    cwd: picodingDir,
                    shell: true,
                    env: { ...process.env },
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                let stashStdout = '';
                let stashStderr = '';
                
                stashChild.stdout?.on('data', (data) => {
                    stashStdout += data.toString();
                });
                
                stashChild.stderr?.on('data', (data) => {
                    stashStderr += data.toString();
                });
                
                stashChild.on('close', (stashCode) => {
                    log(`Stash completed (code: ${stashCode})`);
                    
                    // 2) Git pull
                    const gitCmd = process.platform === 'win32' ? 'cmd' : '/bin/sh';
                    const gitArgs = process.platform === 'win32'
                        ? ['/c', 'git', 'pull']
                        : ['-c', 'git', 'pull'];
                    
                    const gitChild = require('child_process').spawn(gitCmd, gitArgs, {
                        cwd: picodingDir,
                        shell: true,
                        env: { ...process.env },
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                    
                    let pullStdout = '';
                    let pullStderr = '';
                    
                    gitChild.stdout?.on('data', (data) => {
                        const msg = data.toString();
                        pullStdout += msg;
                        log(msg.trim());
                    });
                    
                    gitChild.stderr?.on('data', (data) => {
                        const msg = data.toString();
                        pullStderr += msg;
                        log(`[ERROR] ${msg.trim()}`);
                    });
                    
                    gitChild.on('close', (pullCode) => {
                        if (pullCode !== 0) {
                            log(`❌ Pull failed (code: ${pullCode})`);
                            resolve({ success: false, message: `Update failed: ${pullStderr || 'Unknown error'}`, logs });
                            return;
                        }
                        
                        log(`✅ Pull successful! Syncing dependencies...`);
                        
                        // 3) Dependency sync — npm install (keeps picoding/node_modules aligned with package.json)
                        const npmCmd = process.platform === 'win32' ? 'cmd' : '/bin/sh';
                        const npmArgs = process.platform === 'win32'
                            ? ['/c', 'npm', 'install']
                            : ['-c', 'npm', 'install'];

                        const npmChild = require('child_process').spawn(npmCmd, npmArgs, {
                            cwd: picodingDir,
                            shell: true,
                            env: { ...process.env },
                            stdio: ['pipe', 'pipe', 'pipe']
                        });

                        let npmStdout = '';
                        let npmStderr = '';

                        // 4) Stash pop — npm install tamamlaninca calisir
                        const runStashPop = () => {
                        try {
                            const popCmd = process.platform === 'win32' ? 'cmd' : '/bin/sh';
                            const popArgs = process.platform === 'win32'
                                ? ['/c', 'git', 'stash', 'pop']
                                : ['-c', 'git', 'stash', 'pop'];
                            
                            const popChild = require('child_process').spawn(popCmd, popArgs, {
                                cwd: picodingDir,
                                shell: true,
                                env: { ...process.env },
                                stdio: ['pipe', 'pipe', 'pipe']
                            });
                            
                            popChild.on('close', (popCode) => {
                                if (popCode === 0) {
                                    log(`📦 Local changes restored.`);
                                } else {
                                    log(`⚠️ Could not restore stash (code: ${popCode}).`);
                                }
                                resolve({ success: true, message: `PiCoding updated successfully!`, logs });
                            });
                            
                            popChild.on('error', () => {
                                log(`⚠️ Stash pop failed.`);
                                resolve({ success: true, message: `PiCoding updated (stash pop skipped)!`, logs });
                            });
                        } catch (e) {
                            log(`⚠️ Stash pop exception: ${e.message}`);
                            resolve({ success: true, message: `PiCoding updated (stash pop skipped)!`, logs });
                        }
                        };

                        npmChild.stdout?.on('data', (data) => {
                            const msg = data.toString();
                            npmStdout += msg;
                            msg.split(/\r?\n/).forEach((line) => { if (line.trim()) log(line.trim()); });
                        });

                        npmChild.stderr?.on('data', (data) => {
                            const msg = data.toString();
                            npmStderr += msg;
                            msg.split(/\r?\n/).forEach((line) => { if (line.trim()) log(`[WARN] ${line.trim()}`); });
                        });

                        npmChild.on('close', (npmCode) => {
                            if (npmCode !== 0) {
                            log(`❌ npm install failed (code: ${npmCode})`);
                            resolve({ success: false, message: `Dependency sync failed: ${(npmStderr || npmStdout).trim().slice(-500)}`, logs });
                            return;
                            }
                            log(`✅ Dependencies synced.`);

                            // 3.5) Yerel compaction yamasi — taze npm install node_modules'u sifirladigi icin yeniden uygulanir
                            const patchScript = path.join(picodingDir, 'patches', 'apply-compaction-patch.js');
                            if (!fs.existsSync(patchScript)) {
                                log(`⚠️ Compaction patch script not found (skipped).`);
                                runStashPop();
                                return;
                            }
                            const patchChild = require('child_process').spawn(
                                process.platform === 'win32' ? 'node' : '/bin/sh',
                                process.platform === 'win32'
                                    ? ['patches/apply-compaction-patch.js']
                                    : ['-c', 'node patches/apply-compaction-patch.js'],
                                {
                                    cwd: picodingDir,
                                    shell: true,
                                    env: { ...process.env },
                                    stdio: ['pipe', 'pipe', 'pipe']
                                }
                            );
                            patchChild.stdout?.on('data', (data) => {
                                data.toString().split(/\r?\n/).forEach((line) => { if (line.trim()) log(`[PATCH] ${line.trim()}`); });
                            });
                            patchChild.stderr?.on('data', (data) => {
                                data.toString().split(/\r?\n/).forEach((line) => { if (line.trim()) log(`[PATCH][WARN] ${line.trim()}`); });
                            });
                            patchChild.on('close', (patchCode) => {
                                if (patchCode === 0) {
                                    log(`✅ Compaction patch applied.`);
                                } else {
                                    log(`⚠️ Compaction patch failed (code: ${patchCode}) — pi defaults ile calisacak.`);
                                }
                                runStashPop();
                            });
                            patchChild.on('error', (err) => {
                                log(`⚠️ Patch spawn error: ${err.message}`);
                                runStashPop();
                            });
                        });

                        npmChild.on('error', (err) => {
                            log(`npm spawn error: ${err.message}`);
                            resolve({ success: false, message: `npm install spawn error: ${err.message}`, logs });
                        });
                    });
                    
                    gitChild.on('error', (err) => {
                        log(`Spawn error: ${err.message}`);
                        resolve({ success: false, message: `Spawn error: ${err.message}`, logs });
                    });
                });
                
                stashChild.on('error', (err) => {
                    log(`Stash spawn error: ${err.message}`);
                    resolve({ success: false, message: `Stash error: ${err.message}`, logs });
                });
            });
            
        } catch (err) {
            log(`Exception: ${err.message}`);
            return { success: false, message: err.message, logs };
        }
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
                const trimmedLine = line.trim();
                
                const sectionMatch = trimmedLine.match(/^\[(.+)\]\s*$/);
                if (sectionMatch) {
                    currentSection = sectionMatch[1].trim();
                    console.log('[INI Parser] Found section:', currentSection);
                    continue;
                }

                if (line.startsWith('model') && line.includes('=')) {
                    const value = line.split('=')[1]?.trim()?.replace(/"/g, '');
                    // Her zaman ekle — hem HTTP URL hem yerel path
                    if (value) {
                        models.push({ 
                            name: currentSection, 
                            model_url: value,
                            is_local: !value.startsWith('http'),
                            local_path: value.startsWith('http') ? '' : value
                        });
                    }
                } else if (line.startsWith('mmproj') && line.includes('=')) {
                    const value = line.split('=')[1]?.trim()?.replace(/"/g, '');
                    if (models.length > 0) {
                        if (value) {
                            models[models.length - 1].mmproj_url = value;
                            models[models.length - 1].mmproj_is_local = !value.startsWith('http');
                        }
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

    // Model - Get URLs from model_urls.json
    ipcMain.handle('model-get-urls-from-json', async (event, iniName, sectionName) => {
        const urlsJsonPath = path.join(PROJECT_DIR, 'model_urls.json');
        const result = { model: '', mmproj: '', modelDraft: '' };

        if (!fs.existsSync(urlsJsonPath)) {
            console.error('[URLsJSON] model_urls.json not found at:', urlsJsonPath);
            return result;
        }

        try {
            const content = fs.readFileSync(urlsJsonPath, 'utf8');
            const allUrls = JSON.parse(content);

            // INI isminden 'gpu\d+' prefix'ini çıkar
            // gpu1vram6ram32models.ini → vram6ram32models.ini
            let jsonKey = iniName.replace(/^gpu\d+/, '');

            console.log(`[URLsJSON] Looking up: iniName=${iniName}, jsonKey=${jsonKey}, section=${sectionName}`);

            // Renderer zaten sadece -vision ile bitenleri geçiriyor, direkt kullan
            if (jsonKey in allUrls && sectionName in allUrls[jsonKey]) {
                const entry = allUrls[jsonKey][sectionName];
                if (typeof entry === 'object' && entry !== null) {
                    result.model = entry.model || '';
                    result.mmproj = entry.mmproj || '';
                    result.modelDraft = entry.modelDraft || '';
                } else if (typeof entry === 'string') {
                    result.model = entry;
                }
                console.log(`[URLsJSON] Found (${sectionName}): model=${result.model.substring(0, 50)}...`);
            } else {
                console.warn(`[URLsJSON] Not found: ${jsonKey}/${sectionName}`);
                if (!(jsonKey in allUrls)) {
                    console.warn(`[URLsJSON] Available keys:`, Object.keys(allUrls));
                } else {
                    console.warn(`[URLsJSON] Available sections:`, Object.keys(allUrls[jsonKey]));
                }
            }
        } catch (err) {
            console.error('[URLsJSON] Failed to parse:', err.message);
        }

        return result;
    });

    // ============================================
    // GUI model yonetimi: aktif INI bolumleri + model_urls.json
    // (preset-store.js modulu — minimal mudahale)
    // ============================================
    ipcMain.handle('preset-get-sections', async (event, iniName) => {
        try {
            presetStore.assertSafeIniName(iniName);
            const iniPath = path.join(PROJECT_DIR, iniName);
            if (!fs.existsSync(iniPath)) return { success: false, error: 'INI not found: ' + iniName };
            const sections = presetStore.listSections(iniPath);
            return { success: true, sections };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('preset-save-section', async (event, payload) => {
        try {
            const p = payload || {};
            presetStore.assertSafeIniName(p.iniName);
            const iniPath = path.join(PROJECT_DIR, p.iniName);
            const urlsJsonPath = path.join(PROJECT_DIR, 'model_urls.json');
            const res = presetStore.saveSection({
                iniPath: iniPath,
                urlsJsonPath: urlsJsonPath,
                iniName: p.iniName,
                sectionName: p.sectionName,
                modelUrl: p.modelUrl,
                mmprojUrl: p.mmprojUrl,
                modelDraftUrl: p.modelDraftUrl
            });
            return Object.assign({ success: true }, res);
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('preset-delete-section', async (event, iniName, sectionName) => {
        try {
            presetStore.assertSafeIniName(iniName);
            const iniPath = path.join(PROJECT_DIR, iniName);
            const urlsJsonPath = path.join(PROJECT_DIR, 'model_urls.json');
            const res = presetStore.deleteSection({ iniPath, urlsJsonPath, iniName, sectionName });
            return Object.assign({ success: true }, res);
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // URL saglik kontrolu (istek uzerine): once HEAD, gerekirse 1 bayt'lik GET
    async function probeUrl(url) {
        const baseHeaders = { 'User-Agent': 'LLM-Runner-AIO/1.0' };
        try {
            const resp = await fetch(url, { method: 'HEAD', headers: baseHeaders, signal: AbortSignal.timeout(10000), redirect: 'follow' });
            const len = resp.headers.get('content-length');
            if (resp.ok) return { url: url, ok: true, status: resp.status, size: len ? Number(len) : null };
            return { url: url, ok: false, status: resp.status, size: null };
        } catch (e1) {
            try {
                const resp2 = await fetch(url, { method: 'GET', headers: Object.assign({}, baseHeaders, { Range: 'bytes=0-0' }), signal: AbortSignal.timeout(10000), redirect: 'follow' });
                const cr = resp2.headers.get('content-range');
                const cl = resp2.headers.get('content-length');
                await resp2.text().catch(function () {});
                if (resp2.ok || resp2.status === 206) {
                    let size = null;
                    if (cr && cr.indexOf('/') >= 0) {
                        const t = Number(cr.split('/')[1]);
                        if (!isNaN(t) && t > 0) size = t;
                    } else if (cl) {
                        size = Number(cl);
                    }
                    return { url: url, ok: true, status: resp2.status, size: size };
                }
                return { url: url, ok: false, status: resp2.status, size: null };
            } catch (e2) {
                const nm = e2 && e2.name;
                return { url: url, ok: false, status: null, error: (nm === 'TimeoutError' || nm === 'AbortError') ? 'timeout' : 'unreachable' };
            }
        }
    }

    ipcMain.handle('ini-open-file', async (event, iniName) => {
        try {
            presetStore.assertSafeIniName(iniName);
            const full = path.join(PROJECT_DIR, String(iniName));
            if (!fs.existsSync(full)) throw new Error('Dosya bulunamadi: ' + String(iniName));
            const err = await shell.openPath(full);
            if (err) throw new Error(err);
            return { success: true };
        } catch (error) {
            console.error('[ini-open-file] Hata:', error.message);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('url-check', async (event, urls) => {
        const list = Array.isArray(urls) ? urls.filter(function (u) { return typeof u === 'string'; }).slice(0, 20) : [];
        const results = [];
        for (const u of list) {
            results.push(await probeUrl(u));
        }
        return { success: true, results: results };
    });


    // ============================================
    // NEW: Database Load Handler
    // PyQt6'da: _load_database() metodu
    // ============================================
    ipcMain.handle('db-load', async (event, dbFilePath) => {
        return loadDatabase(dbFilePath);
    });

    // Function import (HAT-03): preload'dan gelen cagri icin nazik yanit.
    // better-sqlite3 native modulu kurulu degilse 'unavailable' doner;
    // renderer tarafinda try/catch ile yakalanip log'a yazilir.
    ipcMain.handle('db-import-functions', async () => {
        try {
            require.resolve('better-sqlite3');
        } catch (e) {
            return { success: false, error: 'Database backend (better-sqlite3) not available on this machine' };
        }
        return { success: false, error: 'Function import is not implemented in the Electron port yet' };
    });

    // ============================================
    // Models Tab - PyQt6'daki models.py'nin IPC handler'lari
    // ============================================

    // Scan Models - models/ dizinini tara (.gguf dosyalari)
    // PyQt6'da: _scan_models() metodu
    ipcMain.handle('scan-models', async (event, modelsDir) => {
        // PyQt6: self._models_dir.mkdir(parents=True, exist_ok=True)
        if (!fs.existsSync(modelsDir)) {
            fs.mkdirSync(modelsDir, { recursive: true });
            return { files: [], totalSize: 0, count: 0 };
        }

        const ggufFiles = [];
        let totalSize = 0;

        function walk(currentDir, depth = 0) {
            if (depth > 10 || !fs.existsSync(currentDir)) {
                return;
            }

            const entries = fs.readdirSync(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    walk(fullPath, depth + 1);
                } else if (entry.isFile() && entry.name.endsWith('.gguf')) {
                    const stat = fs.statSync(fullPath);
                    const relPath = path.relative(modelsDir, fullPath);

                    ggufFiles.push({
                        name: entry.name,
                        path: fullPath,
                        size: stat.size,
                        relativePath: relPath,
                        modified: stat.mtime
                    });
                    totalSize += stat.size;
                }
            }
        }

        walk(modelsDir);

        // Alfabetik sirala (PyQt6'daki gibi)
        ggufFiles.sort((a, b) => a.name.localeCompare(b.name));

        const result = {
            files: ggufFiles,
            totalSize,
            count: ggufFiles.length
        };

        console.log(`[SCAN] Found ${result.count} GGUF files in ${modelsDir}`);

        return result;
    });

    // Delete Model - Model dosyasini sil
    // PyQt6'da: _delete_selected() metodu
    ipcMain.handle('model-delete', async (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) {
                console.warn('[DELETE] File not found:', filePath);
                return { success: false, error: 'File does not exist' };
            }

            const fileName = path.basename(filePath);
            const stat = fs.statSync(filePath);

            // Dosyayi sil
            fs.unlinkSync(filePath);

            console.log(`[DELETE] Deleted: ${fileName} (${formatBytes(stat.size)})`);

            return { success: true, deleted: fileName, size: stat.size };
        } catch (err) {
            console.error('[DELETE] Failed:', err.message);
            return { success: false, error: err.message };
        }
    });

    // Delete Multiple - Birden fazla modeli sil
    // PyQt6'da: _delete_selected() ile multi-selection
    ipcMain.handle('model-delete-multiple', async (event, filePaths) => {
        const results = { success: 0, errors: 0, deleted: [], failed: [] };

        for (const filePath of filePaths) {
            try {
                if (!fs.existsSync(filePath)) continue;

                const fileName = path.basename(filePath);
                fs.unlinkSync(filePath);
                results.success++;
                results.deleted.push(fileName);
            } catch (err) {
                results.errors++;
                results.failed.push({ path: filePath, error: err.message });
            }
        }

        console.log(`[DELETE-MULTIPLE] Success: ${results.success}, Errors: ${results.errors}`);
        return results;
    });

    // ============================================
    // NEW: SHA256 Model Verification
    // PyQt6'da: _calculate_sha256() + hash comparison
    // ============================================
    ipcMain.handle('model-verify-sha256', async (event, filePath, expectedHash) => {
        return verifyModelSHA256(filePath, expectedHash);
    });

    // NOT: mcp-update-advisor-file handler kaldırıldı
    // Artık picoding-save-advisor hem advisor_config.json hem de mcp_web_reader.py güncelliyor
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

    // RAM detection - Sistem toplam RAM'i
    const totalMemBytes = require('os').totalmem();
    result.ramGb = Math.round((totalMemBytes / (1024 * 1024 * 1024)) * 10) / 10;
    
    // Mantisal islemci sayisi (Task Manager "processors") — CPU Threads otomatik hesabi icin
    result.cpuThreads = require('os').cpus().length;

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

    // INI Config Eşleştirme - GPU'ya göre otomatik config seç
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
                let vramDiff = Infinity;

                // GPU adı içinde ini dosyası varsa yüksek skor
                if (gpuNameLower.includes(ini.toLowerCase().split('.')[0])) {
                    score += 10;
                }

                // VRAM'e en yakın INI'yı seç - her iki taraf da GB cinsinden
                const vramMatch = ini.match(/vram(\d+)/);
                if (vramMatch) {
                    const iniVram = parseInt(vramMatch[1]);
                    vramDiff = Math.abs(result.vramGb - iniVram); // GB vs GB

                    // Tam eşleşme: çok yüksek skor
                    if (vramDiff <= 0.5) { // ±0.5GB tolerans = tam eşleşme
                        score += 100;
                    } else if (vramDiff <= 2) { // ±2GB tolerans
                        score += Math.max(0, 20 - (vramDiff * 10)); // Yakınlık skoru
                    }
                }

                // RAM de kontrol et (eğer INI'da ram varsa)
                const ramMatch = ini.match(/ram(\d+)/);
                if (ramMatch && result.ramGb > 0) {
                    const iniRam = parseInt(ramMatch[1]);
                    const ramDiff = Math.abs(result.ramGb - iniRam);
                    if (ramDiff <= 4) { // ±4GB RAM tolerans
                        score += Math.max(0, 5 - ramDiff);
                    }
                }

                if (score > bestScore || (score === bestScore && vramDiff < Infinity)) {
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
// Translation Helper
// ============================================
async function getTranslation(langCode, key, params = {}) {
    const langPath = path.join(SRC_DIR, 'lang', `${langCode}.json`);
    let strings = null;
    
    try {
        if (fs.existsSync(langPath)) {
            strings = JSON.parse(fs.readFileSync(langPath, 'utf8'));
        }
    } catch (e) {
        // Dil dosyasi okunamazsa English kullan
    }
    
    // Dil dosyasi yoksa veya key bulunamadiysa English'e yuvarlan
    if (!strings || !strings[key]) {
        const enPath = path.join(SRC_DIR, 'lang', 'en.json');
        try {
            const enStrings = JSON.parse(fs.readFileSync(enPath, 'utf8'));
            strings = enStrings;
        } catch (_) {
            return `[${key}]`;  // Fallback
        }
    }
    
    let msg = strings[key] || `{${key}}`;
    
    // {param} formatındaki yer tutucuları doldur
    for (const [k, v] of Object.entries(params)) {
        msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return msg;
}

// ============================================
// Server Management (psutil yerine child_process + tree-kill)
// ============================================
const runningServers = new Map(); // serverType → { child, port }

// ============================================
// Wan2GP yardımcıları (video üretimi servisi)
// ============================================
const WAN2GP_REPO_URL = 'https://github.com/deepbeepmeep/Wan2GP.git';
const WAN2GP_DIR = path.join(PROJECT_DIR, 'Wan2GP');
const WAN2GP_VENV_DIR = path.join(PROJECT_DIR, 'venvs', 'wan2gp');
const WAN2GP_PRESETS_DIR = path.join(PROJECT_DIR, 'wan2gp-presets');
let wan2gpSetupRunning = false;

// Kurucu (installer) servis klasorlerini .git olmadan tasirabilir.
// Update butonu boyle bir klasore rastlayinca buradaki remote ile git'i icine kurar.
const SERVER_GIT_REMOTES = {
    openwebui: { url: 'https://github.com/open-webui/open-webui.git', branch: 'main' },
    searxng: { url: 'https://github.com/searxng/searxng.git', branch: 'master' }
};

/**
 * Wan2GP için sistem Python'unu bulur (3.11 tercih edilir).
 * @returns {{cmd:string, args:string[]}} ör. { cmd: 'py', args: ['-3.11'] }
 */
function findWan2gpPython() {
    const candidates = [
        { cmd: 'py', args: ['-3.11'] },
        { cmd: 'py', args: ['-3'] },
        { cmd: 'python', args: [] }
    ];
    for (const cand of candidates) {
        try {
            const res = spawnSync(cand.cmd, cand.args.concat(['-c', 'import sys;print("%d.%d" % sys.version_info[:2])']), { encoding: 'utf8', timeout: 10000 });
            const out = (res.stdout || '').trim();
            if (/^\d+\.\d+$/.test(out)) {
                if (!out.startsWith('3.11')) {
                    console.warn('[WAN2GP] Tercih edilen Python 3.11, bulunan ' + out + ' — devam ediliyor.');
                }
                return cand;
            }
        } catch {}
    }
    throw new Error('Uygun Python bulunamadı. Önce Python 3.11 kurun.');
}

/**
 * Komutu çalıştırır, çıktı satırlarını `send` ile akıtarak bekler.
 * Başarısız olursa son satırları içeren hata fırlatır.
 */
async function runWan2gpStreaming(commandArgs, send) {
    return new Promise((resolve, reject) => {
        const child = spawn(commandArgs[0], commandArgs.slice(1), { cwd: PROJECT_DIR, windowsHide: true });
        let tailOut = '';
        let tailErr = '';
        const forward = (chunk) => {
            chunk.toString().split(/\r?\n/).forEach(line => {
                if (line.trim()) send(line);
            });
        };
        child.stdout.on('data', d => { tailOut += d.toString(); if (tailOut.length > 20000) tailOut = tailOut.slice(-10000); forward(d); });
        child.stderr.on('data', d => { tailErr += d.toString(); if (tailErr.length > 20000) tailErr = tailErr.slice(-10000); forward(d); });
        child.on('error', (err) => reject(new Error('Launch failed: ' + err.message)));
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else {
                const detail = (tailErr || tailOut).split(/\r?\n/).slice(-15).join('\n') || 'no output';
                reject(new Error('Process exited with code ' + code + '. Last lines:\n' + detail));
            }
        });
    });
}

// Komut ciktisini yakalar (sonuc incelenmesi gerekince, orn. stash olusturuldu mu tespiti)
function runWan2gpCapture(commandArgs) {
    return new Promise((resolve) => {
        const child = spawn(commandArgs[0], commandArgs.slice(1), { cwd: PROJECT_DIR, windowsHide: true });
        let out = '';
        let errOut = '';
        child.stdout.on('data', d => { out += d.toString(); });
        child.stderr.on('data', d => { errOut += d.toString(); });
        child.on('error', (err) => resolve({ code: 1, out: err.message }));
        child.on('exit', (code) => resolve({ code, out: (out + errOut).trim() }));
    });
}

async function startServer(serverType, options = {}) {
    // Strata: kendi gateway mantigi strata.js modülünde yönetilir.
    if (serverType === 'strata') return await strata.startGateway();

    const port = options.port || 8080;
    const host = options.host || '0.0.0.0';
    const lang = options.language || 'en';
    let env = null;

    // Port kontrolü
    const isPortInUse = await checkPortInUse(port);
    if (isPortInUse) {
        const t = await getTranslation(lang, 'error_port_busy_msg', { port });
        return { success: false, error: t };
    }

    let cmd, args, cwd;

    switch (serverType) {
        case 'searxng': {
            let searxngPort = port;
            // PyQt6'daki SearXNGWorker ile birebir aynı mantık
            const venvPython = path.join(PROJECT_DIR, 'venv', 'Scripts', 'python.exe');
            const searxDir = path.join(PROJECT_DIR, 'searxng');
            const settingsFile = path.join(searxDir, 'searx-data', 'settings.yml');
            
            if (!fs.existsSync(venvPython)) {
                return { success: false, error: `venv\\Scripts\\python.exe bulunamadı: ${venvPython}` };
            }
            
            // Port ve bind_address'i settings.yml'ye yaz (PyQt6 yaml yaklaşımı)
            try {
                let settingsContent = '';
                if (fs.existsSync(settingsFile)) {
                    settingsContent = fs.readFileSync(settingsFile, 'utf8');
                }
                
                // Satır bazlı YAML parser — server section'ı bul ve güncelle
                const lines = settingsContent.split('\n');
                let inServerSection = false;
                let serverSectionFound = false;
                const newLines = [];
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    
                    // server: satırını bul
                    if (/^server:\s*$/.test(line.trim())) {
                        inServerSection = true;
                        serverSectionFound = true;
                        newLines.push(line);
                        continue;
                    }
                    
                    // Server section içinde miyiz?
                    if (inServerSection) {
                        // Server section bitti mi? (daha az girintili veya boş satır)
                        if ((line.trim() === '' || /^\w/.test(line.trim())) && !/^\s+(port|bind_address|image_proxy|secret_key)/.test(line)) {
                            inServerSection = false;
                            newLines.push(line);
                            continue;
                        }
                        
                        // Mevcut port/bind satırlarını atla (güncellenecek)
                        if (/^\s+port:\s*/.test(line)) {
                            newLines.push(`  port: ${port}`);
                            continue;
                        }
                        if (/^\s+bind_address:\s*/.test(line)) {
                            newLines.push(`  bind_address: ${host}`);
                            continue;
                        }
                        
                        // Diğer server section satırlarını koru
                        newLines.push(line);
                        continue;
                    }
                    
                    // Server section dışındaki satırları olduğu gibi ekle
                    newLines.push(line);
                }
                
                // Server section hiç bulunamadıysa ekle
                if (!serverSectionFound) {
                    newLines.push('');
                    newLines.push('server:');
                    newLines.push(`  bind_address: ${host}`);
                    newLines.push(`  port: ${port}`);
                }
                
                fs.writeFileSync(settingsFile, newLines.join('\n'), 'utf8');
                console.log(`[CONFIG] Settings.yml updated: port=${port}, bind=${host}`);
            } catch (e) {
                console.warn(`[WARN] Could not update settings.yml: ${e.message}`);
            }
            
            // Environment ayarla (PyQt6 ile aynı)
            env = {
                ...process.env,
                'SEARXNG_SETTINGS_PATH': settingsFile,
                'PYTHONPATH': searxDir + (process.env.PYTHONPATH ? ':' + process.env.PYTHONPATH : '')
            };
            
            cmd = venvPython;
            args = ['-m', 'searx.webapp'];
            cwd = searxDir;
            break;
        }

        case 'openwebui': {
            let openwebuiPort = port;
            // PyQt6'daki OpenWebUIWorker ile birebir aynı mantık
            const venvPython = path.join(PROJECT_DIR, 'venv', 'Scripts', 'python.exe');
            const openwebuiDir = path.join(PROJECT_DIR, 'openwebui');
            const backendDir = path.join(openwebuiDir, 'backend');
            
            if (!fs.existsSync(venvPython)) {
                return { success: false, error: `venv\\Scripts\\python.exe bulunamadı: ${venvPython}` };
            }
            
            // WEBUI_SECRET_KEY oluştur
            const secretKeyPath = path.join(PROJECT_DIR, '.webui_secret_key');
            let secretKey = '';
            if (!fs.existsSync(secretKeyPath)) {
                const crypto = require('crypto');
                secretKey = crypto.randomBytes(32).toString('hex');
                fs.writeFileSync(secretKeyPath, secretKey);
            } else {
                secretKey = fs.readFileSync(secretKeyPath, 'utf8').trim();
            }
            
            // Environment ayarla (PyQt6 ile aynı)
            env = {
                ...process.env,
                'PORT': String(port),
                'HOST': host,
                'UVICORN_WORKERS': String(options.threads || 4),
                'DATABASE_URL': `sqlite:///${path.join(openwebuiDir, 'openwebui.db')}`,
                'WEBUI_SECRET_KEY': secretKey,
                'ENABLE_WEB_SEARCH': 'True',
                'WEB_SEARCH_ENGINE': 'searxng',
                'SEARXNG_QUERY_URL': `http://localhost:8080/search?q=<query>`,
                'BYPASS_WEB_SEARCH_EMBEDDING_AND_RETRIEVAL': 'True',
                'BYPASS_WEB_SEARCH_WEB_LOADER': 'True',
                'OPENAI_API_BASE_URL': 'http://localhost:1234/v1',
                'OPENAI_API_KEY': 'sk-no-key-required',
                'ENABLE_OLLAMA_API': 'False',
                'ENABLE_SIGNUP': 'True',
                'ENABLE_LOGIN_FORM': 'True'
            };
            
            // FRONTEND_BUILD_DIR (varsa)
            const frontendBuildDir = path.join(openwebuiDir, 'build');
            if (fs.existsSync(frontendBuildDir)) {
                env['FRONTEND_BUILD_DIR'] = frontendBuildDir;
            }
            
            // PYTHONPATH — backend dizinini ekle
            if (fs.existsSync(backendDir)) {
                env['PYTHONPATH'] = backendDir + (process.env.PYTHONPATH ? ':' + process.env.PYTHONPATH : '');
            }
            
            // Doğrudan uvicorn command'ı (PyQt6 ile aynı python -c formatı)
            cmd = venvPython;
            args = [
                '-c',
                `import sys; sys.path.insert(0, r'${backendDir}'); import uvicorn; uvicorn.run('open_webui.main:app', host='${host}', port=${port}, forwarded_allow_ips='*', ws='auto')`
            ];
            cwd = openwebuiDir;
            break;
        }

        case 'llamacpp': {
            let llamaPort = port;
            const llamaServer = path.join(PROJECT_DIR, 'llama.cpp-cuda13+vulkan', 'llama-server.exe');
            
            if (!fs.existsSync(llamaServer)) {
                return { success: false, error: `llama-server.exe bulunamadı: ${llamaServer}` };
            }
            
            // PyQt6'da INI seçilmemişse hata veriyor
            if (!options.iniPreset) {
                return { success: false, error: 'Lütfen bir INI preset seçin.' };
            }
            
            const iniFile = options.iniPreset;
            const baseName = iniFile.replace('models.ini', '').replace('.ini', '');
            const batName = `start_${baseName}.bat`;
            const batPath = path.join(PROJECT_DIR, batName);
            const threads = options.threads || 10;
            const parallel = options.parallel || 1;
            const sleepIdle = options.sleepIdle || 1000;
            const maxModel = options.maxModel || 1;
            
            // Mutlak yollar — INI ve exe her zaman PROJECT_DIR'de
            const absoluteIniPath = path.join(PROJECT_DIR, iniFile);
            const absoluteLlamaServer = path.join(PROJECT_DIR, 'llama.cpp-cuda13+vulkan', 'llama-server.exe');
            
            // .bat icerigi — temiz format, mutlak yollar kullanir
            const batContent = `@echo off
title llama.cpp (${iniFile})
color 0a

cd /d "%~dp0"
"${absoluteLlamaServer}" ^
  --host ${host} ^
  --port ${port} ^
  --threads ${threads} ^
  --parallel ${parallel} ^
  --sleep-idle-seconds ${sleepIdle} ^
  --models-max ${maxModel} ^
  --models-preset "${absoluteIniPath}" ^
  --jinja

pause
`;
            
            fs.writeFileSync(batPath, batContent, 'utf8');
            console.log(`[CONFIG] Bat file created: ${batName}`);
            console.log(`[CONFIG] INI (mutlak): ${absoluteIniPath}`);
            console.log(`[CONFIG] Port: ${port}`);
            
            // PyQt6'daki start_process() ile ayni: shell=True for .bat/.cmd
            cmd = batPath;
            args = [];
            cwd = PROJECT_DIR;
            break;
        }

        case 'vane': {
            // PyQt6'daki VaneWorker ile birebir aynı mantık
            const vaneDir = path.join(PROJECT_DIR, 'Vane');
            
            // .next klasörünü temizle (Turbopack junction fix)
            const nextDir = path.join(vaneDir, '.next');
            if (fs.existsSync(nextDir)) {
                try {
                    fs.rmSync(nextDir, { recursive: true, force: true });
                    console.log('[CLEAN] .next directory cleaned (Turbopack junction fix)');
                } catch (e) {
                    console.warn(`[WARN] Could not clean .next: ${e.message}`);
                }
            }
            
            // Port 3000 ise OpenWebUI çakışmasını önle
            let vanePort = port;
            if (vanePort === 3000) {
                vanePort = 3001;
                console.log('[WARN] Port 3000 is used by OpenWebUI, switching to 3001');
            }
            
            // Node.js PATH'ten bul
            let nodePath = null;
            try {
                const whereOutput = execSync('where node', { encoding: 'utf8', timeout: 2000 }).trim();
                if (whereOutput) {
                    nodePath = whereOutput.split('\n')[0];
                    console.log(`[START] Node.js found: ${nodePath}`);
                }
            } catch (e) {
                console.error('[ERROR] Node.js bulunamadı! Lütfen Node.js kurun.');
                return { success: false, error: 'Node.js bulunamadı! Lütfen https://nodejs.org/ adresinden kurun.' };
            }
            
            // SEARXNG_API_URL env değişkeni (eğer SearXNG çalışıyorsa)
            // Next.js dev server HOSTNAME env var'ini kullanir (HOST degil!)
            const searxngUrl = `http://127.0.0.1:${options.searxngPort || 8080}`;
            env = {
                ...process.env,
                'SEARXNG_API_URL': searxngUrl,
                'PORT': String(vanePort),
                'HOSTNAME': host   // Next.js bu variable'i okur
            };
            
            // CONFIG_PATH — Vane'in kendi config.json'ı varsa kullan (PyQt6 parity)
            const vaneConfigPath = path.join(vaneDir, 'config.json');
            if (fs.existsSync(vaneConfigPath)) {
                env['CONFIG_PATH'] = vaneConfigPath;
                console.log(`[CONFIG] Vane config.json found: ${vaneConfigPath}`);
            }
            
            // next.config.mjs'i runtime'da güncelle — host'a göre CORS ayarla
            const nextConfigPath = path.join(vaneDir, 'next.config.mjs');
            if (fs.existsSync(nextConfigPath)) {
                let isLocalOnly = (host === '127.0.0.1' || host === 'localhost');
                let configContent;
                
                if (isLocalOnly) {
                    // This PC Only — sadece localhost erişebilir
                    console.log(`[VANE] Config: This PC Only mode (localhost)`);
                    configContent = `
import pkg from './package.json' with { type: 'json' };

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    remotePatterns: [
      {
        hostname: 's2.googleusercontent.com',
      },
    ],
  },
  serverExternalPackages: [
    'pdf-parse',
    'playwright',
    'officeparser',
    'file-type',
  ],
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      './node_modules/@napi-rs/canvas-linux-x64-musl/**',
    ],
  },
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
`;
                } else {
                    // Local Network — tüm ağ erişimi
                    console.log(`[VANE] Config: Local Network mode (all origins)`);
                    configContent = `
import path from 'node:path';
import pkg from './package.json' with { type: 'json' };

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost', '*', '192.168.*.*', '10.*.*.*', '172.16.*.*'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET,OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: '*',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        hostname: 's2.googleusercontent.com',
      },
    ],
  },
  serverExternalPackages: [
    'pdf-parse',
    'playwright',
    'officeparser',
    'file-type',
  ],
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      './node_modules/@napi-rs/canvas-linux-x64-musl/**',
    ],
  },
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
`;
                }
                
                fs.writeFileSync(nextConfigPath, configContent);
                console.log(`[VANE] next.config.mjs updated for host: ${host}`);
            }
            
            // npm'yi shell:true ile çalıştır — boşluklu path sorunu olmaması icin
            cmd = 'npm';
            args = ['run', 'dev', '--', '-p', String(vanePort)];
            cwd = vaneDir;
            let useShell = true;  // Windows'ta npm.cmd icin shell:true gerekli
            break;
        }

        case 'wan2gp': {
            const wan2gpPort = port;
            const wgpVenvPy = path.join(WAN2GP_VENV_DIR, 'Scripts', 'python.exe');
            if (!fs.existsSync(wgpVenvPy)) {
                return { success: false, error: 'Wan2GP environment is not ready. Run setup first.' };
            }
            if (!fs.existsSync(path.join(WAN2GP_DIR, 'wgp.py'))) {
                return { success: false, error: 'Wan2GP source files not found. Run setup first.' };
            }
            // Setup/update flag kontrolü — işlem devam ediyorsa başlatma engellenir
            if (wan2gpSetupRunning) {
                return { success: false, error: 'Wan2GP kürüm/güncelleme işleminin tamamlanması bekleniyor. Lütfen bekleyip tekrar deneyin.' };
            }
            // Ön-bakım: sanal ortamın ana modüllerini (torch, mmgp) içerip içermeyenini dogrula
            const checkResult = spawnSync(wgpVenvPy, ['-c', 'import torch; import mmgp'], { cwd: WAN2GP_DIR, timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
            if (checkResult.status !== 0) {
                const stderr = (checkResult.stderr || Buffer.from('')).toString().trim();
                return { success: false, error: 'Wan2GP ortamı hazır değil — ana modüller (torch, mmgp) sanal ortama yüklenmemiş. Kurulum logunda hata var mı diye kontrol edin ve gerekirse Setup’u yeniden çalıştırın.\n' + stderr };
            }
            cmd = wgpVenvPy;
            args = [path.join(WAN2GP_DIR, 'wgp.py')];
            cwd = WAN2GP_DIR;
            env = { ...process.env, SERVER_PORT: String(wan2gpPort), SERVER_NAME: host };
            break;
        }
        default:
            return { success: false, error: `Unknown server type: ${serverType}` };
    }

    try {
        // PyQt6'daki start_process() ile ayni mantik:
        // .bat/.cmd/npm/npx icin shell=True gerekli
        let finalCmd = cmd;
        let finalArgs = args ? [...args] : [];
        // .bat/.cmd dosyalari icin shell:true gerekli (Windows)
        let useShell = (typeof cmd === 'string' && (cmd.endsWith('.bat') || cmd.endsWith('.cmd') || cmd === 'npm' || cmd === 'npx'));
        
        console.log(`[SPAWN] cmd=${finalCmd}, args=[${finalArgs.join(', ')}], cwd=${cwd}, shell=${useShell}`);
        
        const child = spawn(finalCmd, finalArgs, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: env || { ...process.env },
            shell: useShell,
            windowsHide: false
        });

        // Port bilgisini de sakla — stopServer icin gerekli
        let effectivePort = port;
        if (typeof vanePort !== 'undefined') effectivePort = vanePort;
        else if (typeof openwebuiPort !== 'undefined' && openwebuiPort !== null) effectivePort = openwebuiPort;
        else if (typeof searxngPort !== 'undefined' && searxngPort !== null) effectivePort = searxngPort;
        else if (typeof llamaPort !== 'undefined' && llamaPort !== null) effectivePort = llamaPort;
        else if (typeof wan2gpPort !== 'undefined') effectivePort = wan2gpPort;
        
        runningServers.set(serverType, { child, port: effectivePort });
        
        // PID kontrolü — shell:true kullanildiğinde undefined olabilir
        try { console.log(`[SPAWN] Child PID: ${child.pid}`); } catch {}

        // Erken olum ve hata tanisi izleme
        let childExited = false;
        let stderrTail = '';

        // stdout/stderr stream'lerini dinle (EPIPE hatasini yont)
        child.stdout?.on('data', (data) => {
            try {
                const message = data.toString();
                    safeSend('server-log', { type: serverType, message });
                console.log(`[${serverType.toUpperCase()}] ${message.trim()}`);
            } catch {}
        }).on('error', () => {});

        child.stderr?.on('data', (data) => {
            try {
                const message = data.toString();
                stderrTail += message;
                if (stderrTail.length > 8000) stderrTail = stderrTail.slice(-8000);
                    safeSend('server-error', { type: serverType, message });
                console.error(`[${serverType.toUpperCase()} ERROR] ${message.trim()}`);
            } catch {}
        }).on('error', () => {});

        child.on('error', (err) => {
            console.error(`[${serverType}] Spawn error:`, err.message);
            runningServers.delete(serverType);
            return { success: false, error: err.message };
        });

        child.on('exit', (code, signal) => {
            try {
                console.log(`[${serverType}] Exited with code ${code}, signal ${signal}`);
                childExited = true;
                runningServers.delete(serverType);
                setServerState(serverType, false);
            } catch {}
        });

        // Health check'a kadar bekle — surec erken olerse hemen basarisiz don
        const readyTimeoutMs = serverType === 'wan2gp' ? 300000 : 60000;
        const ready = await waitUntilReadyOrExit(port, readyTimeoutMs, () => childExited);
        if (!ready) {
            const diag = stderrTail.trim().slice(-2000);
            try { child.kill(); } catch (e) {}
            setServerState(serverType, false);
            const errText = `${serverType} hazir olmadi (${readyTimeoutMs / 1000} sn icinde port ${port} dinlemeye gecmedi).`
                + (diag ? `\nSon hata ciktilari:\n${diag}` : '');
            console.error(`[${serverType}] Start failed: ${errText}`);
            return { success: false, error: errText };
        }

        // Single Source of Truth ile state güncelle
        setServerState(serverType, true, port);
        
        return { success: true, pid: child.pid, port };
    } catch (err) {
        console.error(`[${serverType}] Start failed:`, err.message);
        return { success: false, error: err.message };
    }
}

async function stopServer(serverType) {
    if (serverType === 'strata') return strata.stopGateway();

    // Server bilgilerini Map'ten al (child + port)
    const serverInfo = runningServers.get(serverType);
    const child = serverInfo?.child;
    let vanePort = serverInfo?.port || 3001;

    // llamacpp özelinde: PowerShell ile tüm llama-server.exe PIDs bul ve öldür
    if (serverType === 'llamacpp') {
        try {
            const rootPid = child?.pid;
            
            // PowerShell ile llama-server.exe processlerini bul ve öldür
            const psCmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object {$_.Name -eq \'llama-server.exe\'} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"';
            
            execSync(psCmd, { encoding: 'utf8', timeout: 5000 });
            
            // cmd.exe wrapper da kaldıysa öldür
            if (rootPid && rootPid !== process.pid && rootPid !== process.ppid) {
                try {
                    execSync('taskkill /PID ' + rootPid + ' /T /F', { timeout: 5000 });
                    console.log('[STOP] Killed cmd.exe wrapper PID ' + rootPid);
                } catch (e) {
                        console.warn('[STOP] Could not kill cmd.exe PID ' + rootPid + ': ' + e.message);
                }
            }
            
            runningServers.delete(serverType);
            setServerState(serverType, false);
            return { success: true, method: 'powerShell' };
        } catch (e) {
            console.warn('[STOP] PowerShell kill failed: ' + e.message);
        }
    }

    // vane özelinde: netstat ile portu dinleyen node process'lerini öldür (PyQt6 parity)
    // shell:true ile spawn edildigi icin child.pid undefined olabilir — netstat kullanmak en güvenilir yontem
    if (serverType === 'vane') {
        try {
            console.log(`[STOP] ===== Vane Stop Starting on port ${vanePort} =====`);
            
            // Direkt kill — SADECE pid varsa dene (shell:true ile undefined olabilir!)
            if (child && !child.killed && child.pid) {
                try {
                    execSync('taskkill /F /T /PID ' + child.pid, { encoding: 'utf8', timeout: 5000 });
                    console.log('[STOP] Killed Vane direct PID ' + child.pid);
                } catch (e) {
                    console.warn('[STOP] Direct kill failed for PID ' + child.pid + ': ' + e.message);
                }
            } else {
                console.log('[STOP] No direct PID available (shell:true spawned), using netstat fallback');
            }
            
            // Portu dinleyen tüm node process'lerini öldür (netstat ile)
            const netstatOutput = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
            console.log(`[STOP] netstat output for port ${vanePort}:`);
            
            let killedCount = 0;
            const lines = netstatOutput.split('\n');
            for (const line of lines) {
                if (line.includes(':' + vanePort) && line.includes('LISTENING')) {
                    console.log(`[STOP] Found matching line: ${line.trim()}`);
                    const parts = line.trim().split(/\s+/);
                    if (parts.length > 4 && !isNaN(parts[4])) {
                        const pid = parseInt(parts[4]);
                        if (pid && pid !== 4 && pid !== process.pid) {
                            try {
                                execSync('taskkill /F /PID ' + pid, { encoding: 'utf8', timeout: 5000 });
                                killedCount++;
                                console.log(`[STOP] ✅ Killed Vane node PID ${pid} via netstat`);
                            } catch (e) {
                                console.error(`[STOP] ❌ Could not kill Vane PID ${pid}: ${e.message}`);
                            }
                        } else {
                            console.log(`[STOP] Skipping PID ${pid} (system or self)`);
                        }
                    }
                }
            }
            
            if (killedCount === 0) {
                console.warn(`[STOP] ⚠️ No Vane processes found to kill on port ${vanePort}`);
            } else {
                console.log(`[STOP] ✅ Successfully killed ${killedCount} process(es)`);
            }
            
            runningServers.delete(serverType);
            setServerState(serverType, false);
            return { success: true, method: 'netstat', killed: killedCount };
        } catch (e) {
            console.error(`[STOP] ❌ Vane kill failed with error: ${e.message}`);
            runningServers.delete(serverType);
            setServerState(serverType, false);
            return { success: false, error: e.message, method: 'vane-fallback' };
        }
    }

    // Graceful shutdown → force kill fallback
    if (!child) {
        console.warn(`[${serverType}] No child process found for stop`);
        runningServers.delete(serverType);
        setServerState(serverType, false);
        return { success: false, error: 'No running process found' };
    }
    
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
        setServerState(serverType, false);
        return { success: true };
    } catch (err) {
        console.error(`[${serverType}] Stop failed:`, err.message);
        runningServers.delete(serverType);
        setServerState(serverType, false);
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

/**
 * Port acilir veya cocuk surec oler mi diye yarisiyor.
 * Surec erken oledigonde (import hatasi, port cakismasi vb.) beklemeyi keser.
 */
function waitUntilReadyOrExit(port, timeoutMs, isDead) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
            if (settled) return;
            settled = true;
            clearInterval(iv);
            clearTimeout(timer);
            resolve(ok);
        };
        const iv = setInterval(() => {
            if (isDead()) { finish(false); return; }
            checkPortInUse(port).then(inUse => { if (inUse) finish(true); });
        }, 1000);
        const timer = setTimeout(async () => {
            finish(await checkPortInUse(port));
        }, timeoutMs);
    });
}

// Indirme sabitleri (HAT-08/HAT-24)
const DOWNLOAD_OVERALL_TIMEOUT_MS = 30 * 60 * 1000; // Dosya basina genel son tarih (30 dk)
const IDLE_TIMEOUT_MS = 60 * 1000;                  // 60 sn veri gelmezse kes
const MAX_DOWNLOAD_RETRIES = 3;                     // Basarisiz deneme sonrasi tekrar sayisi

/**
 * Tek denemelik indirme (resume destekli). Basari durumunda .part dosyasi
 * hedef konuma tasinir. Basarida/kesilmede hata firlatir; retry disarda yapilir.
 */
function pipeToDisk(response, destFolder, partialPath, taskId, baseBytes, totalBytes, controller, overallTimer) {
    return new Promise((resolve, reject) => {
        let downloaded = baseBytes;
        let lastActivity = Date.now();
        let settled = false;

        const settle = (fn, val) => {
            if (settled) return;
            settled = true;
            clearInterval(idleCheck);
            clearTimeout(overallTimer);
            fn(val);
        };

        const fileStream = fs.createWriteStream(partialPath, { flags: baseBytes > 0 ? 'a' : 'w' });

        // Idle kontrolu: sure boyunca veri gelmezse kes (HAT-08)
        const idleCheck = setInterval(() => {
            if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
                try { controller.abort(); } catch (e) {}
                settle(reject, new Error('Idle timeout: no data received for 60s'));
            }
        }, 5000);

        // Veri akisini diske borula (backpressure otomatik yonetilir).
        // Not: sadece sayac tutmak dosya yazdirmanin yerine gegmez (7a7498f'de kaybolmustu).
        response.body.pipe(fileStream);

        // Metrik dinleyici (veri akisini bozmaz, pipe ile birlikte calisir)
        response.body.on('data', (chunk) => {
            lastActivity = Date.now();
            downloaded += chunk.length;
            if (totalBytes > 0) {
                const percent = Math.min(100, Math.round((downloaded / totalBytes) * 100));
                safeSend('download-progress', { taskId, percent, downloaded, total: totalBytes });
            }
        });

        fileStream.on('finish', () => {
            fileStream.close();
            try {
                if (fs.existsSync(destFolder)) fs.unlinkSync(destFolder);
                fs.renameSync(partialPath, destFolder);
            } catch (renameErr) {
                settle(reject, new Error('Rename failed: ' + renameErr.message));
                return;
            }
            settle(resolve, { success: true, path: destFolder });
        });

        fileStream.on('error', (err) => settle(reject, err));
        response.body.on('error', (err) => settle(reject, err));
        response.body.on('close', () => {
            if (settled) return;
            // Normal bitiste 'close' bazen disk flush'u ('finish')den once gelebilir.
            // Tum veri geldiyse rename yapan 'finish' eventini beklet; aksi halde kesinti say.
            const complete = totalBytes > 0 && downloaded >= totalBytes;
            if (!complete) {
                try { fileStream.destroy(); } catch (e) {}
                settle(reject, new Error('Download stream closed unexpectedly'));
            }
        });
    });
}

async function downloadAttempt(fetchImpl, url, destFolder, partialPath, taskId, deadline) {
    const existing = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
    const remainingMs = Math.max(5000, deadline - Date.now());

    const doFetch = (headers) => {
        const controller = new AbortController();
        const overallTimer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, remainingMs);
        return fetchImpl(url, { headers, signal: controller.signal })
            .then((resp) => ({ resp, controller, overallTimer }))
            .catch((err) => { clearTimeout(overallTimer); throw err; });
    };

    let { resp, controller, overallTimer } = await doFetch(existing > 0 ? { 'Range': `bytes=${existing}-` } : {});

    // Sunucu Range'i desteklemiyor (206 yerine 200) → sifirdan basla (HAT-24)
    if (existing > 0 && resp.status === 200) {
        try { controller.abort(); } catch (e) {}
        clearTimeout(overallTimer);
        fs.rmSync(partialPath, { force: true });
        ({ resp, controller, overallTimer } = await doFetch({}));
    }

    // 416: .part dosyasi uzak dosyayla ayni buyuklukte veya daha buyuk — onceki deneme
    // yazimi tamamlamis ama rename'e ulasamamis olabilir. Tamamsa yalnizca tasi,
    // degismisse sifirdan baslat.
    if (resp.status === 416) {
        let remoteTotal = parseInt(resp.headers.get('content-length') || '0', 10);
        if (!(remoteTotal > 0)) {
            // Bazi sunucular 416'da yalnizca 'Content-Range: bytes */<toplam>' gonderir
            const cr = /^bytes \*\/(\d+)$/.exec(resp.headers.get('content-range') || '');
            if (cr) remoteTotal = parseInt(cr[1], 10);
        }
        let finalized = false;
        if (Number.isFinite(remoteTotal) && remoteTotal > 0 && existing >= remoteTotal) {
            try {
                if (fs.existsSync(destFolder)) fs.unlinkSync(destFolder);
                fs.renameSync(partialPath, destFolder);
                finalized = true;
            } catch (mvErr) {
                try { fs.rmSync(partialPath, { force: true }); } catch (e) {}
            }
        } else {
            try { fs.rmSync(partialPath, { force: true }); } catch (e) {}
        }
        try { resp.body.resume(); } catch (e) {}
        clearTimeout(overallTimer);
        if (finalized) return { success: true, path: destFolder };
        return downloadAttempt(fetchImpl, url, destFolder, partialPath, taskId, deadline);
    }

    if (!resp.ok && resp.status !== 206) {
        clearTimeout(overallTimer);
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);
    const base = resp.status === 206 ? existing : 0;
    const total = resp.status === 206 ? (contentLength > 0 ? base + contentLength : 0) : contentLength;

    return pipeToDisk(resp, destFolder, partialPath, taskId, base, total, controller, overallTimer);
}

async function downloadModel(url, destFolder, taskId) {
    const { default: fetch } = await import('node-fetch');

    try {
        const destDir = path.dirname(destFolder);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
            console.log('[DOWNLOAD] Created directory:', destDir);
        }

        const partialPath = destFolder + '.part';
        const deadline = Date.now() + DOWNLOAD_OVERALL_TIMEOUT_MS;

        for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES + 1; attempt++) {
            try {
                const result = await downloadAttempt(fetch, url, destFolder, partialPath, taskId, deadline);
                if (result.success) {
                    console.log(`[DOWNLOAD] Completed (attempt ${attempt}): ${destFolder}`);
                    return result;
                }
                break;
            } catch (err) {
                console.error(`[DOWNLOAD] Attempt ${attempt}/${MAX_DOWNLOAD_RETRIES + 1} failed: ${err.message}`);
                if (Date.now() >= deadline) break;
                const backoff = 2000 * Math.pow(2, attempt - 1);
                console.log(`[DOWNLOAD] Retrying in ${backoff}ms (partial size: ${fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0} bytes)`);
                await new Promise(r => setTimeout(r, backoff));
            }
        }

        // Tum denemeler basarisiz → partial dosyayi temizle
        try { fs.rmSync(partialPath, { force: true }); } catch (e) {}
        return { success: false, error: `Download failed after ${MAX_DOWNLOAD_RETRIES + 1} attempts` };
    } catch (err) {
        console.error('[DOWNLOAD] Failed:', err.message);
        return { success: false, error: err.message };
    }
}

// ============================================
// App Lifecycle Events
// ============================================
// Tek instance kilidi (HAT-06): ikinci kopya acildiginda o cikar, mevcut pencere odaklanir
const singleInstanceLockAcquired = app.requestSingleInstanceLock();
if (!singleInstanceLockAcquired) {
    console.warn('[APP] Another instance is already running — quitting.');
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// Modern kaydirma cubuklari (Chromium OverlayScrollbar): kalin gri klasik bar yerine
// ince, yuvarlak, opak-olmayan cubuklar — aihublocal iframe gibi cross-origin iceriklerde
// de etkili (iframe icine CSS enjekte edilemedigi icin tek guvenli yol bu).
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,OverlayScrollbarFlashWhenMouseEnter');

app.whenReady().then(() => {
    if (!singleInstanceLockAcquired) return;
    // Orphan process temizligi
    cleanupOrphanProcesses();

    // Default menu bar'i gizle (File, Edit, View, Window, Help)
    Menu.setApplicationMenu(null);
    console.log('[UI] Default menu bar hidden');

    // Registry sync — YALNIZCA autostart aktifse (HAT-06: kullanici kapatmis olsa da registry bozulmasin)
    try {
        execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\LLMRunnerAIO"', { encoding: 'utf8' });
        syncAutostartRegistry();
    } catch (e) {
        console.log('[AUTOSTART] Disabled — skipping registry sync');
    }

    // IPC handlers kurulumu
    setupIPC();

    // Ana pencere oluştur
    createMainWindow();

    // System tray oluştur
    createTray();
}).catch((err) => {
    console.error('[APP] Startup error:', err);
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

// Uygulama kapanirken tum sunuculari durdur
app.on('before-quit', () => {
    try { console.log('[APP] Shutting down all servers before quit...'); } catch {}

    const serverTypes = ['searxng', 'openwebui', 'vane', 'llamacpp'];
    
    for (const serverType of serverTypes) {
        const info = runningServers.get(serverType);
        if (!info) continue;
        
        try {
            console.log(`[APP] Killing ${serverType}...`);
            
            // llamacpp özelinde PowerShell ile llama-server.exe öldür
            if (serverType === 'llamacpp') {
                try {
                    const psCmd = "powershell -NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object {$_.Name -eq \\'llama-server.exe\\'} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\"";
                    execSync(psCmd, { encoding: 'utf8', timeout: 5000 });
                } catch (e) {
                    console.warn(`[APP] PowerShell kill failed for ${serverType}:`, e.message);
                }
            }
            
            // vane özelinde netstat ile node process öldür
            if (serverType === 'vane') {
                try {
                    const netstatOutput = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
                    const lines = netstatOutput.split('\n');
                    for (const line of lines) {
                        if (line.includes(':3001') && line.includes('LISTENING')) {
                            const parts = line.trim().split(/\s+/);
                            if (parts.length > 4 && !isNaN(parts[4])) {
                                const pid = parseInt(parts[4]);
                                if (pid && pid !== 4) {
                                    execSync('taskkill /F /PID ' + pid, { encoding: 'utf8', timeout: 3000 });
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[APP] Netstat kill failed for ${serverType}:`, e.message);
                }
            }
            
            // Genel fallback — treeKill
            if (info.child?.pid) {
                try {
                    treeKill(info.child.pid, 'SIGKILL');
                } catch (e) {
                    console.warn(`[APP] treeKill failed for ${serverType}:`, e.message);
                }
            }
            
            // cmd.exe wrapper varsa öldür (batch file'lardan kalan)
            if (info.child?.pid && info.child.pid !== process.pid) {
                try {
                    execSync('taskkill /F /T /PID ' + info.child.pid, { encoding: 'utf8', timeout: 3000 });
                } catch (e) {
                    // ignore
                }
            }
            
            runningServers.delete(serverType);
            console.log(`[APP] ✅ ${serverType} stopped`);
            
        } catch (e) {
            console.error(`[APP] ❌ Failed to stop ${serverType}:`, e.message);
            runningServers.delete(serverType);
        }
    }

    // Son olarak Map'i temizle
    runningServers.clear();
    
    console.log('[APP] All servers stopped, quitting...');
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

// ============================================
// Server Update Handler
// ============================================
ipcMain.handle('server-update', async (_event, serverType) => {
    console.log(`[IPC] server-update called for: ${serverType}`);
    
    const logs = [];
    const log = (msg) => {
        logs.push(msg);
        console.log(`[UPDATE] ${msg}`);
    };
    
    try {
        log(`Starting ${serverType} update...`);
        
        // Sunucuyu durdur (çalışıyorsa)
        const serverInfo = runningServers.get(serverType);
        if (serverInfo?.child) {
            log(`Stopping ${serverType} before update...`);
            try {
                treeKill(serverInfo.child.pid, 'SIGTERM');
            } catch (e) {
                log(`Warning: Could not stop ${serverType}: ${e.message}`);
            }
        }
        
        // Server dizinini bul — PROJECT_DIR (proje kökü) kullan
        let serverDir;
        if (serverType === 'searxng') {
            serverDir = path.join(PROJECT_DIR, 'searxng');
        } else if (serverType === 'openwebui') {
            serverDir = path.join(PROJECT_DIR, 'openwebui');
        } else if (serverType === 'vane') {
            serverDir = path.join(PROJECT_DIR, 'Vane');
        } else {
            return { success: false, message: `Unknown server type: ${serverType}`, logs };
        }
        
        // Git dizini kontrolü
        if (!fs.existsSync(serverDir)) {
            return { success: false, message: `Server directory not found: ${serverDir}`, logs };
        }
        
        // ====== DATABASE KORUMA (hem pull hem bootstrap yolunda korur) ======
        let dbBackupPath = null;
        let dbOriginalPath = path.join(serverDir, 'openwebui.db');
        
        if (serverType === 'openwebui' && fs.existsSync(dbOriginalPath)) {
            // Database'i güvenlik alanına taşıyarak koru
            const tempDir = path.join(PROJECT_DIR, '.temp_backup');
            fs.mkdirSync(tempDir, { recursive: true });
            dbBackupPath = path.join(tempDir, `openwebui.db.${Date.now()}.bak`);
            
            fs.copyFileSync(dbOriginalPath, dbBackupPath);
            fs.unlinkSync(dbOriginalPath); // Git'ten temizlenmesi için sil
            log(`🛡️ Database protected: moved to backup (${dbBackupPath.split('/').pop()})`);
        }
        
        // Database geri yükleme fonksiyonu
        function restoreDatabase() {
            if (dbBackupPath && fs.existsSync(dbBackupPath)) {
                try {
                    // Backup'tan orijinale kopyala
                    fs.copyFileSync(dbBackupPath, dbOriginalPath);
                    log(`🛡️ Database restored: openwebui.db (${fs.statSync(dbBackupPath).size} bytes)`);
                    
                    // Temp backup'ı temizle
                    const tempDir = path.dirname(dbBackupPath);
                    fs.readdirSync(tempDir).forEach(file => {
                        if (file.startsWith('openwebui.db.')) {
                            const oldBackup = path.join(tempDir, file);
                            fs.unlinkSync(oldBackup);
                        }
                    });
                    log(`🧹 Old backups cleaned up.`);
                } catch (e) {
                    log(`⚠️ Failed to restore database: ${e.message}`);
                }
            }
        }
        
        // ✨ YENİ: .git klasörü kontrolü — git pull sadece repo olan dizinlerde calisir
        const gitDir = path.join(serverDir, '.git');
        if (!fs.existsSync(gitDir)) {
            const spec = SERVER_GIT_REMOTES[serverType];
            if (!spec) {
                // Bilinmeyen remote — manuel güncelleme talimatları
                const currentVersion = fs.existsSync(path.join(PROJECT_DIR, 'VERSION')) 
                    ? fs.readFileSync(path.join(PROJECT_DIR, 'VERSION'), 'utf8').trim() 
                    : 'unknown';
                
                return { 
                    success: false, 
                    message: `${serverType} dizini bir Git repository değil. Manuel güncelleme gerekli.`,
                    logs: [
                        ...logs,
                        `📦 Current version: ${currentVersion}`,
                        `⬇️  Download latest version from official source`,
                        `📋 Steps:`,
                        `   1. Stop ${serverType} server`,
                        `   2. Backup important data (databases, configs)`,
                        `   3. Download new version`,
                        `   4. Extract to project directory`,
                        `   5. Restore your data to new version`
                    ],
                    currentVersion: currentVersion,
                    needsManualUpdate: true
                };
            }
            
            // ✨ Installer'dan gelen .gitsiz klasör: git'i içine kur ve devam et
            log(`✨ ${serverType}/ has no git metadata — bootstrapping from ${spec.url} (branch: ${spec.branch})...`);
            const bs = await bootstrapGitDir({ dir: serverDir, remoteUrl: spec.url, branch: spec.branch, log });
            if (!bs.success) {
                restoreDatabase();
                return { success: false, message: `Git bootstrap failed: ${bs.error}`, logs };
            }
            restoreDatabase();
            return { success: true, message: `${serverType} initialized and updated to commit ${bs.hash}. Future updates will use normal git pull.`, logs, currentVersion: bs.hash, needsManualUpdate: false };
        }
        
        log(`Running git pull in ${serverDir}...`);
        
        // 0) Yarim guncelleme artigi untracked dosyalar merge'i engellerse karantinaya al
        quarantineUntrackedOverwriteBlockers(serverDir, log);
        
        return new Promise((resolve) => {
            // 1) Stash — local değişiklikleri geçici kaydet
            const stashCmd = process.platform === 'win32' ? 'cmd' : '/bin/sh';
            const stashArgs = process.platform === 'win32'
                ? ['/c', 'git', 'stash', 'save', 'auto-update-stash']
                : ['-c', 'git', 'stash', 'save', 'auto-update-stash'];
            
            const stashChild = require('child_process').spawn(stashCmd, stashArgs, {
                cwd: serverDir,
                shell: true,
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stashStdout = '';
            let stashStderr = '';
            
            stashChild.stdout?.on('data', (data) => {
                stashStdout += data.toString();
            });
            
            stashChild.stderr?.on('data', (data) => {
                stashStderr += data.toString();
            });
            
            stashChild.on('close', (stashCode) => {
                // Stash başarılı veya zaten stash yoksa devam et
                log(`Stash completed (code: ${stashCode})`);
                
                // 2) Git pull — temiz güncelleme
                const gitCmd = process.platform === 'win32' ? 'cmd' : '/bin/sh';
                const gitArgs = process.platform === 'win32'
                    ? ['/c', 'git', 'pull']
                    : ['-c', 'git', 'pull'];
                
                const gitChild = require('child_process').spawn(gitCmd, gitArgs, {
                    cwd: serverDir,
                    shell: true,
                    env: { ...process.env },
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                let pullStdout = '';
                let pullStderr = '';
                
                gitChild.stdout?.on('data', (data) => {
                    const msg = data.toString();
                    pullStdout += msg;
                    log(msg.trim());
                });
                
                gitChild.stderr?.on('data', (data) => {
                    const msg = data.toString();
                    pullStderr += msg;
                    log(`[ERROR] ${msg.trim()}`);
                });
                
                gitChild.on('close', async (pullCode) => {
                    try {
                        if (pullCode !== 0) {
                            // Pull başarısız — database'i geri koy ve stash'i geri al
                            log(`❌ Pull failed (code: ${pullCode}), restoring database...`);
                            restoreDatabase();
                            resolve({ success: false, message: `Update failed: ${pullStderr || 'Unknown error'}`, logs });
                            return;
                        }
                        
                        log(`✅ Pull successful! Restoring database...`);
                        
                        // Database'i geri koy
                        restoreDatabase();
                        
                        // ✨ OpenWebUI özel: bağımlılık senkronu + frontend yeniden build
                        // (git pull kaynak kodu getirir; yeni paketler ve derlenmiş frontend ayrıca gerekir)
                        if (serverType === 'openwebui') {
                            // Repo'nun .npmrc dosyasında engine-strict=true var; Node 24+ makinelerde
                            // npm işlemlerini engeller → ortam değişkeniyle geçersiz kıl.
                            // Büyük SvelteKit build'leri varsayılan heap ile OOM çöker → 8GB heap ayarla.
                            const buildEnv = {
                                ...process.env,
                                npm_config_engine_strict: 'false',
                                // OW 0.12 tam build'i 8 GB heap'te V8'de cokiyor; 12 GB ile tamamlaniyor (dev test).
                                NODE_OPTIONS: ((process.env.NODE_OPTIONS || '').trim() ? process.env.NODE_OPTIONS + ' ' : '') + '--max-old-space-size=12288'
                            };
                            
                            const runBuildStep = (label, args) => new Promise((resolveStep) => {
                                log(label);
                                const stepChild = require('child_process').spawn(
                                    process.platform === 'win32' ? 'cmd' : '/bin/sh',
                                    process.platform === 'win32' ? ['/c'].concat(args) : ['-c'].concat(args),
                                    { cwd: serverDir, shell: true, env: buildEnv, stdio: ['pipe', 'pipe', 'pipe'] }
                                );
                                let settled = false;
                                const finish = (ok) => { if (!settled) { settled = true; resolveStep(ok); } };
                                stepChild.stdout?.on('data', (d) => { const m = d.toString().trim(); if (m) log(m); });
                                stepChild.stderr?.on('data', (d) => { const m = d.toString().trim(); if (m) log(`[BUILD] ${m}`); });
                                stepChild.on('error', (err) => { log(`[BUILD] Launch failed: ${err.message}`); finish(false); });
                                stepChild.on('close', (code) => {
                                    if (code === 0) log(`[UPDATE] ✅ ${label} tamamlandı.`);
                                    else log(`[UPDATE] ⚠️ ${label} başarısız (code: ${code}).`);
                                    finish(code === 0);
                                });
                            });
                            
                            const installOk = await runBuildStep('[UPDATE] Bağımlılıklar senkronize ediliyor (npm install --no-engine-strict)...', ['npm', 'install', '--no-engine-strict']);
                            const buildOk = installOk
                                ? await runBuildStep('[UPDATE] Frontend derleniyor (npm run build)...', ['npm', 'run', 'build'])
                                : false;
                            if (!buildOk) {
                                log('[UPDATE] ⚠️ Frontend derlenemedi — tarayıcıda eski arayüz görünebilir. Update\u2019i tekrar deneyin.');
                            }

                            // OW backend: yeni surumun pip gereksinimleri venv'e senkronlanir (pip adimi eksikti).
                            if (serverType === 'openwebui') {
                                const reqTxt = path.join(serverDir, 'backend', 'requirements.txt');
                                const pyExe = path.join(PROJECT_DIR, 'venv', 'Scripts', 'python.exe');
                                if (fs.existsSync(reqTxt) && fs.existsSync(pyExe)) {
                                    await runBuildStep('[UPDATE] Backend Python bagimliliklari senkronize ediliyor (pip install -r backend/requirements.txt)...',
                                        [pyExe, '-m', 'pip', 'install', '-r', path.join('backend', 'requirements.txt'), '--quiet']);
                                }
                            }
                        }
                        
                        resolve({ success: true, message: `${serverType} updated successfully!`, logs });
                    } catch (err) {
                        console.error('[UPDATE] Beklenmeyen hata:', err);
                        resolve({ success: false, message: `Update error: ${err.message}`, logs });
                    }
                });
                
                gitChild.on('error', (err) => {
                    log(`Spawn error: ${err.message}`);
                    restoreDatabase();
                    resolve({ success: false, message: `Spawn error: ${err.message}`, logs });
                });
            });
            
            stashChild.on('error', (err) => {
                log(`Stash spawn error: ${err.message}`);
                restoreDatabase();
                resolve({ success: false, message: `Stash error: ${err.message}`, logs });
            });
            
        });
        
    } catch (err) {
        log(`Exception: ${err.message}`);
        return { success: false, message: err.message, logs };
    }
});

// ============================================
// Utility Functions
// ============================================

/**
 * Bayt cinsinden boyutu okunabilir formata cevirir
 * PyQt6'da yok ama Electron tarafinda gerekli
 * @param {number} bytes - Bayt
 * @returns {string} Formatlanmis boyut
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

console.log('[ELECTRON] LLM Runner AIO starting...');
console.log('[ELECTRON] App root:', APP_ROOT);
console.log('[ELECTRON] Project dir:', PROJECT_DIR);

// ============================================
// Strata (Qwen3.8-Flash-Next coklu-model gateway, port 1235) — IPC kaydi
// Katman: strata-layer/ (izlenen) -> Strata/local/; upstream koduna yama yazilmaz.
// ============================================
strata.register({
    ipcMain,
    safeSend,
    detectHardware,
    runStreaming: runWan2gpStreaming,
    runCapture: runWan2gpCapture,
    setServerState,
    PROJECT_DIR
});
