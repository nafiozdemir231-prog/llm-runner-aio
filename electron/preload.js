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
         * PyQt6'da: ConfigManager._save() — os.replace + fsync
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
        detect: () => ipcRenderer.invoke('detect-hardware')
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
         * Sunucu durumu kontrolü
         * PyQt6'da: ServerWorker.is_running
         */
        getStatus: (serverType) => {
            return new Promise((resolve) => {
                const handler = (event, data) => {
                    if (data.type === serverType) {
                        ipcRenderer.removeListener('server-status', handler);
                        resolve(data);
                    }
                };
                ipcRenderer.on('server-status', handler);
                ipcRenderer.send('get-server-status', serverType);
            });
        },
        
        /**
         * Sunucu log mesajlarını dinle
         * PyQt6'da: QTextEdit.append() — stdout/stderr stream
         */
        onLog: (callback) => {
            ipcRenderer.on('server-log', (event, data) => callback(data));
        },
        
        /**
         * Sunucu hata mesajlarını dinle
         * PyQt6'da: QTextEdit.append() — stderr stream
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
        download: (url, destFolder) => ipcRenderer.invoke('model-download', url, destFolder),
        
        /**
         * İndirme ilerlemesini dinle
         * PyQt6'da: pyqtSignal(value) → QProgressBar.setValue()
         */
        onProgress: (callback) => {
            ipcRenderer.on('download-progress', (event, data) => callback(data));
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
         * Models klasörünü tara (.gguf dosyaları)
         * PyQt6'da: scan_models() fonksiyonu
         */
        scan: (modelsDir) => {
            return new Promise((resolve) => {
                ipcRenderer.once('models-scanned', (event, data) => {
                    resolve(data);
                });
                ipcRenderer.send('scan-models', modelsDir);
            });
        },
        
        /**
         * Model sil
         * PyQt6'da: delete_selected_models()
         */
        delete: (filePath) => {
            return ipcRenderer.invoke('model-delete', filePath);
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
         * PyQt6'da: _save_advisor_config() — config.json + mcp_web_reader.py
         */
        saveAdvisor: (advisorData) => ipcRenderer.invoke('mcp-update-advisor-file', advisorData),
        
        /**
         * MCP Advisor ayarlarını yükle
         * PyQt6'da: _load_advisor_config()
         */
        getAdvisor: () => ipcRenderer.invoke('picoding-get-advisor')
    },
    
    // ============================================
    // Database Operations (PyQt6 _load_database)
    // ============================================
    database: {
        /**
         * OpenWebUI veritabanı yükle
         * PyQt6'da: _load_database() — .db dosyasını kopyala + eski'yi yedekle
         */
        load: (dbFilePath) => ipcRenderer.invoke('db-load', dbFilePath),
        
        /**
         * Model SHA256 doğrula
         * PyQt6'da: _calculate_sha256() + hash karşılaştırması
         */
        verifySHA256: (filePath, expectedHash) => ipcRenderer.invoke('model-verify-sha256', filePath, expectedHash)
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
    // Shell Integration (os.startfile / shell.openItem karşılığı)
    // ============================================
    shell: {
        /**
         * Dosya/yolu dış uygulamada aç
         * PyQt6'da: QDesktopServices.openUrl()
         */
        openExternal: (url) => shell.openExternal(url),
        
        /**
         * Dosyayı bulucu'da göster
         * PyQt6'da: QGuiApplication::focusWindow() + explorer /select
         */
        revealInFinder: (filePath) => ipcRenderer.invoke('shell-reveal', filePath),
        
        /**
         * Klasörü aç
         */
        openPath: (filePath) => ipcRenderer.invoke('shell-open-path', filePath)
    },
    
    // ============================================
    // System Information (systeminformation paketi)
    // ============================================
    system: {
        /**
         * Sistem bilgilerini al (CPU, memory, OS, diskler)
         * PyQt6'da: psutil + os.uname()
         */
        getInfo: () => ipcRenderer.invoke('system-getinfo'),
        
        /**
         * Port kontrolü
         * PyQt6'da: is_port_in_use() utility
         */
        checkPort: (port) => ipcRenderer.invoke('system-check-port', port)
    },
    
    // ============================================
    // Event Listeners (pyqtSignal pattern'ının JS karşılığı)
    // ============================================
    events: {
        /**
         * Generic event listener ekle
         * PyQt6'da: signal.connect(callback)
         */
        on: (eventName, callback) => {
            ipcRenderer.on(eventName, (event, ...args) => callback(...args));
        },
        
        /**
         * Tek seferlik event listener
         * PyQt6'da: signal.connect_once(callback)
         */
        once: (eventName, callback) => {
            ipcRenderer.once(eventName, (event, ...args) => callback(...args));
        },
        
        /**
         * Event listener'ı kaldır
         * PyQt6'da: signal.disconnect(callback)
         */
        removeListener: (eventName, callback) => {
            ipcRenderer.removeListener(eventName, callback);
        },
        
        /**
         * Event gönder
         * PyQt6'da: signal.emit(data)
         */
        send: (eventName, data) => {
            ipcRenderer.send(eventName, data);
        }
    },
    
    // ============================================
    // App Control (QCoreApplication karşılığı)
    // ============================================
    app: {
        /**
         * Uygulamayı yeniden başlat
         */
        restart: () => ipcRenderer.invoke('app-restart'),
        
        /**
         * Uygulamayı kapat
         * PyQt6'da: qapp.quit()
         */
        quit: () => ipcRenderer.invoke('app-quit'),
        
        /**
         * Uygulama sürümünü al
         */
        getVersion: () => ipcRenderer.invoke('app-version'),
        
        /**
         * Platform bilgisini al
         */
        getPlatform: () => process.platform
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
        ipcSend: (channel, data) => ipcRenderer.send(channel, data),
        ipcInvoke: (channel, data) => ipcRenderer.invoke(channel, data),
        listChannels: () => {
            console.log('[DEV] Available IPC channels:');
            console.log('  - config-read / config-write');
            console.log('  - lang-read');
            console.log('  - detect-hardware');
            console.log('  - server-start / server-stop');
            console.log('  - model-download');
            console.log('  - cleanup-orphan-processes');
        }
    };
    console.log('[DEV] Developer helpers attached to window.__electronDev');
}
