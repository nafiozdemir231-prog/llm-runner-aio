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
const { spawn, execSync } = require('child_process');
const treeKill = require('tree-kill');
const presetStore = require('./preset-store');

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
    vane: { running: false, port: 3001 }
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
            sandbox: true
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
        vane: 'Vane'
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

    // Server start/stop
    ipcMain.handle('server-start', async (event, serverType, options) => {
        return startServer(serverType, options);
    });

    ipcMain.handle('server-stop', async (event, serverType) => {
        // stopServer() zaten setServerState() üzerinden güncelliyor
        return await stopServer(serverType);
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

    // Picoding - Add to PATH (PyQt6 _add_to_path ile birebir aynı)
    // PyQt6: winreg.HKCU\Environment okur, picoding_path in current_path kontrolü yapar
    // Electron: PowerShell temp dosya yöntemi ile registry oku/güncelle (escaping sorunu yok)
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

            // PowerShell scriptini temp dosyaya yaz (escaping sorunu yok)
            const psScript = `
$picodingPath = '${picodingPath.replace(/'/g, "''")}';
$regKey = 'HKCU:\\Environment';
$pathValue = (Get-ItemProperty -Path $regKey).Path;
if ($pathValue -and $pathValue -like "*$picodingPath*") {
    Write-Output 'EXISTS';
} else {
    # Zaten ekli değilse ekle
    $newValue = $picodingPath + ';' + $pathValue;
    Set-ItemProperty -Path $regKey -Name 'Path' -Value $newValue;
    Write-Output 'OK';
}
`;

            const tempFile = path.join(os.tmpdir(), 'picoding_add_path.ps1');
            fsLocal.writeFileSync(tempFile, psScript, 'utf8');

            try {
                const result = execSync(
                    `powershell -NoProfile -ExecutionPolicy Bypass -File "${tempFile}"`,
                    { encoding: 'utf8', timeout: 5000 }
                ).trim();

                if (result === 'EXISTS') {
                    return { success: true, message: 'Already in PATH' };
                }

                return { success: true, message: 'Added to PATH successfully' };
            } finally {
                // Temp dosyayı temizle
                try { fsLocal.unlinkSync(tempFile); } catch {}
            }
        } catch (err) {
            console.error('[PATH] Failed to update:', err.message);
            return { success: false, error: err.message };
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
                        
                        log(`✅ Pull successful! Restoring local changes...`);
                        
                        // 3) Stash pop
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
        const result = { model: '', mmproj: '' };

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
                mmprojUrl: p.mmprojUrl
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

async function startServer(serverType, options = {}) {
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
        
        runningServers.set(serverType, { child, port: effectivePort });
        
        // PID kontrolü — shell:true kullanildiğinde undefined olabilir
        try { console.log(`[SPAWN] Child PID: ${child.pid}`); } catch {}

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
                runningServers.delete(serverType);
                setServerState(serverType, false);
            } catch {}
        });

        // Health check'a kadar bekle
        await waitForServerReady(port, 30000);

        // Single Source of Truth ile state güncelle
        setServerState(serverType, true, port);
        
        return { success: true, pid: child.pid, port };
    } catch (err) {
        console.error(`[${serverType}] Start failed:`, err.message);
        return { success: false, error: err.message };
    }
}

async function stopServer(serverType) {
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
            // Akis beklenmedik kesildi (network drop/abort) ve finish gelmediyse
            if (!settled) {
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
        
        // ✨ YENİ: .git klasörü kontrolü — git pull sadece repo olan dizinlerde calisir
        const gitDir = path.join(serverDir, '.git');
        if (!fs.existsSync(gitDir)) {
            // ✨ Versiyon kontrolü + manuel güncelleme talimatları
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
        
        log(`Running git pull in ${serverDir}...`);
        
        // ====== DATABASE KORUMA (openwebui.db hariç her şeyi günceller) ======
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
                
                gitChild.on('close', (pullCode) => {
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
                    
                    resolve({ success: true, message: `${serverType} updated successfully!`, logs });
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
