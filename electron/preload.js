/**
 * LLM Runner AIO - Preload Script
 *
 * Context Bridge: Main process ile Renderer process arasında güvenli iletişim köprüsü
 * PyQt6'da pyqtSignal + QObject pattern'ının Electron karşılığı
 *
 * Güvenlik: contextIsolation: true + nodeIntegration: false
 * Renderer process sadece bu API'ye erişebilir
 */

const { contextBridge, ipcRenderer } = require('electron');

// ============================================
// Güvenli API Maruziyeti (contextBridge.exposeInMainWorld)
// ============================================
// HAT-09: Renderer'in dinleyebildigi event kanallari (beyaz liste)
const ALLOWED_EVENT_CHANNELS = ['server-log', 'server-error', 'server-stopped', 'server-running', 'wan2gp-setup-log', 'strata-setup-log'];

contextBridge.exposeInMainWorld('electronAPI', {

    // ============================================
    // Config Management (ConfigManager.py karşılığı)
    // ============================================
    config: {
        /**
         * Config dosyasını oku
         * PyQt6'da: ConfigManager._load()
         */
        read: () => ipcRenderer.invoke('config-read'),

        /**
         * Config dosyasına yaz (atomic write)
         * PyQt6'da: ConfigManager._save() - os.replace + fsync
         */
        write: (configData) => ipcRenderer.invoke('config-write', configData)
    },

    // ============================================
    // Internationalization (LanguageManager.py karşılığı)
    // ============================================
    lang: {
        /**
         * Belirli dili yükle ve string map'ini al
         * PyQt6'da: LanguageManager._load(lang_code)
         */
        read: (langCode) => ipcRenderer.invoke('lang-read', langCode),

        /**
         * Dil değişikliği event'ini dinle
         * PyQt6'da: self.lang.lang_changed.connect(callback)
         */
        onLangChange: (callback) => {
            ipcRenderer.on('lang-changed', (event, data) => callback(data));
        }
    },

    // ============================================
    // Hardware Detection (system_detection.py karşılığı)
    // ============================================
    hardware: {
        /**
         * Donanım bilgilerini tespit et (GPU, VRAM, RAM, CPU)
         * PyQt6'da: SystemDetectionTab.detect_hardware()
         */
        detect: () => ipcRenderer.invoke('detect-hardware'),
        stats: () => ipcRenderer.invoke('get-system-stats')
    },

    // ============================================
    // Server Management (servers.py karşılığı)
    // ============================================
    server: {
        /**
         * Sunucu başlat
         * PyQt6'da: SearXNGWorker.start_server_internal() vb.
         */
        start: (serverType, options) => ipcRenderer.invoke('server-start', serverType, options),

        /**
         * Sunucu durdur
         * PyQt6'da: ServerWorker.stop_process(timeout=10)
         */
        stop: (serverType) => ipcRenderer.invoke('server-stop', serverType),

        /**
         * Sunucu log mesajlarını dinle
         * PyQt6'da: QTextEdit.append() - stdout/stderr stream
         */
        onLog: (callback) => {
            ipcRenderer.on('server-log', (event, data) => callback(data));
        },

        /**
         * Sunucu hata mesajlarını dinle
         * PyQt6'da: QTextEdit.append() - stderr stream
         */
        onError: (callback) => {
            ipcRenderer.on('server-error', (event, data) => callback(data));
        },

        /**
         * Sunucu durdu event'ini dinle
         * PyQt6'da: pyqtSignal emit edildiğinde
         */
        onStop: (callback) => {
            ipcRenderer.on('server-stopped', (event, data) => callback(data));
        },

        /**
         * Sunucu güncelle
         * PyQt6'da: yok - Electron特有 fonksiyon
         */
        update: (serverType) => ipcRenderer.invoke('server-update', serverType)
    },

    // ============================================
    // Wan2GP (video üretimi) — durum & kurulum
    // ============================================
    wan2gp: {
        /**
         * Kurulum durumu (clone/venv/pip işaretleri + önerilen preset)
         */
        status: () => ipcRenderer.invoke('wan2gp-status'),

        /**
         * Kurulumu çalıştır (clone + ayrı venv + pip install)
         */
        setup: (options) => ipcRenderer.invoke('wan2gp-setup', options),

        /**
         * Repo'yu son sürüme güncelle (git pull)
         */
        update: () => ipcRenderer.invoke('wan2gp-update'),

        /**
         * Kurulum ilerleme loglarını dinle
         */
        onSetupLog: (callback) => {
            ipcRenderer.on('wan2gp-setup-log', (event, data) => callback(data));
        }
    },

    // ============================================
    // Strata (Qwen3.8-Flash-Next çoklu-model gateway, port 1235)
    // ============================================
    strata: {
        /** Durum: uygunluk (RAM>=48/VRAM>=12), kurulu mu, çalışıyor mu, port/host, model seçenekleri */
        status: () => ipcRenderer.invoke('strata-status'),

        /** Model kurulumu/indirmesi (START-HERE.bat --yes --model <size>, modeller models\ klasörüne) */
        setup: (options) => ipcRenderer.invoke('strata-setup', options),

        /** Donanım kalibrasyonu (START-HERE.bat --calibrate, ~5-10 dk) */
        calibrate: () => ipcRenderer.invoke('strata-calibrate'),

        /** Kapı config okuma/yazma (context, PC/YerelAg, port; yedekli) */
        configRead: () => ipcRenderer.invoke('strata-config-read'),
        configWrite: (options) => ipcRenderer.invoke('strata-config-write', options),

        /** Gateway başlat/durdur (ark sunucular kapıyla birlikte ölür) */
        start: () => ipcRenderer.invoke('strata-start'),
        stop: () => ipcRenderer.invoke('strata-stop'),

        /** Upstream güncelleme (git pull + setup.py --update) */
        update: () => ipcRenderer.invoke('strata-update'),

        /** Strata bağlantısını Open WebUI OpenAI bağlantı listesine ekle (DB kalıcı) */
        connectOpenWebui: () => ipcRenderer.invoke('strata-connect-openwebui'),

        /** Kurulum/kapı loglarını dinle */
        onSetupLog: (callback) => {
            ipcRenderer.on('strata-setup-log', (event, data) => callback(data));
        }
    },

    // ============================================
    // Model Download (models.py/hf_hub_download karşılığı)
    // ============================================
    model: {
        /**
         * Model indir (streaming download)
         * PyQt6'da: hf_hub_download() + progress signal
         */
        download: (url, destFolder, taskId) => ipcRenderer.invoke('model-download', url, destFolder, taskId),

        /**
         * İndirme ilerlemesini dinle (tek API - HAT-14)
         * PyQt6'da: pyqtSignal(value) → QProgressBar.setValue()
         * Donen fonksiyon listener'i kaldirir (off()).
         */
        onProgress: (callback) => {
            const handler = (event, data) => callback(data);
            ipcRenderer.on('download-progress', handler);
            return () => ipcRenderer.removeListener('download-progress', handler);
        },

        /**
         * INI preset listesi al (llama.cpp için)
         * PyQt6'da: get_available_ini_presets()
         */
        getINIPresets: () => ipcRenderer.invoke('get-llama-ini-presets'),

        /**
         * INI dosyasından model listesini al
         * PyQt6'da: _load_ini_models()
         */
        getModelsFromINI: (iniName) => ipcRenderer.invoke('model-get-models-from-ini', iniName),

        /**
         * Yerel INI oluştur (URL'leri yerel yollara çevir)
         * PyQt6'da: _create_local_ini()
         */
        generateLocalINI: (iniName) => ipcRenderer.invoke('model-generate-local-ini', iniName),

        /**
         * model_urls.json'dan URL al
         * PyQt6'da: _get_urls_from_json(ini_name, section_name)
         */
        getUrlsFromJSON: (iniName, sectionName) => {
            return ipcRenderer.invoke('model-get-urls-from-json', iniName, sectionName);
        },

        /**
         * Models klasörünü tara (.gguf dosyaları)
         * PyQt6'da: scan_models() fonksiyonu
         */
        scan: (modelsDir) => {
            return ipcRenderer.invoke('scan-models', modelsDir);
        },

        /**
         * Model sil
         * PyQt6'da: delete_selected_models()
         */
        delete: (filePath) => {
            return ipcRenderer.invoke('model-delete', filePath);
        },

        /**
         * Birden fazla model sil
         * PyQt6'da: multi-selection ile silme
         */
        deleteMultiple: (filePaths) => {
            return ipcRenderer.invoke('model-delete-multiple', filePaths);
        },

        /**
         * Dosya var mı kontrol et
         */
        fileExists: (filePath) => {
            return ipcRenderer.invoke('file-exists', filePath);
        },

        /**
         * Aktif INI'nin bölüm listesini al (GUI model yönetimi)
         */
        getSections: (iniName) => {
            return ipcRenderer.invoke('preset-get-sections', iniName);
        },

        /**
         * Model bölümünü ekle/düzenle (INI + model_urls.json)
         * payload: { iniName, sectionName, modelUrl, mmprojUrl? }
         */
        saveSection: (payload) => {
            return ipcRenderer.invoke('preset-save-section', payload);
        },

        /**
         * Model bölümünü sil (INI + model_urls.json kaydi birlikte)
         */
        deleteSection: (iniName, sectionName) => {
            return ipcRenderer.invoke('preset-delete-section', iniName, sectionName);
        },

        /**
         * Secili INI dosyasini sistem varsayilan uygulamasinda ac
         */
        openIniFile: (iniName) => {
            return ipcRenderer.invoke('ini-open-file', iniName);
        },

        /**
         * URL sağlık kontrolü (istek üzerine, otomatik değil)
         */
        checkUrls: (urls) => {
            return ipcRenderer.invoke('url-check', urls);
        }
    },

    // ============================================
    // PiCoding Agent (picoding.py karşılığı)
    // ============================================
    picoding: {
        /**
         * Proje dizinini tespit et
         * PyQt6'da: _detect_project()
         */
        detectProject: () => ipcRenderer.invoke('picoding-detect-project'),

        /**
         * PATH'e ekle
         * PyQt6'da: _add_to_path()
         */
        addToPath: () => ipcRenderer.invoke('picoding-add-to-path'),

        /**
         * MCP Advisor ayarlarını kaydet + mcp_web_reader.py güncelle
         * PyQt6'da: _save_advisor_config() - config.json + mcp_web_reader.py
         */
        saveAdvisor: (advisorData) => ipcRenderer.invoke('picoding-save-advisor', advisorData),

        /**
         * MCP Advisor ayarlarını yükle
         * PyQt6'da: _load_advisor_config()
         */
        getAdvisor: () => ipcRenderer.invoke('picoding-get-advisor'),

        /**
         * API'den mevcut modelleri listele
         * Provider turune gore otomatik endpoint secimi
         */
        fetchModels: (apiUrl, apiKey, providerType) => ipcRenderer.invoke('picoding-fetch-models', apiUrl, apiKey, providerType),

        /**
         * Faz 14: Provider listesi (providers.json) — oku / kaydet
         */
        getProviders: () => ipcRenderer.invoke('picoding-get-providers'),
        saveProviders: (list) => ipcRenderer.invoke('picoding-save-providers', list),

        /**
         * PiCoding repository'ini guncelle (git pull)
         */
        update: () => ipcRenderer.invoke('picoding-update')
    },



    // ============================================
    // System Cleanup (orphan process temizliği)
    // ========================================
    cleanup: {
        /**
         * Geride kalan process'leri temizle
         * PyQt6'da: cleanup_orphan_processes()
         */
        orphan: () => ipcRenderer.invoke('cleanup-orphan-processes')
    },

    // ============================================
    // File Dialog (QFileDialog karşılığı)
    // ============================================
    dialog: {
        /**
         * Dosya seç dialogu aç
         * PyQt6'da: QFileDialog.getOpenFileName()
         */
        openFile: (options) => ipcRenderer.invoke('dialog-open-file', options),

        /**
         * Klasör seç dialogu aç
         * PyQt6'da: QFileDialog.getExistingDirectory()
         */
        openFolder: (options) => ipcRenderer.invoke('dialog-open-folder', options),

        /**
         * Kaydet dialogu aç
         * PyQt6'da: QFileDialog.getSaveFileName()
         */
        saveFile: (options) => ipcRenderer.invoke('dialog-save-file', options)
    },

    // ============================================
    // Notification (QMessageBox karşılığı)
    // ============================================
    notification: {
        /**
         * Bilgi mesajı göster
         * PyQt6'da: QMessageBox.information()
         */
        info: (title, message) => ipcRenderer.invoke('notification-info', title, message),

        /**
         * Uyarı mesajı göster
         * PyQt6'da: QMessageBox.warning()
         */
        warning: (title, message) => ipcRenderer.invoke('notification-warning', title, message),

        /**
         * Hata mesajı göster
         * PyQt6'da: QMessageBox.critical()
         */
        error: (title, message) => ipcRenderer.invoke('notification-error', title, message),

        /**
         * Onay sorusu göster
         * PyQt6'da: QMessageBox.question()
         */
        confirm: (title, message) => ipcRenderer.invoke('notification-confirm', title, message)
    },



    // ============================================
    // Event Listeners (pyqtSignal pattern'ının JS karşılığı)
    // ============================================
    events: {
        /**
         * Beyaz listedeki event kanallarindan birini dinle (HAT-09)
         * Ham IPC yuzeyi kapandi; listede olmayan kanal engellenir.
         */
        on: (eventName, callback) => {
            if (!ALLOWED_EVENT_CHANNELS.includes(eventName)) {
                console.warn('[PRELOAD] Engellenen event kanali:', eventName);
                return;
            }
            ipcRenderer.on(eventName, (event, ...args) => callback(...args));
        },

        /**
         * Event listener'i kaldir (yalnizca beyaz listede)
         */
        removeListener: (eventName, callback) => {
            if (!ALLOWED_EVENT_CHANNELS.includes(eventName)) return;
            ipcRenderer.removeListener(eventName, callback);
        }
    },

    // ============================================
    // App Control (QCoreApplication karşılığı)
    // ============================================
    app: {
        /**
         * Platform bilgisini al
         */
        getPlatform: () => process.platform
    },

    // ============================================
    // Shell (Shell.openExternal / os.startfile karşılığı)
    // ============================================
    shell: {
        /**
         * Harici URL'yi varsayılan tarayıcıda aç (IPC ile)
         * PyQt6'da: QDesktopServices.openUrl(QUrl(url))
         */
        openExternal: (url) => ipcRenderer.invoke('shell-open-url', url),

        /**
         * function/ dizinini Windows Explorer'da ac
         */
        openPathFunctionFolder: () => ipcRenderer.invoke('shell-open-path-func-folder')
    },

    // ============================================
    // Path Utilities (path.join / Path(__file__) karşılığı)
    // ============================================
    paths: {
        /**
         * Proje root dizinini al
         * PyQt6'da: ROOT = Path(__file__).parent.parent
         */
        getProjectRoot: () => ipcRenderer.invoke('paths-project-root'),

        /**
         * Launcher dizinini al
         * PyQt6'da: LAUNCHER_DIR = ROOT / "launcher"
         */
        getLauncherDir: () => ipcRenderer.invoke('paths-launcher-dir'),

        /**
         * Models dizinine tam yolu oluştur
         * PyQt6'da: MODELS_DIR = ROOT / "models"
         */
        getModelsDir: () => ipcRenderer.invoke('paths-models-dir')
    },

    // ============================================
    // Database Management (QFileDialog + file.copy karşılığı)
    // ============================================
    db: {
        /**
         * Veritabanı dosyasını yükle ve mevcut DB'yi yedekle
         * PyQt6'da: _load_database(db_file)
         */
        load: (dbFilePath) => ipcRenderer.invoke('db-load', dbFilePath),

        /**
         * Fonksiyonlari veritabani'na ic aktar (HAT-03)
         * Main tarafinda desteklenmiyorsa nazik hata doner.
         */
        importFunctions: () => ipcRenderer.invoke('db-import-functions'),

        /**
         * Model SHA256 doğrula
         * PyQt6'da: _calculate_sha256() + hash karşılaştırması
         */
        verifySHA256: (filePath, expectedHash) => ipcRenderer.invoke('model-verify-sha256', filePath, expectedHash)
    },

    // ============================================
    // Autostart (Windows Registry)
    // ============================================
    autostart: {
        /**
         * Windows başlangıcına ekle (registry)
         */
        enable: () => ipcRenderer.invoke('autostart-enable'),

        /**
         * Windows başlangıcından kaldır (registry)
         */
        disable: () => ipcRenderer.invoke('autostart-disable'),

        /**
         * Aktif mi kontrol et
         */
        check: () => ipcRenderer.invoke('autostart-check')
    },

    // ============================================
    // Window Controls (Frameless icin)
    // ============================================
    window: {
        minimize: () => ipcRenderer.send('window-minimize'),
        maximize: () => ipcRenderer.send('window-maximize'),
        close: () => ipcRenderer.send('window-close')
    },
    
    // ============================================
    // System Tray Management
    // ============================================
    tray: {
        /**
         * Tray menüsünü güncelle
         */
        updateMenu: () => ipcRenderer.invoke('tray-update-menu'),
        
        /**
         * Server durumlarını al
         */
        getServerStates: () => ipcRenderer.invoke('get-server-states')
    }
});

// ============================================
// Console Logging (Geliştirme Dostu)
// ============================================
console.log('[PRELOAD] LLM Runner AIO context bridge initialized');
console.log('[PRELOAD] World API exposed: window.electronAPI');

// ============================================
// Development Helpers (Sadece --dev modunda)
// ============================================
if (process.argv.includes('--dev')) {
    window.__electronDev = {
        // HAT-09: ham ipcSend/ipcInvoke kaldirildi (genis IPC yuzeyi)
        listChannels: () => {
            console.log('[DEV] Available IPC channels:');
            console.log('  - config-read / config-write');
            console.log('  - lang-read');
            console.log('  - detect-hardware');
            console.log('  - server-start / server-stop');
            console.log('  - model-download');
            console.log('  - cleanup-orphan-processes');
            console.log('  - tray-update-menu / get-server-states');
        }
    };
    console.log('[DEV] Developer helpers attached to window.__electronDev');
}
