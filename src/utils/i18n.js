/**
 * LLM Runner AIO - Internationalization (i18n) Manager
 * 
 * PyQt6 app.py'deki LanguageManager'ın Electron karşılığı
 * - 8 dil desteği (en, tr, de, es, fr, pt, zh, ja)
 * - JSON dosyalarından string yükleme
 * - onChange event listener pattern
 * - Fallback mekanizması
 */

const fs = require('fs');
const path = require('path');

class I18nManager {
    constructor() {
        // Desteklenen diller
        this.supportedLangs = ['en', 'tr', 'de', 'es', 'fr', 'pt', 'zh', 'ja'];
        
        // Mevcut dil
        this.currentLang = 'en';
        
        // Yüklenmiş çeviriler
        this.strings = {};
        
        // Event listeners (PyQt6'daki pyqtSignal pattern'ının JS karşılığı)
        this.listeners = [];
        
        // Dil değiştirildiğinde emit edilecek event
        this.langChangedEvent = null;
        
        // Path resolution
        this.langDir = path.join(process.resourcesPath || __dirname, '..', 'launcher', 'lang');
        
        // Config'den kaydedilen dili yükle
        const config = require('./config');
        const savedLang = config.get('language', 'en');
        
        if (this.supportedLangs.includes(savedLang)) {
            this.load(savedLang);
        } else {
            this.load('en');
        }
    }
    
    /**
     * Dil dosyasını yükle
     * PyQt6'da: LanguageManager._load(lang_code)
     * @param {string} langCode - Dil kodu (örn: 'tr', 'en')
     */
    load(langCode) {
        if (!this.supportedLangs.includes(langCode)) {
            console.warn(`[I18N] Unsupported language: ${langCode}, falling back to English`);
            langCode = 'en';
        }
        
        const langFile = path.join(this.langDir, `${langCode}.json`);
        
        try {
            if (fs.existsSync(langFile)) {
                const raw = fs.readFileSync(langFile, 'utf8');
                this.strings = JSON.parse(raw);
                this.currentLang = langCode;
                console.log(`[I18N] Loaded language: ${langCode}`);
                
                // Emit lang_changed event
                this.emitChange({ lang: langCode, strings: { ...this.strings } });
                
                return true;
            } else {
                console.warn(`[I18N] Language file not found: ${langFile}`);
            }
        } catch (err) {
            console.error(`[I18N] Failed to load ${langCode}:`, err.message);
        }
        
        // Fallback: English
        try {
            const enFile = path.join(this.langDir, 'en.json');
            if (fs.existsSync(enFile)) {
                const raw = fs.readFileSync(enFile, 'utf8');
                this.strings = JSON.parse(raw);
                this.currentLang = 'en';
                console.log('[I18N] Fallback to English');
                
                this.emitChange({ lang: 'en', strings: { ...this.strings } });
                return true;
            }
        } catch (fallbackErr) {
            console.error('[I18N] Even fallback failed:', fallbackErr.message);
        }
        
        return false;
    }
    
    /**
     * Çeviri al
     * PyQt6'da: LanguageManager.get(key, default='')
     * @param {string} key - Çeviri anahtarı
     * @param {string} fallback - Varsayılan değer (bulunamazsa)
     * @returns {string} Çeviri metni
     */
    t(key, fallback = '') {
        return this.strings[key] || fallback || key;
    }
    
    /**
     * Dizayn amaçlı __getitem__ pattern'ı (Python uyumluluğu)
     * @param {string} key - Anahtar
     * @returns {string} Değer
     */
    getItem(key) {
        return this.strings[key] || '';
    }
    
    /**
     * Mevcut dili döndür
     * @returns {string} Dil kodu
     */
    getCurrent() {
        return this.currentLang;
    }
    
    /**
     * Dil değişikliği event listener ekle
     * PyQt6'da: self.lang.lang_changed.connect(callback)
     * @param {Function} callback - Callback fonksiyonu ({lang, strings})
     */
    onChange(callback) {
        if (typeof callback === 'function') {
            this.listeners.push(callback);
        }
    }
    
    /**
     * Event emit (iç kullanım)
     * @private
     */
    emitChange(data) {
        for (const listener of this.listeners) {
            try {
                listener(data);
            } catch (err) {
                console.error('[I18N] Listener error:', err.message);
            }
        }
        
        // IPC event olarak da gönder (main process'e bildirim)
        if (process.send) {
            process.send({ type: 'lang-changed', data });
        }
    }
    
    /**
     * Tüm desteklenen dilleri döndür
     * @returns {string[]} Dil kodları
     */
    getSupportedLanguages() {
        return [...this.supportedLangs];
    }
    
    /**
     * Dil dosyasını manuel olarak tekrar yükle
     * @returns {boolean} Başarı durumu
     */
    reload() {
        return this.load(this.currentLang);
    }
}

// Singleton instance
module.exports = new I18nManager();
