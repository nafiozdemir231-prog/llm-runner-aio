/**
 * LLM Runner AIO - Logger (Rotating Log Handler)
 * 
 * PyQt6 app.py'deki RotatingFileHandler'ın Electron/Node.js karşılığı
 * - Winston veya custom rotating file logger
 * - Console + File output
 * - Log rotation (5MB max, 3 backup)
 * - UTC timestamp formatı
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

class RotatingLogger {
    constructor(options = {}) {
        this.logDir = options.logDir || path.join(process.resourcesPath || __dirname, '..', 'logs');
        this.logFile = options.logFile || 'app.log';
        this.maxBytes = options.maxBytes || 5 * 1024 * 1024; // 5 MB
        this.backupCount = options.backupCount || 3;
        this.level = options.level || 'debug';
        
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
        
        // Log dizini oluştur
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        
        this.logPath = path.join(this.logDir, this.logFile);
    }
    
    /**
     * Seviyeye göre log yaz
     * @param {string} level - Log seviyesi (error, warn, info, debug)
     * @param {...*} args - Loglanacak veriler
     */
    _log(level, ...args) {
        // Seviye kontrolü
        if (this.levels[level] > this.levels[this.level]) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const message = args.map(a => 
            typeof a === 'string' ? a : util.inspect(a, { depth: 2, colors: true })
        ).join(' ');
        
        const formatted = `[${timestamp}] ${level.toUpperCase()} - ${message}`;
        
        // Console'a yaz
        if (level === 'error') {
            console.error(formatted);
        } else if (level === 'warn') {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }
        
        // Dosyaya yaz (append mode)
        try {
            fs.appendFileSync(this.logPath, formatted + '\n', 'utf8');
            
            // Rotation kontrolü
            this._checkRotation();
        } catch (err) {
            console.error('[LOGGER] Failed to write to file:', err.message);
        }
    }
    
    /**
     * Dosya boyutu rotation kontrolü
     * PyQt6'da: RotatingFileHandler'ın doRollover() method'u
     */
    _checkRotation() {
        try {
            if (!fs.existsSync(this.logPath)) {
                return;
            }
            
            const stats = fs.statSync(this.logPath);
            
            if (stats.size < this.maxBytes) {
                return;
            }
            
            // Rotation başlat
            this._rotate();
        } catch (err) {
            console.error('[LOGGER] Rotation check failed:', err.message);
        }
    }
    
    /**
     * Log dosyasını döndür (rotate)
     * Eski dosyalar .1, .2, .3 şeklinde adlandırılır
     */
    _rotate() {
        try {
            // En eski backup'ı sil
            const oldest = `${this.logPath}.${this.backupCount}`;
            if (fs.existsSync(oldest)) {
                fs.unlinkSync(oldest);
            }
            
            // Backward shift
            for (let i = this.backupCount - 1; i >= 1; i--) {
                const current = `${this.logPath}.${i}`;
                const next = `${this.logPath}.${i + 1}`;
                
                if (fs.existsSync(current)) {
                    fs.renameSync(current, next);
                }
            }
            
            // Mevcut log dosyasını .1'e taşı
            fs.renameSync(this.logPath, `${this.logPath}.1`);
            
            // Yeni boş dosya oluştur
            fs.writeFileSync(this.logPath, '', 'utf8');
            
            console.log(`[LOGGER] Rotated logs (max ${this.backupCount} backups)`);
        } catch (err) {
            console.error('[LOGGER] Rotation failed:', err.message);
        }
    }
    
    // ============================================
    // Public Log Methods
    // ============================================
    
    error(...args) {
        this._log('error', ...args);
    }
    
    warn(...args) {
        this._log('warn', ...args);
    }
    
    info(...args) {
        this._log('info', ...args);
    }
    
    debug(...args) {
        this._log('debug', ...args);
    }
    
    /**
     * Sunucu log mesajlarını yaz (server log viewer için)
     * @param {string} type - Sunucu tipi (searxng, openwebui, vb.)
     * @param {string} message - Log mesajı
     * @param {boolean} isError - Hata mı?
     */
    serverLog(type, message, isError = false) {
        const prefix = isError ? '[ERROR]' : '[INFO]';
        this._log(isError ? 'error' : 'info', `[${type.toUpperCase()}] ${prefix} ${message}`);
    }
    
    /**
     * Log dosyasını oku (son N satır)
     * @param {number} lines - Okunacak satır sayısı
     * @returns {string} Log içeriği
     */
    readLastLines(lines = 100) {
        try {
            if (!fs.existsSync(this.logPath)) {
                return '';
            }
            
            const content = fs.readFileSync(this.logPath, 'utf8');
            const allLines = content.split('\n').filter(l => l.trim());
            
            return allLines.slice(-lines).join('\n');
        } catch (err) {
            console.error('[LOGGER] Read failed:', err.message);
            return '';
        }
    }
    
    /**
     * Log dosyasını temizle
     */
    clear() {
        try {
            if (fs.existsSync(this.logPath)) {
                fs.writeFileSync(this.logPath, '', 'utf8');
            }
            
            // Backup dosyalarını da temizle
            for (let i = 1; i <= this.backupCount; i++) {
                const backup = `${this.logPath}.${i}`;
                if (fs.existsSync(backup)) {
                    fs.unlinkSync(backup);
                }
            }
            
            console.log('[LOGGER] Logs cleared');
        } catch (err) {
            console.error('[LOGGER] Clear failed:', err.message);
        }
    }
    
    /**
     * Log istatistikleri
     * @returns {Object} Log sayıları
     */
    getStats() {
        try {
            if (!fs.existsSync(this.logPath)) {
                return { total: 0, error: 0, warn: 0, info: 0, debug: 0 };
            }
            
            const content = fs.readFileSync(this.logPath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim());
            
            return {
                total: lines.length,
                error: lines.filter(l => l.includes('[ERROR]')).length,
                warn: lines.filter(l => l.includes('[WARN]')).length,
                info: lines.filter(l => l.includes('[INFO]')).length,
                debug: lines.filter(l => l.includes('[DEBUG]')).length
            };
        } catch (err) {
            return { total: 0, error: 0, warn: 0, info: 0, debug: 0 };
        }
    }
}

// ============================================
// Singleton Instance
// ============================================
let loggerInstance = null;

function getLogger(options = {}) {
    if (!loggerInstance) {
        loggerInstance = new RotatingLogger(options);
    }
    return loggerInstance;
}

module.exports = getLogger;
