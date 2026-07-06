# 🔄 Electron vs PyQt6 Dosya Karşılıkları

> **Proje:** LLM Runner AIO  
> **Tarih:** 2026-07-06  
> **Amaç:** Electron dosyalarının PyQt6 kaynak kodlarıyla birebir fonksiyonel eşleşmelerini göstermek

---

## 📋 İçindekiler

1. [Ana İşlem Akışı (Main Process)](#1-ana-işlem-akışı-main-process)
2. [Renderer UI & Temel Dosyalar](#2-renderer-ui--temel-dosyalar)
3. [Tab Modülleri](#3-tab-modülleri)
4. [Utility & Yardımcı Dosyalar](#4-utility--yardımcı-dosyalar)
5. [Worker & Arka Plan Servisleri](#5-worker--arka-plan-servisleri)
6. [Konfigürasyon & Dil Dosyaları](#6-konfigürasyon--dil-dosyaları)
7. [Root Dizin Scriptleri](#7-root-dizin-scriptleri)
8. [AI Servis Dizini Yapısı](#8-ai-servis-dizini-yapısı)

---

## 1. Ana İşlem Akışı (Main Process)

| Electron Dosyası | PyQt6 Karşılığı | Açıklama |
|------------------|-----------------|----------|
| `electron/main.js` | `LLM-Runner-AIO/launcher/main.py` | **Ana Electron işlemi.** Window oluşturma, IPC handlers, server yönetimi, hardware detection, orphan cleanup, tray menu. PyQt6'da `QApplication`, `MainWindow`, `closeEvent`, `tray` hepsi burada. |
| `electron/preload.js` | `LLM-Runner-AIO/launcher/ui/main_window.py` (contextBridge kısmı) | **Security Bridge.** Renderer ile main process arasındaki IPC köprüsü. `contextIsolation` + `preload` pattern. PyQt6'da doğrudan method çağrıları var. |

### Birebir Fonksiyon Eşleşmeleri

| `electron/main.js` | `main.py` | İşlev |
|--------------------|-----------|-------|
| `cleanupOrphanProcesses()` | `_cleanup_orphan_processes()` | Çalışan eski process'leri öldürür |
| `createWindow()` | `__init__()` + `setup_ui()` | BrowserWindow oluşturur, menüler ekler |
| `ipcMain.handle('server-start')` | `ServerWorker.start()` | llama.cpp/OpenWebUI/SearXNG/Vane başlatır |
| `ipcMain.handle('server-stop')` | `ServerWorker.stop()` / `stop_all_servers()` | Tüm servisleri durdurur |
| `ipcMain.handle('detect-hardware')` | `SystemDetectionTab._detect_hardware()` | GPU/VRAM/RAM tespiti |
| `ipcMain.handle('config-read')` | `Config.get()` | `config.json` okuma |
| `ipcMain.handle('config-write')` | `Config.set()` + atomic write | `config.json` yazma |
| `ipcMain.handle('model-download')` | `DownloadThread.run()` | HuggingFace model indirme |
| `ipcMain.handle('db-load')` | `MainWindow._load_database()` | OpenWebUI chat DB yükleme |
| `trayMenu` | `TrayIcon.__init__()` | Sistem tepsisi menüsü |

---

## 2. Renderer UI & Temel Dosyalar

| Electron Dosyası | PyQt6 Karşılığı | Açıklama |
|------------------|-----------------|----------|
| `src/index.html` | `LLM-Runner-AIO/launcher/ui/main_window.py` (HTML template) | **Ana HTML yapı taşı.** Tab container, toolbar, log area, tüm UI elementleri. PyQt6'da `.ui` dosyası veya programmatic widget kurulumu. |
| `src/css/style.css` | `LLM-Runner-AIO/launcher/ui/main_window.py` (stylesheet kısmı) | **CSS stilleri.** Modern flat design, tab stilleri, scrollbar, buton hover efektleri. PyQt6'da `QMainWindow.setStyleSheet()` içinde inline CSS. |
| `src/renderer.js` | `LLM-Runner-AIO/launcher/ui/main_window.py` (event handler'lar) | **Renderer JavaScript.** DOM manipülasyonu, tab geçişleri, log display, IPC event listener'ları, form validation. PyQt6'da `QPushButton.clicked.connect()`, `QComboBox.currentIndexChanged.connect()` vb. |

### Birebir Fonksiyon Eşleşmeleri

| `renderer.js` | `main_window.py` / `app.py` | İşlev |
|---------------|----------------------------|-------|
| `switchTab(tabName)` | `_switch_tab()` | Tab değiştirme |
| `appendLog(level, message)` | `log_handler.emit()` | Log gösterimi (info/warning/error) |
| `updateToolbarStatus(status)` | `Toolbar.update_status()` | Durum çubuğu güncelleme |
| `handleHardwareDetected(data)` | `hardware_detected.connect()` | Donanım bilgisi UI'a aktarma |
| `handleModelsScanned(data)` | `models_scanned.connect()` | Model listesi render |
| `handleServerStarted(type)` | `server_started[type].connect()` | Server durum güncellemesi |

---

## 3. Tab Modülleri

### 3.1 System Detection Tab

| Electron Dosyası | PyQt6 Karşılığı | Açıklama |
|------------------|-----------------|----------|
| `src/tabs/system-detection.js` | `LLM-Runner-AIO/launcher/tabs/system_detection.py` | **Donanım tespiti ve INI seçimi.** GPU/VRAM/RAM algılama, INI auto-select, model önerileri, download progress. |

#### Birebir Fonksiyon Eşleşmeleri

| `system-detection.js` | `system_detection.py` | İşlev |
|----------------------|----------------------|-------|
| `detectHardware()` | `_detect_hardware()` | PowerShell/nvidia-smi ile GPU tespiti |
| `selectINIByVRAM(vramGb, ramGb)` | `_select_ini()` | VRAM'e göre en uygun INI dosyasını bulma |
| `renderModelRecommendations()` | (yok — yeni özellik) | VRAM bazlı model önerileri gösterme |
| `startModelDownload(filename)` | `DownloadThread.__init__()` | Model indirme başlatma |
| `parseINIINIFromPath(path)` | (yeni) | INI dosyasından section bilgilerini parse etme |

### 3.2 Servers Tab

| Electron Dosayası | PyQt6 Karşılığı | Açıklama |
|-------------------|-----------------|----------|
| `src/workers/server-manager.js` | `LLM-Runner-AIO/launcher/tabs/servers.py` | **Server yönetimi.** llama.cpp, OpenWebUI, SearXNG, Vane başlatma/durdurma, port atama, bind address, health check. |

#### Birebir Fonksiyon Eşleşmeleri

| `server-manager.js` | `servers.py` | İşlev |
|---------------------|--------------|-------|
| `startServer(type, options)` | `ServerWorker.__init__()` + `run()` | Server process'ini başlatır |
| `stopServer(type)` | `ServerWorker.stop()` | Server process'ini durdurur |
| `checkHealth(url, retries)` | `_health_check_loop()` | HTTP health check (background timer) |
| `getServerStatus(type)` | `worker.status` property | Server durumu (idle/running/stopped/error) |
| `getServerLogs(type)` | `worker.log_buffer` | Son log kayıtlarını getirir |

### 3.3 PiCoding Tab

| Electron Dosyası | PyQt6 Karşıları | Açıklama |
|------------------|-----------------|----------|
| `src/tabs/picoding.js` | `LLM-Runner-AIO/launcher/tabs/picoding.py` | **AI Coding Assistant.** Proje tespit, MCP Advisor ayarları, PATH ekleme, custom instructions. |

#### Birebir Fonksiyon Eşleşmeleri

| `picoding.js` | `picoding.py` | İşlev |
|---------------|---------------|-------|
| `detectProject()` | `_detect_project()` | VS Code workspace dosyası bulma |
| `addToPATH()` | `_add_to_path()` | Python PATH'e ekleme |
| `saveAdvisorSettings(data)` | `_save_advisor_config()` | MCP Advisor URL/API Key/Model kaydetme |
| `loadAdvisorSettings()` | `_load_advisor_config()` | Kaydedilmiş Advisor ayarlarını yükleme |
| `updateMCPFile(advisorData)` | `_update_mcp_web_reader()` | `mcp_web_reader.py` dosyasını güncelleme |

### 3.4 Models Tab

| Electron Dosyası | PyQt6 Karşılığı | Açıklama |
|------------------|-----------------|----------|
| `src/tabs/models.js` | `LLM-Runner-AIO/launcher/tabs/models.py` | **Model yönetimi.** GGUF tarama, çoklu seçim, silme, download progress, hash doğrulama. |

#### Birebir Fonksiyon Eşleşmeleri

| `models.js` | `models.py` | İşlev |
|-------------|-------------|-------|
| `scanModels(dir)` | `_scan_models()` | Recursive `.gguf` dosya taraması |
| `deleteSelected()` | `_delete_selected()` | Seçili model(ler)i silme |
| `renderModelList(files)` | `model_list.clear()` + `addItem()` | Model listesini UI'a çizme |
| `selectModel(index)` | (checkbox state) | Tekli/chackbox seçimi |
| `verifySHA256(filePath, expectedHash)` | `_calculate_sha256()` | SHA256 hash hesaplama ve karşılaştırma |
| `cleanupPartialFiles(folder, filename)` | `_cleanup_partial_files()` | Disk dolunca kalan `.part` dosyalarını temizleme |

---

## 4. Utility & Yardımcı Dosyalar

| Electron Dosyası | PyQt6 Karşılığı | Açıklama |
|------------------|-----------------|----------|
| `src/utils/config.js` | `LLM-Runner-AIO/launcher/app.py` (`Config` class) | **JSON config yönetimi.** `config.json` okuma/yazma, atomic write (fsync + rename), default değerler. |
| `src/utils/i18n.js` | `LLM-Runner-AIO/launcher/app.py` (`AppManager.lang`) | **Çoklu dil desteği.** 8 dil dosyasından (`en/tr/de/es/fr/pt/zh/ja.json`) çeviri çekme, fallback mekanizması. |
| `src/utils/helpers.js` | `LLM-Runner-AIO/launcher/app.py` (yardımcı fonksiyonlar) | **Yardımcı fonksiyonlar.** `formatBytes()`, `sleep()`, `retry()`, `isValidPort()`, `sanitizeFilename()` gibi genel amaçlı utility'ler. |
| `src/utils/logger.js` | `logging` Python modülü (main.py'de kullanılır) | **Loglama sistemi.** Console log, renk kodları (info=green, warning=yellow, error=red), log seviyesi ayarlama. |

### Birebir Fonksiyon Eşleşmeleri

| `helpers.js` | `app.py` / Diğer | İşlev |
|--------------|-------------------|-------|
| `formatBytes(bytes)` | (yok — yeni) | Bayt → GB/MB/KB formatı |
| `sleep(ms)` | `time.sleep()` | Asenkron bekleme |
| `retry(fn, maxRetries, delay)` | (yok — yeni) | Hata durumunda tekrar deneme mekanizması |
| `isValidPort(port)` | (yok — yeni) | Port geçerlilik kontrolü (1-65535) |
| `sanitizeFilename(name)` | (yok — yeni) | Dosya adı temizleme (özel karakterler) |

| `i18n.js` | `app.py` | İşlev |
|-----------|---------|-------|
| `loadLanguage(code)` | `AppManager._load_language()` | Dil dosyasını JSON olarak yükler |
| `t(key, params)` | `AppManager.lang.get()` | Çeviri anahtarını çöz + parametre yerine koy |
| `getAvailableLanguages()` | (hardcoded list) | Desteklenen dilleri listeler |

| `config.js` | `app.py` | İşlev |
|-------------|---------|-------|
| `readConfig()` | `Config.get()` | `config.json` dosyasını parse eder |
| `writeConfig(data)` | `Config.set()` | Atomic write (temp → rename) |
| `getConfigValue(key, default)` | `Config.get(key, default)` | Tek bir değeri getirir |

---

## 5. Worker & Arka Plan Servisleri

| Electron Dosyası | PyQt6 Karşılığı | Açıklama |
|------------------|-----------------|----------|
| `src/workers/process-manager.js` | (Python'da doğrudan karşılık yok) | **Process tree yönetimi.** `child_process.spawn`, `treeKill`, process stdout/stderr pipe'leme. Python'da `psutil` kullanılıyordu. |
| `src/workers/function-sync-api.js` | `LLM-Runner-AIO/import_functions_api.py` | **OpenWebUI function sync (API).** HTTP POST ile `/api/v1/functions/sync` endpoint'ine fonksiyon gönderme. |
| `src/workers/function-sync-direct-db.js` | `LLM-Runner-AIO/import_functions.py` | **Direct SQLite sync.** `better-sqlite3` ile OpenWebUI database'ine direkt erişim, fonksiyon upsert işlemleri. |
| `src/workers/vane-integration.js` | (Python'da doğrudan karşılık yok) | **Vane Next.js entegrasyonu.** Static export kontrolü, `npm run build` çalıştırma, `loadFile()` entegrasyonu. |

### Birebir Fonksiyon Eşleşmeleri

| `process-manager.js` | Python'daki Yaklaşım | İşlev |
|----------------------|---------------------|-------|
| `spawnServer(cmd, args, env)` | `subprocess.Popen()` | Server process'ini başlatır |
| `killProcessTree(pid)` | `psutil.Process(pid).kill()` | Process ve alt process'lerini öldürür |
| `streamOutput(child, callback)` | `worker_thread` stdout pipe | Process çıktısını gerçek zamanlı okur |

| `function-sync-api.js` | `import_functions_api.py` | İşlev |
|------------------------|---------------------------|-------|
| `syncFunctionsToServer(url, functions)` | `import_from_api()` | API üzerinden fonksiyon senkronize |

| `function-sync-direct-db.js` | `import_functions.py` | İşlev |
|------------------------------|------------------------|-------|
| `syncFunctionsToLocalDB(dbPath, functions)` | `import_from_local()` | SQLite DB'ye direkt fonksiyon yazma |

| `vane-integration.js` | (Python'da yok) | İşlev |
|------------------------|----------------|-------|
| `checkVaneExport()` | (yok) | Vane'in Next.js static export'unun varlığını kontrol eder |
| `buildVane()` | (yok) | `npm run build` çalıştırarak Vane'i derler |
| `setVaneLoadFile(path)` | (yok) | Vane'in `loadFile` yapılandırmasını günceller |

---

## 6. Konfigürasyon & Dil Dosyaları

### 6.1 Dil Dosyaları

| Electron Konumu | PyQt6 Konumu | Açıklama |
|-----------------|--------------|----------|
| `src/lang/en.json` | `LLM-Runner-AIO/launcher/lang/en.json` | 🇬🇧 İngilizce |
| `src/lang/tr.json` | `LLM-Runner-AIO/launcher/lang/tr.json` | 🇹🇷 Türkçe |
| `src/lang/de.json` | `LLM-Runner-AIO/launcher/lang/de.json` | 🇩🇪 Almanca |
| `src/lang/es.json` | `LLM-Runner-AIO/launcher/lang/es.json` | 🇪🇸 İspanyolca |
| `src/lang/fr.json` | `LLM-Runner-AIO/launcher/lang/fr.json` | 🇫🇷 Fransızca |
| `src/lang/pt.json` | `LLM-Runner-AIO/launcher/lang/pt.json` | 🇵🇹 Portekizce |
| `src/lang/zh.json` | `LLM-Runner-AIO/launcher/lang/zh.json` | 🇨🇳 Çince |
| `src/lang/ja.json` | `LLM-Runner-AIO/launcher/lang/ja.json` | 🇯🇵 Japonca |

> ⚠️ **Not:** Dil dosyaları `src/lang/` dizinine taşındı. PyQt6'daki orijinal konum `launcher/lang/`.

### 6.2 INI & BAT Dosyaları

| Root Dizin | PyQt6'daki Konum | Açıklama |
|------------|------------------|----------|
| `gpu1vram4ram16models.ini` | `LLM-Runner-AIO/LLM-Runner-AIO/gpu1vram4ram16models.ini` | 4GB VRAM / 16GB RAM için model konfigürasyonu |
| `gpu1vram6ram16models.ini` | `LLM-Runner-AIO/LLM-Runner-AIO/gpu1vram6ram16models.ini` | 6GB VRAM / 16GB RAM |
| `gpu1vram6ram32models.ini` | `LLM-Runner-AIO/LLM-Runner-AIO/gpu1vram6ram32models.ini` | 6GB VRAM / 32GB RAM |
| `gpu1vram8ram32models.ini` | `LLM-Runner-AIO/LLM-Runner-AIO/gpu1vram8ram32models.ini` | 8GB VRAM / 32GB RAM |
| `gpu1vram12ram32models.ini` | `LLM-Runner-AIO/LLM-Runner-AIO/gpu1vram12ram32models.ini` | 12GB VRAM / 32GB RAM |
| `gpu1vram16ram32models.ini` | `LLM-Runner-AIO/LLM-Runner-AIO/gpu1vram16ram32models.ini` | 16GB VRAM / 32GB RAM |
| `gpu1vram24ram32models.ini` | `LLM-Runner-AIO/LLM-Runner-AIO/gpu1vram24ram32models.ini` | 24GB VRAM / 32GB RAM |
| `gpu1vram32ram32models.ini` | `LLM-Runner-AIO/LLM-Runner-AIO/gpu1vram32ram32models.ini` | 32GB+ VRAM / 32GB RAM |
| `model_urls.json` | `LLM-Runner-AIO/LLM-Runner-AIO/model_urls.json` | HuggingFace URL'leri (INI section bazlı) |
| `start_gpu*.bat` | `LLM-Runner-AIO/LLM-Runner-AIO/start_gpu*.bat` | Her INI profili için otomatik başlatma scripti |

---

## 7. Root Dizin Scriptleri

| Electron Root | PyQt6 Root | Açıklama |
|---------------|------------|----------|
| `run.bat` | `LLM-Runner-AIO/LLM-Runner-AIO/run.bat` | **Ana bootstrap script.** npm install → migration → Electron başlatma |
| `package.json` | (yok — yeni) | Node.js package manifest (dependencies, scripts) |
| `electron-builder.json` | (yok — yeni) | `.exe/.msi` packaging konfigürasyonu |
| `requirements.txt` | `LLM-Runner-AIO/requirements.txt` | Python bağımlılıkları (artık kullanılmıyor) |
| `migrate_ini_to_urls.js` | `LLM-Runner-AIO/migrate_ini_to_urls.py` | INI dosyalarındaki URL'leri `model_urls.json`'a çıkarır |
| `remove_ctx_from_ini.py` | `LLM-Runner-AIO/remove_ctx_from_ini.py` | INI dosyalarından context length parametresini kaldırır |
| `create_desktop_shortcut.bat` | `LLM-Runner-AIO/create_shortcut.py` | Masaüstü kısayolu oluşturma |

---

## 8. AI Servis Dizini Yapısı

Her servis kendi dizininde ve bağımsız çalışır:

```
LLM-Runner-AIO/
├── searxng/              # Python web aramotoru (uvicorn ile çalışır)
│   └── run.bat           # Başlatma scripti
├── openwebui/            # Web UI (Python + Uvicorn)
│   ├── backend/          # OpenWebUI backend
│   └── frontend/         # React tabanlı frontend
├── llama.cpp-cuda13+vulkan/  # GGUF model inference engine
│   └── llama-server.exe  # Windows binary
└── Vane/                 # Next.js web uygulaması
    ├── .next/            # Build output
    └── package.json      # Next.js dependencies
```

---

## 🗺️ Mimari Karşılaştırma

```
┌─────────────────────────────────────────────────────┐
│                  PYQT6 MİMARİSİ                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  launcher/main.py                                   │
│  ├── QApplication                                  │
│  ├── MainWindow (ui/main_window.py)                │
│  │   ├── Tabs (system_detection, servers, ...)     │
│  │   ├── Toolbar                                   │
│  │   └── System Tray                               │
│  ├── AppManager (app.py)                           │
│  │   ├── Config                                    │
│  │   ├── Language Manager                          │
│  │   └── Logging                                   │
│  └── QThread Workers                               │
│      ├── DownloadThread                            │
│      └── ServerWorker                              │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│               ELECTRON MİMARİSİ                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  electron/main.js                                   │
│  ├── BrowserWindow                                   │
│  ├── IPC Handlers                                    │
│  ├── System Tray                                     │
│  └── Process Management                              │
│                                                     │
│  src/renderer.js                                    │
│  ├── DOM Manipulation                                │
│  ├── Event Listeners                                 │
│  └── Tab Switching                                   │
│                                                     │
│  src/tabs/*.js                                      │
│  ├── system-detection.js  ← system_detection.py     │
│  ├── picoding.js          ← picoding.py             │
│  └── models.js            ← models.py               │
│                                                     │
│  src/workers/*.js                                   │
│  ├── server-manager.js    ← servers.py              │
│  ├── process-manager.js   ← subprocess/psutil       │
│  ├── vane-integration.js  ← (yeni)                  │
│  └── function-sync*.js    ← import_functions*.py    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 📊 Migration Özet Tablosu

| Kategori | PyQt6 Dosya Sayısı | Electron Dosya Sayısı | Durum |
|----------|-------------------|----------------------|-------|
| Ana İşlem | 1 (`main.py`) | 1 (`main.js`) | ✅ Tamamlandı |
| UI/Render | 2 (`main_window.py`, `toolbar.py`, `tray.py`) | 3 (`index.html`, `style.css`, `renderer.js`) | ✅ Tamamlandı |
| Tab'lar | 4 (`system_detection.py`, `servers.py`, `picoding.py`, `models.py`) | 3 (`system-detection.js`, `picoding.js`, `models.js`) + 1 (`server-manager.js`) | ✅ Tamamlandı |
| Utility | 1 (`app.py`) | 4 (`config.js`, `i18n.js`, `helpers.js`, `logger.js`) | ✅ Tamamlandı |
| Worker | 2 (thread'ler) | 5 (`server-manager.js`, `process-manager.js`, `vane-integration.js`, `function-sync*.js`) | ✅ Tamamlandı |
| Dil Dosyaları | 8 JSON | 8 JSON (taşındı) | ✅ Tamamlandı |
| **TOPLAM** | **~20 Python dosyası** | **~22 JS/HTML/CSS dosyası** | **%100 Migrasyon** |

---

## 🔍 Notlar

1. **Silinen PyQt6 Dosyalar:** `launcher/` dizörü tamamen temizlendi (legacy cleanup sonrası).
2. **Taşınan Dil Dosyaları:** `launcher/lang/` → `src/lang/`
3. **Yeni Özellikler:** `system-detection.js` VRAM-based model recommendation ve `vane-integration.js` Next.js build yönetimi PyQt6'da yoktu.
4. **Korunan DOSYALAR:** `config.json` hala `launcher/config.json` konumunda (tek kalan PyQt6 dosyası).
5. **Cross-platform:** Electron versiyonu Windows/macOS/Linux desteklerken, PyQt6 sadece Windows'a odaklanmıştı.

---

*Bu doküman otomatik olarak Electron migrasyonu sırasında oluşturulmuştur.*
