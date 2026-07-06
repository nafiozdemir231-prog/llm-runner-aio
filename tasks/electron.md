# 🔄 PyQt6 → Electron Migration Plan

**Proje:** LLM Runner AIO  
**Mevcut Teknoloji:** Python + PyQt6 + psutil  
**Hedef Teknoloji:** Electron (Node.js + Chromium)  
**Durum:** PLAN AŞAMASI — Kod yazılmadı

---

## 📊 MEVCUT MİMARİ ANALİZİ

### Root Klasör Yapısı
```
LLM-Runner-AIO/
├── launcher/          # PyQt6 Ana Uygulama
│   ├── main.py        # Giriş noktası (QApplication)
│   ├── app.py         # AppManager, ConfigManager, LanguageManager
│   ├── ui/            # MainWindow, Toolbar, SettingsDialog, SystemTray
│   ├── tabs/          # 4 Tab (system_detection, servers, picoding, models)
│   └── lang/          # 8 Dil (en, tr, de, es, fr, pt, zh, ja)
├── searxng/           # Python Flask metasearch engine (subprocess)
├── openwebui/         # Python/FastAPI chat interface (subprocess + REST sync)
├── Vane/              # Next.js AI answer engine (static export veya standalone spawn)
├── llama.cpp-cuda13+vulkan/  # C++ binary (subprocess)
├── models/            # GGUF model dosyaları
├── gpu*.ini           # 10 adet GPU yapılandırma dosyası
├── model_urls.json    # Model indirme URL'leri
├── import_functions.py # OpenWebUI fonksiyon sync aracı
├── run.bat            # İlk kurulum ve başlatma scripti
└── venv/              # Python sanal ortamı
```

### Mevcut Teknoloji Yığını
| Bileşen | Teknoloji | Açıklama |
|---------|-----------|----------|
| GUI Framework | PyQt6 (Python) | QMainWindow, QTabWidget, QPushButton vb. |
| Process Management | psutil | Servis başlatma/durdurma, orphan cleanup |
| HTTP Client | requests | API çağrıları |
| Config | JSON (config.json) | Ayar kalıcılığı |
| Logging | logging.handlers.RotatingFileHandler | Log rotasyonu |
| SearXNG | Python Flask | Private search engine |
| OpenWebUI | Python FastAPI+uvicorn | Chat interface |
| Vane | Next.js (Node.js) | AI answer engine |
| llama.cpp | C++ Binary (.exe) | AI inference server |

---

## 🔑 KRİTİK ARKİTEKTÜREL KARARLAR (Advisor Önerileri)

### Karar 1: Vane/ Entegrasyonu — Static Export
**Sorun:** Next.js sunucusunu Electron içinde çalıştırmak bellek ve port yönetimi karmaşıklığı yaratır.
**Çözüm:** Vane'yi build sırasında statik dosyalara dönüştür.
```
Vane/next.config.js → output: 'export'
npm run build → out/index.html oluşturulur
Electron → mainWindow.loadFile('Vane/out/index.html')
```
**Not:** Eğer Vane API route kullanıyorsa, `child_process.spawn('node', ['vane-server.js'])` ile ayrı process olarak çalıştırılır.

### Karar 2: Dual Function Import → REST API Only
**Mevcut Durum:**
- `import_functions.py`: Direkt SQLite manipulation (function/tool/user tabloları)
- `import_functions_api.py`: REST API /sync endpoint (sadece action/filter/pipe)

**Karar:** REST API yaklaşımı benimsenecek (daha güvenli, schema değişimine dayanıklı).
```
Electron → OpenWebUI başlat → health-check poll → /api/v1/health OK → function-sync-api.js çalıştır
```
**Risk:** REST API tool tipini desteklemiyor olabilir. Bu durumda küçük bir Python helper script subprocess olarak çalıştırılabilir.

### Karar 3: Cross-Platform Path Handling — Batch Files Kaldırılacak
**Mevcut Durum:** Windows batch dosyaları (%~dp0 kullanıyor)
**Çözüm:** Electron'un native path API'si yeterli.
```
Windows: process.resourcesPath veya app.getAppPath()
macOS: app.getPath('userData')
Linux: ~/.config/llm-runner-aio/
```
**Sonuç:** run.bat ve tüm .bat dosyaları migrasyonla birlikte kaldırılacak.

### Karar 4: Package Management — extraResources + asarUnpack
**Büyük Klasörler:** searxng/, openwebui/, llama.cpp/ → electron-builder extraResources
**Native Modüller:** better-sqlite3 → asarUnpack gerekli (electron-rebuild ile compile edilecek)
**Model Dosyaları:** models/ → Paket içine KOYULMAYACAK (çok büyük). İlk açılışta kullanıcıdan dizin seçilip node-fetch ile streaming download yapılacak.

### Karar 5: Python Subprocess'ları Korunacak
**Neden:** SearXNG ve OpenWebUI'yi Node.js'e yeniden yazmak aylar sürer, amaç değil.
**Strateji:**
```
child_process.spawn('python', ['-m', 'searx.webapp'], {
    cwd: path.join(process.cwd(), 'searxng'),
    stdio: 'pipe',  // stdout/stderr UI'da göster
    env: { ...process.env }
})
tree-kill(pid, 'SIGKILL')  // force kill fallback
```
**Python Resolution:** Hardcoded python/python3 yerine `which python` / `where python` cross-platform check kullanılacak.
First-run bootloader: Node.js ile `python -m venv` oluşturup pip install çalıştırılacak.

### Karar 6: SQLite Operations — better-sqlite3 Native Module
**Kullanım:** LLM-Runner-AIO kendi state'ini (logs, settings, user data) saklamak için kullanacak.
**OpenWebUI DB'sine yazmak YASAKLANACAK** (REST API üzerinden sync yapılacak).
**electron-builder konfigürasyonu:**
```json
"asarUnpack": [
    "**/better-sqlite3/**/*.node",
    "**/sqlite3/**/*.node"
]
```
electron-rebuild ile Electron Node headers'a compile edilecek.

---

## 🎯 Hedef Mimari (Electron)

```
LLM-Runner-Electron/
├── electron/
│   ├── main.js          # Ana süreç (process management)
│   ├── preload.js       # Context bridge
│   └── ipc-handlers.js  # Renderer ↔ Main IPC
├── src/
│   ├── index.html       # Ana sayfa
│   ├── renderer.js      # Main process (QMainWindow yerine)
│   ├── css/style.css    # Tüm stiller
│   ├── tabs/
│   │   ├── system-detection.html/js/css
│   │   ├── servers.html/js/css
│   │   ├── picoding.html/js/css
│   │   └── models.html/js/css
│   ├── utils/
│   │   ├── config.js     # ConfigManager yerine
│   │   ├── i18n.js       # LanguageManager yerine
│   │   ├── logger.js     # Rotating log handler
│   │   └── helpers.js    # Port check, SHA256 vb.
│   └── workers/
│       ├── server-manager.js  # psutil yerine node:child_process
│       ├── health-check.js    # QTimer yerine setInterval
│       └── download-manager.js # huggingface_hub yerine node-fetch
├── searxng/             # ← Değişik yok (Python Flask)
├── openwebui/           # ← Değişik yok (FastAPI+uvicorn)
├── Vane/                # ← Değişik yok (Next.js zaten var)
├── llama.cpp-cuda13+vulkan/  # ← Değişik yok (C++ binary)
├── models/              # ← Değişik yok
├── assets/              # İkonlar
├── package.json         # NPM bağımlılıkları
└── build/               # Paketleme çıktısı
```

---

## 📦 BAĞIMLILIK HARİTASI (PyQt6 → npm)

### PyQt6 → Eşdeğer npm Paketi
| PyQt6 Modülü | Electron/JS Karşılığı | Not |
|-------------|----------------------|-----|
| `PyQt6.QtWidgets.QMainWindow` | `electron.BrowserWindow` | Ana pencere |
| `PyQt6.QtWidgets.QWidget` | `<div>` (HTML) | Container |
| `PyQt6.QtWidgets.QVBoxLayout/QHBoxLayout` | CSS Flexbox/Grid | Layout sistemi |
| `PyQt6.QtWidgets.QPushButton` | `<button>` (HTML) | Buton |
| `PyQt6.QtWidgets.QLabel` | `<label>/<span>` (HTML) | Metin gösterimi |
| `PyQt6.QtWidgets.QComboBox` | `<select>` (HTML) | Dropdown |
| `PyQt6.QtWidgets.QSpinBox` | `<input type="number">` | Sayı girişi |
| `PyQt6.QtWidgets.QTextEdit` | `<textarea>` veya custom div | Log alanı |
| `PyQt6.QtWidgets.QListWidget` | `<ul>/<li>` veya custom list | Model listesi |
| `PyQt6.QtWidgets.QProgressBar` | `<progress>` veya custom div | İlerleme çubuğu |
| `PyQt6.QtWidgets.QCheckBox` | `<input type="checkbox">` | Checkbox |
| `PyQt6.QtWidgets.QGroupBox` | `<fieldset>` veya custom div | Grup kutusu |
| `PyQt6.QtWidgets.QScrollArea` | CSS overflow:auto | Kaydırma |
| `PyQt6.QtWidgets.QTabWidget` | Custom tab HTML/CSS | Sekmeler |
| `PyQt6.QtWidgets.QFileDialog` | `electron.dialog.showOpenDialog()` | Dosya seçici |
| `PyQt6.QtWidgets.QMessageBox` | `electron.dialog.showMessageBox()` | Dialog/popup |
| `PyQt6.QtWidgets.QSystemTrayIcon` | `electron.Tray` | Sistem tepsisi |
| `PyQt6.QtCore.QThread` | `node:worker_threads` veya async/await | Thread yönetimi |
| `PyQt6.QtCore.pyqtSignal` | `EventEmitter` veya custom pub/sub | Event sistemi |
| `PyQt6.QtCore.QTimer` | `setInterval/setTimeout` | Zamanlayıcı |
| `PyQt6.QtCore.QCoreApplication` | `app.quit()` | Uygulama sonu |
| `PyQt6.QtGui.QIcon` | `Buffer.from(fs.readFileSync())` | İkon yükleme |

### psutil → Eşdeğer npm Paketi
| psutil Fonksiyonu | Node.js Karşılığı | Not |
|------------------|-------------------|-----|
| `psutil.process_iter()` | `node:child_process.spawn` ile process enumeration | `/proc` veya WMI |
| `psutil.Process(pid).terminate()` | `child.kill('SIGTERM')` | Graceful shutdown |
| `psutil.Process(pid).kill()` | `child.kill('SIGKILL')` | Force kill |
| `psutil.Process(pid).children()` | `tree-kill` paketi | Process tree |
| `psutil.wait_procs()` | `child.on('exit', callback)` | Process bitiş bekleme |
| `socket.create_connection()` | `net` modülü veya `node-netstat` | Port kontrolü |

### Diğer Python → JS Karşılıkları
| Python | Node.js Karşılığı |
|--------|------------------|
| `json.load()` | `fs.readFileSync(path, 'utf8')` + `JSON.parse()` |
| `hashlib.sha256()` | `crypto.createHash('sha256')` |
| `subprocess.run()` | `child_process.execSync()` veya `exec()` |
| `configparser` | `INI-file-reader` veya manuel parsing |
| `huggingface_hub.hf_hub_download()` | `node-fetch` + stream write |
| `logging.handlers.RotatingFileHandler` | `winston` veya `logrotate` |
| `requests.get/post()` | `node-fetch` veya `axios` |

---

## 🗂️ DOSYA DOSYA MIGRATION PLANI

### 1. `launcher/main.py` → `electron/main.js`

**Mevcut Yapı:**
```python
from PyQt6.QtWidgets import QApplication
from app import run as app_run
from ui.main_window import MainWindow

def main():
    manager = app_run()
    qapp = manager.get_app()
    window = MainWindow()
    window.show()
    sys.exit(qapp.exec())
```

**Hedef Yapı:**
```javascript
// electron/main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { ServerManager } = require('./src/workers/server-manager');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 900,
        minHeight: 650,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, '../assets/icon.ico')
    });
    
    mainWindow.loadFile('src/index.html');
}

app.whenReady().then(createWindow);
```

---

### 2. `launcher/app.py` → `src/utils/config.js` + `src/utils/i18n.js`

**Mevcut Yapı:**
- `AppManager`: Singleton, QApplication yönetimi
- `ConfigManager`: config.json CRUD, atomic write
- `LanguageManager`: 8 dil desteği, JSON'dan string yükleme
- Tema CSS: Dark/Light tema, tüm widget stilleri

**Hedef Yapı:**
```javascript
// src/utils/config.js
const fs = require('fs').promises;
const path = require('path');

class ConfigManager {
    constructor() {
        this.configPath = path.join(process.cwd(), 'launcher', 'config.json');
        this.defaults = { /* ... */ };
        this.data = {};
        this._load();
    }
    
    async _load() { /* fs.readFile + JSON.parse */ }
    async _save() { /* fs.writeFile + atomic rename */ }
    get(key, defaultVal) { /* ... */ }
    set(key, value) { /* ... */ }
}

module.exports = new ConfigManager();

// src/utils/i18n.js
class I18nManager {
    constructor() {
        this.langs = ['en', 'tr', 'de', 'es', 'fr', 'pt', 'zh', 'ja'];
        this.current = 'en';
        this.strings = {};
        this.listeners = [];
    }
    
    load(lang) { /* JSON'dan strings yükle */ }
    get(key, fallback) { return this.strings[key] || fallback; }
    onChange(callback) { this.listeners.push(callback); }
}
```

**Not:** Tema CSS'i Electron'da inline stylesheet olarak uygulanacak. PyQt6'nın QSS (Qt Style Sheets) yerine CSS kullanılacak.

---

### 3. `launcher/ui/main_window.py` → `src/index.html` + `src/renderer.js`

**Mevcut Yapı:**
- QMainWindow (ana pencere)
- QTabWidget (4 sekme: System, Servers, PiCoding, Models)
- Toolbar (üstte): Başlık, tema toggle, font +/-, ayarlar butonu
- SystemTray (sağ alt köşe): Gizle/göster/kapat menüsü

**Hedef Yapı:**
```html
<!-- src/index.html -->
<!DOCTYPE html>
<html>
<head>
    <title>LLM Runner AIO</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <!-- Toolbar (Üstte) -->
    <div id="toolbar">
        <h1>LLM Runner AIO</h1>
        <div class="toolbar-actions">
            <button id="theme-toggle">🌙</button>
            <button id="font-decrease">A-</button>
            <span id="font-size">13px</span>
            <button id="font-increase">A+</button>
            <button id="settings-btn">⚙ Settings</button>
            <button id="support-btn">☕ Support</button>
        </div>
    </div>
    
    <!-- Tabs (Alttta) -->
    <div id="tabs-container">
        <div id="tab-bar">
            <button data-tab="system" class="active">System Detection</button>
            <button data-tab="servers">Servers</button>
            <button data-tab="picoding">Pi Coding</button>
            <button data-tab="models">Models</button>
        </div>
        
        <div id="tab-content">
            <div id="tab-system" class="tab-panel active"></div>
            <div id="tab-servers" class="tab-panel"></div>
            <div id="tab-picoding" class="tab-panel"></div>
            <div id="tab-models" class="tab-panel"></div>
        </div>
    </div>
    
    <script src="renderer.js"></script>
</body>
</html>
```

---

### 4. `launcher/tabs/system_detection.py` → `src/tabs/system-detection.js`

**Mevcut Yapı:**
- Hardware detection: GPU, VRAM, RAM tespiti (nvidia-smi, PowerShell)
- INI dosyası seçimi: `gpu*.ini` dosyalarından otomatik eşleştirme
- Model indirme: `huggingface_hub` ile GGUF modelleri indirme
- Progress tracking: Thread-safe progress signal emit

**Hedef Yapı:**
```javascript
// src/tabs/system-detection.js
const { execSync } = require('child_process');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');

async function detectHardware() {
    // NVIDIA GPU detection
    try {
        const result = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { encoding: 'utf8' });
        // Parse output
    } catch (e) {
        // Fallback: AMD/Intel via PowerShell
    }
    
    // RAM detection
    const os = require('os');
    const ramGb = os.totalmem() / (1024 ** 3);
    
    return { gpuName, vramGb, ramGb };
}

async function sha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

async function downloadModel(url, destFolder) {
    const response = await fetch(url);
    const fileStream = fs.createWriteStream(destFolder);
    // Stream download with progress events
}
```

---

### 5. `launcher/tabs/servers.py` → `src/workers/server-manager.js`

**Mevcut Yapı:**
- 4 Worker class: `ServerWorker`, `SearXNGWorker`, `OpenWebUIWorker`, `LlamaCppWorker`, `VaneWorker`
- Her biri `QThread` miras alır, subprocess başlatır/durdurur
- Process tree kill: psutil ile çocuk process'leri öldürme
- Health check: QTimer ile 60 saniyede bir HTTP ping
- Port kontrol: socket.bind denemesi
- Bind address seçimi: 0.0.0.0 / 127.0.0.1

**Hedef Yapı:**
```javascript
// src/workers/server-manager.js
const { spawn, execSync } = require('child_process');
const net = require('net');
const http = require('http');

class ServerManager {
    constructor() {
        this.servers = {
            searxng: null,
            openwebui: null,
            llamacpp: null,
            vane: null
        };
        this.healthCheckInterval = null;
    }
    
    async isPortInUse(port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000);
            socket.connect(port, '127.0.0.1', () => {
                socket.destroy();
                resolve(true);
            });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
            socket.on('error', () => { socket.destroy(); resolve(false); });
        });
    }
    
    startSearXNG(port, host) {
        // subprocess.Popen yerine child_process.spawn
        this.servers.searxng = spawn('python', ['-m', 'searx.webapp'], {
            cwd: path.join(process.cwd(), 'searxng'),
            env: { ...process.env, SEARXNG_SETTINGS_PATH: settingsPath }
        });
    }
    
    stopAllServers() {
        for (const [name, child] of Object.entries(this.servers)) {
            if (child) {
                child.kill('SIGTERM');
                setTimeout(() => child.kill('SIGKILL'), 10000);
            }
        }
    }
    
    startHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            // HTTP ping ile servis kontrolü
            for (const [name, port] of [['searxng', 8080], ['openwebui', 3000]]) {
                try {
                    await http.get(`http://127.0.0.1:${port}/`);
                } catch (e) {
                    // Restart required
                }
            }
        }, 60000);
    }
}
```

---

### 6. `launcher/tabs/models.py` → `src/tabs/models.js`

**Mevcut Yapı:**
- `.gguf` dosyalarını `models/` klasöründe tarama
- Silme işlemi: Seçili modelleri silme
- Depolama hesaplama: Toplam GB cinsinden

**Hedef Yapı:**
```javascript
// src/tabs/models.js
const fs = require('fs');
const path = require('path');

function scanModels(modelsDir) {
    const ggufFiles = [];
    let totalSize = 0;
    
    function walk(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                walk(fullPath);
            } else if (file.endsWith('.gguf')) {
                ggufFiles.push({ name: file, size: stat.size, path: fullPath });
                totalSize += stat.size;
            }
        }
    }
    
    walk(modelsDir);
    return { files: ggufFiles, totalSize };
}
```

---

### 7. `launcher/ui/settings_dialog.py` → `src/settings-dialog.html/js`

**Mevcut Yapı:**
- Tema seçimi: Dark/Light radio button
- Font boyutu: +/- butonları
- Dil seçimi: ComboBox (8 dil)
- Windows ile başla: Registry ekleme/çıkarma
- Otomatik sunucu başlatma: Checkbox listesi

**Hedef Yapı:**
```html
<!-- src/settings-dialog.html -->
<div id="settings-modal" class="modal">
    <div class="modal-content">
        <h2>Settings</h2>
        
        <div class="setting-group">
            <label>Theme</label>
            <label><input type="radio" name="theme" value="dark"> Dark</label>
            <label><input type="radio" name="theme" value="light"> Light</label>
        </div>
        
        <div class="setting-group">
            <label>Font Size</label>
            <button id="font-decrease">A-</button>
            <span id="font-size-display">13px</span>
            <button id="font-increase">A+</button>
        </div>
        
        <div class="setting-group">
            <label>Language</label>
            <select id="language-select">
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
                <!-- ... -->
            </select>
        </div>
        
        <div class="setting-group">
            <label>Startup</label>
            <input type="checkbox" id="start-with-windows"> Start with Windows
            <input type="checkbox" id="auto-start-servers"> Auto-start servers
        </div>
        
        <button id="close-settings">Close</button>
    </div>
</div>
```

---

### 8. `launcher/lang/*.json` → `src/lang/*.json`

**8 Dil Dosyası:**
- `en.json` — English
- `tr.json` — Türkçe
- `de.json` — Deutsch
- `es.json` — Español
- `fr.json` — Français
- `pt.json` — Português
- `zh.json` — 中文
- `ja.json` — 日本語

**Değişiklik Yok:** JSON dosyaları birebir kopyalanacak. `i18n.js` bu dosyaları yükleyip `get(key)` fonksiyonuyla sağlayacak.

---

## ⚙️ ELECTRON YAPILANDIRMASI

### `package.json`
```json
{
    "name": "llm-runner-aio",
    "version": "1.0.0",
    "main": "electron/main.js",
    "scripts": {
        "start": "electron .",
        "build": "electron-builder build --win",
        "rebuild": "electron-rebuild -f -w better-sqlite3",
        "package": "electron-builder"
    },
    "dependencies": {
        "electron": "^33.0.0",
        "electron-builder": "^25.0.0",
        "better-sqlite3": "^11.0.0",
        "node-fetch": "^3.3.0",
        "tree-kill": "^1.2.2",
        "winston": "^3.17.0",
        "ini-file-parser": "^1.0.0",
        "crypto-js": "^4.2.0",
        "electron-store": "^9.0.0",
        "systeminformation": "^5.0.0"
    },
    "build": {
        "appId": "com.llmrunner.app",
        "productName": "LLM Runner AIO",
        "win": {
            "target": ["nsis"],
            "icon": "assets/icon.ico"
        },
        "mac": {
            "target": ["dmg"]
        },
        "linux": {
            "target": ["AppImage"]
        },
        "extraResources": [
            {
                "from": "searxng/",
                "to": "searxng/"
            },
            {
                "from": "openwebui/",
                "to": "openwebui/"
            },
            {
                "from": "Vane/",
                "to": "Vane/"
            },
            {
                "from": "llama.cpp-cuda13+vulkan/",
                "to": "llama.cpp-cuda13+vulkan/"
            }
        ],
        "asarUnpack": [
            "**/better-sqlite3/**/*.node",
            "**/sqlite3/**/*.node"
        ]
    }
}
```

---

## 🔑 KRİTİK GEÇİŞ NOKTALARI

### 1. Process Management (En Önemli)
| PyQt6/Python | Electron/JS |
|-------------|-------------|
| `psutil.process_iter()` | `child_process.spawn` ile enumeration |
| `psutil.Process(pid).kill()` | `child.kill('SIGKILL')` |
| `QThread` | `worker_threads` veya async/await |
| `pyqtSignal` | Custom EventEmitter |

### 2. Cross-Platform Considerations
- **Windows Registry**: `winreg` yerine `electron.shell.openExternal('ms-settings:')` veya PowerShell script
- **System Tray**: `electron.Tray` zaten var, kolay geçiş
- **File Dialog**: `electron.dialog.showOpenDialog()`
- **Environment Variables**: `process.env` zaten var

### 3. Performance Mapping
| PyQt6 | Electron |
|-------|----------|
| `QTimer.timeout` | `setInterval()` |
| `QThread.run()` | `worker_threads` |
| `QProgressBar` | CSS animated div |
| `QTextEdit.append()` | DOM innerHTML append |

---

## 📋 MIGRATION ADIMLARI (Advisor Önerileriyle Güncellenmiş)

### Faz 1: Electron Foundation & App Shell (2 Hafta)
- [ ] 1.1. `package.json` oluştur (electron, electron-builder, node-fetch, tree-kill, winston, better-sqlite3)
- [ ] 1.2. `electron/main.js` temel yapı (BrowserWindow, app lifecycle)
- [ ] 1.3. `preload.js` context bridge (contextIsolation: true)
- [ ] 1.4. `src/index.html` boş şablon + CSS linkleri
- [ ] 1.5. `npm install`
- [ ] 1.6. `electron-rebuild` ile better-sqlite3 native compile
- [ ] 1.7. 8 dil JSON dosyalarını `src/lang/` kopyala + i18next entegrasyonu

### Faz 2: Core Utility Modülleri (2 Hafta)
- [ ] 2.1. `src/utils/config.js` (ConfigManager — fs + atomic rename)
- [ ] 2.2. `src/utils/i18n.js` (LanguageManager — JSON yükleme, onChange listeners)
- [ ] 2.3. `src/utils/logger.js` (Rotating log — winston veya custom fs.rotate)
- [ ] 2.4. `src/utils/helpers.js` (Port check via net.Socket, SHA256 via crypto.createHash)
- [ ] 2.5. `src/workers/function-sync-api.js` (import_functions_api.py → REST API sync)
- [ ] 2.6. Cross-platform Python resolver (`which python` / `where python` helper)

### Faz 3: Ana Pencere ve UI (2 Hafta)
- [ ] 3.1. `src/index.html` toolbar + tab yapısı (PyQt6 QMainWindow → BrowserWindow)
- [ ] 3.2. `src/css/style.css` dark/light tema (QSS → CSS flexbox/grid)
- [ ] 3.3. `src/renderer.js` tab switching logic (pyqtSignal → EventEmitter pattern)
- [ ] 3.4. `src/settings-dialog.html/js` settings modal
- [ ] 3.5. System tray entegrasyonu (`electron.Tray`)
- [ ] 3.6. Font size +/-, theme toggle, language switch UI

### Faz 4: Tab Modülleri & Process Management (2 Hafta)
- [ ] 4.1. `src/tabs/system-detection.js` hardware detection (gpu*.ini parsing, nvidia-smi execSync, systeminformation fallback)
- [ ] 4.2. `src/workers/server-manager.js` server control (child_process.spawn + tree-kill)
- [ ] 4.3. `src/workers/process-manager.js` stdout/stderr stream parser (UI console'a feed)
- [ ] 4.4. `src/tabs/picoding.js` working directory + MCP config
- [ ] 4.5. `src/tabs/models.js` model browser + download manager (node-fetch streaming)
- [ ] 4.6. Health check timer (setInterval HTTP ping, sleep-mode recovery)

### Faz 5: Vane Entegrasyonu & İlk-Run Bootloader (1 Hafta)
- [ ] 5.1. Vane Next.js static export konfigürasyonu (output: 'export')
- [ ] 5.2. Build sırasında `npm run build` ile statik dosya üretimi
- [ ] 5.3. Electron'da `loadFile('Vane/out/index.html')` yükleme
- [ ] 5.4. İlk-run bootloader: Node.js venv oluşturma + pip install requirements.txt
- [ ] 5.5. OpenWebUI health-check poll loop → function-sync-api.js trigger
- [ ] 5.6. migrate_ini_to_urls.json migration script'i (ilk çalıştırma)

### Faz 6: Paketleme & Dağıtım (1 Hafta)
- [ ] 6.1. `electron-builder.yml` konfigürasyonu:
    - extraResources: searxng/, openwebui/, llama.cpp/
    - asarUnpack: better-sqlite3 native modüller
    - NSIS installer (Windows), DMG (macOS)
- [ ] 6.2. `.gitignore` güncelleme (node_modules/, dist/, *.log)
- [ ] 6.3. README.md güncelleme (Electron kurulum talimatları)
- [ ] 6.4. Test dağıtımı — farklı dizinlerde portability test
- [ ] 6.5. Legacy Python launcher kaldırma (run.bat, main.py, import_functions.py)

---

## 📊 TOPLAM SÜRE TAHMİNİ

| Faz | Süre | Öncelik |
|-----|------|---------|
| Faz 1: Electron Foundation | 2 hafta | Kritik |
| Faz 2: Core Utilities | 2 hafta | Yüksek |
| Faz 3: Ana Pencere ve UI | 2 hafta | Yüksek |
| Faz 4: Process Management | 2 hafta | Kritik |
| Faz 5: Vane & Bootloader | 1 hafta | Orta |
| Faz 6: Paketleme & Temizlik | 1 hafta | Düşük |
| **TOPLAM** | **~10 hafta** | |

---

## ⚠️ RİSKLER VE ÇÖZÜMLER (Güncellenmiş)

### Risk 1: Process Tree Kill (Yüksek Öncelik)
**Sorun:** Node.js'de psutil gibi güçlü process yönetimi yok  
**Çözüm:** `tree-kill` paketi + `child_process.spawn` kombinasyonu
```
const treeKill = require('tree-kill');
treeKill(pid, 'SIGKILL', callback);
```
**Not:** Her servisin kendi `_process` referansı olacak, stop_all_servers() loop ile kill edilecek.

### Risk 2: Vane Next.js Entegrasyonu (Orta Öncelik)
**Sorun:** Next.js sunucusunu Electron içine gömmek karmaşık  
**Çözüm:** Static export (`output: 'export'`) + `loadFile()` veya standalone spawn

### Risk 3: Cross-Platform Path Handling (Düşük Öncelik)
**Sorun:** Windows path'leri vs Unix path'leri  
**Çözüm:** `path.join()` + `app.getAppPath()` + `process.resourcesPath` kullanımı

### Risk 4: better-sqlite3 Native Module (Orta Öncelik)
**Sorun:** Native modüller Electron context'inde compile edilmeli  
**Çözüm:** `electron-rebuild` + `asarUnpack` konfigürasyonu

### Risk 5: Large Binary Distribution (Düşük Öncelik)
**Sorun:** llama.cpp (.exe), searxng/, openwebui/ büyük klasörler  
**Çözüm:** `electron-builder extraResources` ile paketleme, models/ hariç tutulacak

### Risk 6: OpenWebUI Function API Limitation (Yüksek Öncelik)
**Sorun:** REST API tool tipini desteklemiyor olabilir  
**Çözüm:** Eğer API tool sync support etmiyorsa, küçük bir Python helper script subprocess olarak çalıştırılacak:
```javascript
child_process.spawn('python', ['import_functions.py'], { cwd: openwebuiDir });
```

---

## ⚠️ RİSKLER VE ÇÖZÜMLER

### Risk 1: Process Tree Kill
**Sorun:** Node.js'de psutil gibi güçlü process yönetimi yok  
**Çözüm:** `tree-kill` paketi + `child_process.spawn` kombinasyonu

### Risk 2: Cross-Platform Path Handling
**Sorun:** Windows path'leri (`D:\OpenCode\...`) vs Unix path'leri (`/home/user/...`)  
**Çözüm:** `path.join()` ve `path.relative()` kullanımı, `%~dp0` yerine `__dirname`

### Risk 3: Hardware Detection
**Sorun:** `nvidia-smi` komutu sadece Windows/Linux'ta çalışır  
**Çözüm:** `execSync('nvidia-smi')` içinde try-catch, fallback PowerShell

### Risk 4: SQLite Database Corruption
**Sorun:** OpenWebUI SQLite.db bozulması (daha önce tespit edildi)  
**Çözüm:** Electron tarafında değişiklik yok, backend hala Python

### Risk 5: Large Binary Distribution
**Sorun:** llama.cpp (.exe), searxng/, openwebui/ büyük klasörler  
**Çözüm:** `.gitignore` + `electron-builder extraResources` ile paketleme

---

## 📊 MEVCUT vs HALE GETİRİLMİŞ KARŞILAŞTIRMA

| Özellik | PyQt6 (Mevcut) | Electron (Hedef) |
|---------|---------------|------------------|
| GUI Framework | PyQt6 (C++ binding) | Chromium (HTML/CSS/JS) |
| Process Mgmt | psutil | node:child_process + tree-kill |
| Threading | QThread | worker_threads |
| Events | pyqtSignal | EventEmitter |
| Config | JSON + atomic write | JSON + fs.writeFileSync |
| Logging | RotatingFileHandler | winston |
| Tray Icon | QSystemTrayIcon | electron.Tray |
| File Dialog | QFileDialog | electron.dialog |
| Window Minimize | changeEvent() | BrowserWindow.minimize() |
| Hotkeys | QShortcut | globalShortcut |
| Build Size | ~50MB (venv+PyQt6) | ~150MB (Electron+deps) |
| Startup Time | ~2s (Python cold) | ~3s (Chromium cold) |
| Memory Usage | ~100MB | ~200MB (Chromium overhead) |
| Platform | Windows-focused | Cross-platform ready |
| Update Mechanism | Manual ZIP | Squirrel.Electron auto-update |

---

## 🎯 SONUÇ VE KRİTİK KARARLAR

Bu migration planı mevcut PyQt6 uygulamasını Electron'a taşıyacak:

### ✅ Korunacak Özellikler
- Tüm 4 tab sistemi (System Detection, Servers, PiCoding, Models)
- 8 dil desteği (en/tr/de/es/fr/pt/zh/ja)
- 4 servis yönetimi (SearXNG, OpenWebUI, llama.cpp, Vane)
- Process management (start/stop/health-check/orphan-cleanup)
- Model download manager (GGUF streaming)

### 🔑 Advisor Karar Özeti
1. **Vane/** → Next.js static export + Electron loadFile()
2. **Function Import** → REST API only (SQLite direct access deprecated)
3. **Batch Files** → Tamamen kaldırılacak (`app.getAppPath()` yeterli)
4. **Python Subprocess** → Korunacak (tree-kill + child_process.spawn)
5. **SQLite** → better-sqlite3 native module (asarUnpack gerekli)
6. **Models/** → Paket içine koyulmayacak (streaming download)

### ⚠️ Artışlar
- Build boyutu: ~50MB → ~150MB (electron-builder extraResources dahil)
- Bellek kullanımı: ~100MB → ~200MB (Chromium overhead)
- İlk kurulum süresi: ~2s → ~5-10s (venv oluşturma + pip install)

### 📅 Toplam Süre: ~10 Hafta (6 Faz)

---

## 🔄 GÜNCEL MİMARİ AKIŞ DIAGRAMI

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│  electron/main.js                                           │
│  ├── BrowserWindow (UI)                                     │
│  ├── ProcessManager (child_process.spawn + tree-kill)       │
│  ├── FunctionSyncApi (REST /api/v1/functions/sync)          │
│  └── FirstRunBootloader (venv create + pip install)         │
├─────────────────────────────────────────────────────────────┤
│                   Renderer Process                           │
│  src/index.html + renderer.js                                │
│  ├── Tab System (HTML/CSS tabs)                             │
│  ├── Console Output (stdout/stderr streams)                 │
│  ├── Settings Dialog                                        │
│  └── i18n (8 languages from JSON)                           │
├─────────────────────────────────────────────────────────────┤
│                   External Services                          │
│  ├── SearXNG (Python Flask subprocess)                      │
│  ├── OpenWebUI (FastAPI subprocess + REST sync)             │
│  ├── Vane (Next.js static export or spawn)                  │
│  └── llama.cpp (C++ binary subprocess)                      │
├─────────────────────────────────────────────────────────────┤
│                   Data Layer                                 │
│  ├── config.json (settings)                                 │
│  ├── better-sqlite3 (app state/logs)                        │
│  ├── lang/*.json (i18n strings)                             │
│  └── model_urls.json (download URLs)                        │
└─────────────────────────────────────────────────────────────┘
```

### 10. `import_functions_api.py` → `src/workers/function-sync-api.js`

**Mevcut Yapı (Python):**
- OpenWebUI'ye **API üzerinden** fonksiyon sync yapar (`/api/v1/functions/sync`)
- `function/` klasöründeki JSON dosyalarını parse eder
- Sadece `action`, `filter`, `pipe` tiplerini işler (tool'ları skip eder)
- HTTP POST ile JSON gönderir
- Bağlantı hatası durumunda manuel çalıştırma uyarısı verir
- **Gereksinim:** OpenWebUI sunucusu running olmalı

**Hedef Yapı (Node.js):**
```javascript
// src/workers/function-sync-api.js
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class FunctionSyncApi {
    constructor(openwebuiDir, apiUrl) {
        this.functionDir = path.join(openwebuiDir, 'function');
        this.apiUrl = apiUrl || 'http://localhost:3000/api/v1/functions/sync';
    }
    
    async syncFunctions() {
        const jsonFiles = fs.readdirSync(this.functionDir)
            .filter(f => f.endsWith('.json'))
            .map(f => path.join(this.functionDir, f));
        
        let success = 0;
        let errors = 0;
        
        for (const file of jsonFiles) {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!Array.isArray(data) || data.length === 0) continue;
            
            const item = data[0];
            if (!['action', 'filter', 'pipe'].includes(item.type)) {
                console.log(`[SKIP] ${item.name}`);
                continue;
            }
            
            try {
                const response = await fetch(this.apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                    timeout: 10000
                });
                
                if (response.ok) {
                    success++;
                    console.log(`[OK] Sync: ${item.name}`);
                } else {
                    errors++;
                    console.error(`[ERROR] HTTP ${response.status}: ${item.name}`);
                }
            } catch (e) {
                errors++;
                console.error(`[ERROR] Connection refused. Manuel çalıştırın.`);
            }
        }
        
        return { success, errors };
    }
}
```

**Kullanım:**
```javascript
// servers.js içinde OpenWebUI başlatıldıktan 15sn sonra:
setTimeout(async () => {
    const syncer = new FunctionSyncApi(openwebuiDir);
    await syncer.syncFunctions();
}, 15000);
```

---

## 📊 EK DOSYA DETAYLARI

### `import_functions.py` Detayları
- **Kullanım:** `servers.py` içinde `OpenWebUIWorker.start_server_internal()` tarafından çağrılıyor
- **SQLite Tabloları:** `function`, `tool`, `user`
- **Import Tipi:** Upsert (INSERT veya UPDATE)
- **Admin User:** Otomatik bulup atıyor
- **Node.js Karşılığı:** `better-sqlite3` paketi kullanacak

### `import_functions_api.py` Detayları
- **Kullanım:** Manuel çalıştırma aracı (şu an kodda çağrılmıyor)
- **API Endpoint:** `/api/v1/functions/sync` (HTTP POST)
- **Gereksinim:** OpenWebUI sunucusu running olmalı
- **Sadece Function Tipleri:** action, filter, pipe (tool skip edilir)
- **Node.js Karşılığı:** `node-fetch` ile HTTP POST

### `model_urls.json` Detayları
- **Format:** `{vram{X}ram{Y}models.ini: {modelName: {model: URL, mmproj: URL}}}`
- **9 GPU Config:** vram4ram16, vram4ram32, vram6ram16, vram6ram32, vram8ram32, vram12ram32, vram16ram32, vram24ram32, vram32ram32
- **Model Sayısı:** Her config'de ortalama 5-8 model
- **Toplam Model:** ~50+ GGUF model URL'i
- **Hash Desteği:** `sha256` ve `sha256_mmproj` alanları mevcut (bazılarında dolu, bazılarında boş)
- **Electron'da Kullanım:** `system-detection.js` tarafından `hf_hub_download` yerine `node-fetch` + stream write ile indirilecek

### `create_shortcut.py` Detayları
- **İki Fonksiyon:**
  1. `create_windows_shortcut()`: PowerShell ile `.lnk` dosyası oluşturur
  2. `create_vbs_launcher()`: Terminal gizleyen `.vbs` dosyası yazar
- **Icon:** `assets/icon.ico` varsa kullanır, yoksa `pythonw.exe` simgesi
- **Working Directory:** Uygulama root dizini
- **Electron'da:** Kurulum sırasında otomatik kısayol oluşturulacak, VBS gereksiz

---

**Not:** Bu sadece PLAN dosyasıdır. Kod yazılmadı, sadece mimari harita çıkarıldı.
