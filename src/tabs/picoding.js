/**
 * LLM Runner AIO - PiCoding Tab
 * 
 * PyQt6 tabs/picoding.py'nin Electron karşılığı
 * - PiCoding IDE yapılandırması
 * - Working directory yönetimi
 * - MCP config dosyası yönetimi
 * - Terminal output stream
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class PiCodingManager extends EventEmitter {
    constructor(projectRoot) {
        super();
        this.projectRoot = projectRoot;
        this.picodingPath = '';
        this.mcpConfig = '';
        this.process = null;
        this.isRunning = false;
    }
    
    // ============================================
    // Configuration
    // ============================================
    
    /**
     * PiCoding yolunu ayarla
     * @param {string} picodingPath - PiCoding kurulum dizini
     */
    setPicodingPath(picodingPath) {
        this.picodingPath = picodingPath;
        
        // Config'e kaydet
        const config = require('../utils/config');
        config.set('picoding_path', picodingPath);
        
        console.log('[PICODING] Path set to:', picodingPath);
    }
    
    /**
     * PiCoding yolunu al
     * @returns {string} Picoding dizini
     */
    getPicodingPath() {
        if (!this.picodingPath) {
            const config = require('../utils/config');
            this.picodingPath = config.get('picoding_path', '');
        }
        return this.picodingPath;
    }
    
    /**
     * MCP config dosyasını ayarla
     * @param {string} configPath - MCP config dosya yolu
     */
    setMCPConfig(configPath) {
        this.mcpConfig = configPath;
        console.log('[PICODING] MCP config set to:', configPath);
    }
    
    /**
     * MCP config dosyasını al
     * @returns {string} MCP config yolu
     */
    getMCPConfig() {
        return this.mcpConfig;
    }
    
    // ============================================
    // Validation
    // ============================================
    
    /**
     * PiCoding dizininin geçerliliğini kontrol et
     * @returns {Object} Doğrulama sonucu
     */
    validate() {
        const result = { valid: false, errors: [] };
        
        if (!this.picodingPath) {
            result.errors.push('PiCoding path is not set');
            return result;
        }
        
        if (!fs.existsSync(this.picodingPath)) {
            result.errors.push(`Directory does not exist: ${this.picodingPath}`);
            return result;
        }
        
        // package.json var mı kontrol et
        const pkgPath = path.join(this.picodingPath, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            result.errors.push('No package.json found in PiCoding directory');
            return result;
        }
        
        result.valid = true;
        return result;
    }
    
    /**
     * MCP config dosyasının geçerliliğini kontrol et
     * @returns {Object} Doğrulama sonucu
     */
    validateMCPConfig() {
        const result = { valid: false, errors: [] };
        
        if (!this.mcpConfig) {
            result.errors.push('MCP config path is not set');
            return result;
        }
        
        if (!fs.existsSync(this.mcpConfig)) {
            result.errors.push(`Config file does not exist: ${this.mcpConfig}`);
            return result;
        }
        
        try {
            const content = fs.readFileSync(this.mcpConfig, 'utf8');
            JSON.parse(content);
        } catch (err) {
            result.errors.push(`Invalid JSON in config: ${err.message}`);
            return result;
        }
        
        result.valid = true;
        return result;
    }
    
    // ============================================
    // Start/Stop PiCoding
    // ============================================
    
    /**
     * PiCoding IDE'yi başlat
     * @returns {Promise<Object>} Sonuç
     */
    async start() {
        const validation = this.validate();
        
        if (!validation.valid) {
            return { success: false, errors: validation.errors };
        }
        
        // Zaten çalışıyor mu?
        if (this.isRunning && this.process) {
            return { success: false, error: 'PiCoding is already running' };
        }
        
        try {
            // package.json'a bakarak nasıl başlatılacağını belirle
            const pkgPath = path.join(this.picodingPath, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            
            // start script'ini bul
            const startCmd = pkg.scripts?.start || 'npm start';
            
            // Komutu parse et
            let cmd, args;
            
            if (startCmd.startsWith('npm')) {
                cmd = 'npm';
                args = ['run', 'start'];
            } else if (startCmd.startsWith('python')) {
                cmd = 'python';
                args = startCmd.split(' ').slice(1);
            } else {
                // Direkt komut
                const parts = startCmd.split(' ');
                cmd = parts[0];
                args = parts.slice(1);
            }
            
            // Process başlat
            this.process = spawn(cmd, args, {
                cwd: this.picodingPath,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env }
            });
            
            this.isRunning = true;
            
            // stdout/stderr dinle
            this.process.stdout?.on('data', (data) => {
                const message = data.toString();
                this.emit('log', message);
                console.log(`[PICODING] ${message.trim()}`);
            });
            
            this.process.stderr?.on('data', (data) => {
                const message = data.toString();
                this.emit('error', message);
                console.error(`[PICODING ERROR] ${message.trim()}`);
            });
            
            this.process.on('exit', (code, signal) => {
                console.log(`[PICODING] Exited (code: ${code}, signal: ${signal})`);
                this.isRunning = false;
                this.process = null;
                this.emit('stopped', code, signal);
            });
            
            this.process.on('error', (err) => {
                console.error('[PICODING] Spawn error:', err.message);
                this.isRunning = false;
                this.process = null;
                this.emit('error', `Spawn failed: ${err.message}`);
            });
            
            return { success: true };
        } catch (err) {
            console.error('[PICODING] Start failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    /**
     * PiCoding IDE'yi durdur
     * @returns {Promise<Object>} Sonuç
     */
    async stop() {
        if (!this.process) {
            return { success: true }; // Zaten durmuş
        }
        
        try {
            // Graceful shutdown
            this.process.kill('SIGTERM');
            
            // 5 saniye bekle
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Hala çalışıyorsa force kill
            if (this.process && !this.process.killed) {
                const treeKill = require('tree-kill');
                await new Promise((resolve, reject) => {
                    treeKill(this.process.pid, 'SIGKILL', (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
            
            this.isRunning = false;
            this.process = null;
            
            return { success: true };
        } catch (err) {
            console.error('[PICODING] Stop failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    /**
     * PiCoding durumu
     * @returns {boolean} Çalışıyor mu?
     */
    isRunningState() {
        return this.isRunning;
    }
    
    // ============================================
    // MCP Config Management
    // ============================================
    
    /**
     * Varsayılan MCP config oluştur
     * @param {string} outputPath - Çıktı dosya yolu
     * @returns {Object} Oluşturulan config
     */
    createDefaultMCPConfig(outputPath) {
        const defaultConfig = {
            mcpServers: {
                llmRunner: {
                    command: 'python',
                    args: ['-m', 'searx.webapp'],
                    cwd: path.join(this.projectRoot, 'searxng'),
                    env: {}
                }
            }
        };
        
        fs.writeFileSync(outputPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
        
        this.mcpConfig = outputPath;
        
        console.log('[PICODING] Default MCP config created at:', outputPath);
        
        return defaultConfig;
    }
    
    /**
     * MCP config'i yükle ve parse et
     * @param {string} configPath - Config dosya yolu
     * @returns {Object|null} Parse edilmiş config
     */
    loadMCPConfig(configPath) {
        try {
            const content = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(content);
            
            this.mcpConfig = configPath;
            
            return config;
        } catch (err) {
            console.error('[PICODING] Failed to load MCP config:', err.message);
            return null;
        }
    }
    
    // ============================================
    // Cleanup
    // ============================================
    
    /**
     * PiCoding temizleme
     */
    async cleanup() {
        if (this.isRunning) {
            await this.stop();
        }
    }
}

// ============================================
// Module Export
// ============================================
module.exports = PiCodingManager;
