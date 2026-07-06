/**
 * LLM Runner AIO - Config Manager
 * 
 * PyQt6 app.py'deki ConfigManager'ın Electron karşılığı
 * - Singleton pattern
 * - JSON dosyası CRUD
 * - Atomic write (os.replace + fsync eşdeğeri)
 * - Default değerler yönetimi
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor() {
        // Singleton kontrolü
        if (ConfigManager._instance) {
            return ConfigManager._instance;
        }
        
        // Path resolution (cross-platform)
        // PyQt6'da: ROOT = Path(__file__).parent.parent
        // Electron'da: app.isPackaged ? process.resourcesPath : __dirname
        this.rootPath = process.resourcesPath || __dirname;
        this.configPath = path.join(this.rootPath, '..', 'launcher', 'config.json');
        
        // Varsayılan değerler (PyQt6'daki _defaults ile birebir aynı)
        this.defaults = {
            theme: 'dark',
            font_size: 13,
            picoding_path: '',
            searxng_port: 8080,
            openwebui_port: 3000,
            llamacpp_port: 1234,
            llamacpp_ctx: 8192,
            start_with_windows: false,
            selected_ini: '',
            vram_gb: 0.0,
            ram_gb: 0.0,
            llamacpp_selected_model: '',
            auto_start_servers: false,
            started_servers: [],
            language: 'en',
            searxng_host: '0.0.0.0',
            openwebui_host: '127.0.0.1',
            llamacpp_host: '0.0.0.0',
            vane_host: '0.0.0.0'
        };
        
        this.data = {};
        this._load();
        
        ConfigManager._instance = this;
    }
    
    /**
     * Config dosyasını yükle
     * PyQt6'da: ConfigManager._load()
     */
    _load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, 'utf8');
                this.data = JSON.parse(raw);
                console.log('[CONFIG] Loaded from:', this.configPath);
            } else {
                this.data = {};
                console.log('[CONFIG] No config file found, using defaults');
            }
        } catch (err) {
            console.error('[CONFIG] Failed to load:', err.message);
            this.data = {};
        }
        
        // Eksik anahtarları default ile doldur
        for (const [key, defaultValue] of Object.entries(this.defaults)) {
            if (!(key in this.data)) {
                this.data[key] = defaultValue;
            }
        }
    }
    
    /**
     * Değer oku
     * @param {string} key - Anahtar adı
     * @param {*} defaultVal - Varsayılan değer (config'de yoksa)
     * @returns {*} Değer
     */
    get(key, defaultVal = undefined) {
        if (defaultVal !== undefined) {
            return this.data[key] !== undefined ? this.data[key] : defaultVal;
        }
        return this.data[key] !== undefined 
            ? this.data[key] 
            : this.defaults[key];
    }
    
    /**
     * Değer yaz (ve kaydet)
     * @param {string} key - Anahtar adı
     * @param {*} value - Yeni değer
     */
    set(key, value) {
        this.data[key] = value;
        this._save();
    }
    
    /**
     * Tüm veriyi döndür
     * @returns {Object} Tam config objesi
     */
    getAll() {
        return { ...this.data };
    }
    
    /**
     * Config'i güncelle (birden fazla alan)
     * @param {Object} updates - Güncellenecek alanlar
     */
    update(updates) {
        this.data = { ...this.data, ...updates };
        this._save();
    }
    
    /**
     * Config dosyasına güvenli yaz (atomic write)
     * PyQt6'da: os.replace() + fsync() pattern'ının JS karşılığı
     */
    _save() {
        try {
            // Üst dizini oluştur
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Temp dosyaya yaz
            const tempPath = this.configPath + '.tmp';
            const jsonStr = JSON.stringify(this.data, null, 2);
            fs.writeFileSync(tempPath, jsonStr, 'utf8');
            
            // flush ve fsync eşdeğeri (Node.js sync write zaten buffer'ı temizler)
            const fd = fs.openSync(tempPath, 'r');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            
            // Atomic rename (Windows'ta os.replace eşdeğeri)
            fs.renameSync(tempPath, this.configPath);
            
            console.log('[CONFIG] Saved to:', this.configPath);
        } catch (err) {
            console.error('[CONFIG] Save failed:', err.message);
            
            // Fallback: direkt yaz
            try {
                fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), 'utf8');
                console.log('[CONFIG] Fallback save succeeded');
            } catch (fallbackErr) {
                console.error('[CONFIG] Fallback also failed:', fallbackErr.message);
            }
        }
    }
    
    /**
     * Reset to defaults
     */
    reset() {
        this.data = { ...this.defaults };
        this._save();
    }
    
    /**
     * Config dosyasını sil
     */
    delete() {
        try {
            if (fs.existsSync(this.configPath)) {
                fs.unlinkSync(this.configPath);
                console.log('[CONFIG] Deleted config file');
            }
        } catch (err) {
            console.error('[CONFIG] Delete failed:', err.message);
        }
    }
}

// Singleton instance oluştur
module.exports = new ConfigManager();
