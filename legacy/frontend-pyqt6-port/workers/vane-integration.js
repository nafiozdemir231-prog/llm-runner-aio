/**
 * LLM Runner AIO - Vane Integration Worker
 * 
 * PyQt6 Vane yönetiminin Electron karşılığı
 * - Vane Next.js statik export (build/export)
 * - Electron'da static dosya yükleme (loadFile)
 * - Vane sunucu spawn (API route kullanılıyorsa)
 * - İlk-Run Bootloader (venv oluşturma + pip install)
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class VaneIntegration extends EventEmitter {
    constructor(projectRoot) {
        super();
        this.projectRoot = projectRoot;
        this.vaneDir = path.join(projectRoot, 'Vane');
        this.vaneOutDir = path.join(this.vaneDir, 'out');
        this.isStaticExport = false;
    }
    
    // ============================================
    // Static Export Check
    // ============================================
    
    /**
     * Vane'in statik export yapılandırılmış mı kontrol et
     * @returns {Promise<boolean>} Statik export var mı?
     */
    async isStaticExportReady() {
        try {
            const nextConfigPath = path.join(this.vaneDir, 'next.config.js');
            
            if (!fs.existsSync(nextConfigPath)) {
                return false;
            }
            
            const configContent = fs.readFileSync(nextConfigPath, 'utf8');
            
            // output: 'export' var mı?
            if (configContent.includes("output: 'export'") || configContent.includes('output: "export"')) {
                return true;
            }
            
            // out dizini var mı?
            const outExists = fs.existsSync(this.vaneOutDir);
            if (outExists) {
                const indexHtml = path.join(this.vaneOutDir, 'index.html');
                return fs.existsSync(indexHtml);
            }
            
            return false;
        } catch (err) {
            console.error('[VANE] Static export check failed:', err.message);
            return false;
        }
    }
    
    // ============================================
    // Build Vane (Static Export)
    // ============================================
    
    /**
     * Vane'i build et (npm run build → static export)
     * @returns {Promise<Object>} Sonuç
     */
    async buildVane() {
        console.log('[VANE] Building Vane (static export)...');
        
        try {
            // next.config.js kontrolü
            const nextConfigPath = path.join(this.vaneDir, 'next.config.js');
            
            if (!fs.existsSync(nextConfigPath)) {
                // Varsayılan next.config.js oluştur
                this._createDefaultNextConfig();
            }
            
            // npm install (eğer node_modules yoksa)
            const nodeModulesPath = path.join(this.vaneDir, 'node_modules');
            if (!fs.existsSync(nodeModulesPath)) {
                console.log('[VANE] Installing dependencies...');
                execSync('npm install', {
                    cwd: this.vaneDir,
                    stdio: 'inherit',
                    timeout: 120000
                });
            }
            
            // Build komutu
            console.log('[VANE] Running build...');
            execSync('npm run build', {
                cwd: this.vaneDir,
                stdio: 'inherit',
                timeout: 180000
            });
            
            // Export kontrolü
            const ready = await this.isStaticExportReady();
            
            if (ready) {
                console.log('[VANE] Build successful! Static files in:', this.vaneOutDir);
                this.isStaticExport = true;
                return { success: true, outDir: this.vaneOutDir };
            } else {
                console.error('[VANE] Build completed but no static export found');
                return { success: false, error: 'No static export output' };
            }
        } catch (err) {
            console.error('[VANE] Build failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    /**
     * Varsayılan next.config.js oluştur
     * @private
     */
    _createDefaultNextConfig() {
        const configContent = `
/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    images: {
        unoptimized: true,
    },
    experimental: {
        clientRouterFilter: false,
    },
};

module.exports = nextConfig;
`;
        
        fs.writeFileSync(
            path.join(this.vaneDir, 'next.config.js'),
            configContent,
            'utf8'
        );
        
        console.log('[VANE] Created default next.config.js with output: "export"');
    }
    
    // ============================================
    // Load Vane in Electron
    // ============================================
    
    /**
     * Vane'i Electron penceresinde yükle
     * @param {BrowserWindow} mainWindow - Electron penceresi
     */
    loadInBrowser(mainWindow) {
        if (this.isStaticExport || this.isStaticExportReady()) {
            const indexPath = path.join(this.vaneOutDir, 'index.html');
            
            if (fs.existsSync(indexPath)) {
                mainWindow.loadFile(indexPath);
                console.log('[VANE] Loaded static export from:', indexPath);
                return true;
            }
        }
        
        console.warn('[VANE] No static export available');
        return false;
    }
    
    // ============================================
    // Spawn Vane Server (API route kullanılıyorsa)
    // ============================================
    
    /**
     * Vane sunucusunu spawn et (static export değilse)
     * @param {number} port - Port numarası
     * @param {string} host - Bind address
     * @returns {Promise<Object>} Sonuç
     */
    async startServer(port = 8090, host = '0.0.0.0') {
        console.log('[VANE] Starting Vane server on', `${host}:${port}`);
        
        try {
            const vaneServer = spawn('node', ['server.js'], {
                cwd: this.vaneDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, HOST: host, PORT: String(port) }
            });
            
            vaneServer.stdout?.on('data', (data) => {
                const message = data.toString();
                console.log(`[VANE] ${message.trim()}`);
                this.emit('log', 'vane', message);
            });
            
            vaneServer.stderr?.on('data', (data) => {
                const message = data.toString();
                console.error(`[VANE ERROR] ${message.trim()}`);
                this.emit('error', 'vane', message);
            });
            
            vaneServer.on('exit', (code, signal) => {
                console.log(`[VANE] Exited (code: ${code}, signal: ${signal})`);
                this.emit('stopped', 'vane');
            });
            
            return { success: true, pid: vaneServer.pid };
        } catch (err) {
            console.error('[VANE] Server start failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    // ============================================
    // First-Run Bootloader
    // ============================================
    
    /**
     * İlk çalıştırma boot loader
     * - Python venv oluştur
     * - pip install requirements.txt
     * - INI → model_urls.json migration
     * @returns {Promise<Object>} Sonuç
     */
    async firstRunBootload() {
        console.log('[BOOTLOADER] Starting first-run setup...');
        
        const results = {
            venvCreated: false,
            pipInstalled: false,
            migrated: false,
            errors: []
        };
        
        try {
            // 1. Python path bul
            const pythonPath = await this._findPython();
            console.log('[BOOTLOADER] Python found at:', pythonPath);
            
            // 2. Venv oluştur
            const venvPath = path.join(this.projectRoot, 'venv');
            
            if (!fs.existsSync(venvPath)) {
                console.log('[BOOTLOADER] Creating virtual environment...');
                execSync(`${pythonPath} -m venv venv`, {
                    cwd: this.projectRoot,
                    stdio: 'inherit'
                });
                results.venvCreated = true;
                console.log('[BOOTLOADER] Venv created successfully');
            } else {
                console.log('[BOOTLOADER] Venv already exists');
            }
            
            // 3. Pip upgrade + requirements install
            const pipPath = process.platform === 'win32'
                ? path.join(venvPath, 'Scripts', 'pip.exe')
                : path.join(venvPath, 'bin', 'pip');
            
            console.log('[BOOTLOADER] Upgrading pip...');
            execSync(`${pipPath} install --upgrade pip`, {
                cwd: this.projectRoot,
                stdio: 'inherit',
                timeout: 60000
            });
            
            console.log('[BOOTLOADER] Installing requirements...');
            execSync(`${pipPath} install -r requirements.txt`, {
                cwd: this.projectRoot,
                stdio: 'inherit',
                timeout: 180000
            });
            
            results.pipInstalled = true;
            console.log('[BOOTLOADER] Requirements installed');
            
            // 4. INI → JSON migration
            await this._runMigration();
            
            console.log('[BOOTLOADER] First-run setup complete!');
            return results;
        } catch (err) {
            console.error('[BOOTLOADER] Setup failed:', err.message);
            results.errors.push(err.message);
            return results;
        }
    }
    
    /**
     * Python executable'ını bul
     * @private
     */
    async _findPython() {
        try {
            if (process.platform === 'win32') {
                const output = execSync('where python', { encoding: 'utf8', timeout: 2000 }).trim();
                const lines = output.split('\n').filter(l => l.trim());
                return lines[0]?.trim() || 'python';
            } else {
                const output = execSync('which python3 || which python', { encoding: 'utf8', timeout: 2000 }).trim();
                return output.split('\n').find(l => l.trim())?.trim() || 'python3';
            }
        } catch (err) {
            return process.platform === 'win32' ? 'python' : 'python3';
        }
    }
    
    /**
     * INI → model_urls.json migration çalıştır
     * @private
     */
    async _runMigration() {
        const migrateScript = path.join(this.projectRoot, 'migrate_ini_to_urls.py');
        
        if (!fs.existsSync(migrateScript)) {
            console.log('[BOOTLOADER] Migration script not found, skipping');
            return;
        }
        
        try {
            console.log('[BOOTLOADER] Running INI → JSON migration...');
            const pythonPath = await this._findPython();
            
            execSync(`${pythonPath} ${migrateScript}`, {
                cwd: this.projectRoot,
                stdio: 'inherit',
                timeout: 30000
            });
            
            console.log('[BOOTLOADER] Migration complete');
        } catch (err) {
            console.warn('[BOOTLOADER] Migration skipped:', err.message);
        }
    }
    
    // ============================================
    // Health Check
    // ============================================
    
    /**
     * Vane sağlık kontrolü
     * @param {number} port - Port numarası
     * @returns {Promise<boolean>} Sağlıklı mı?
     */
    async healthCheck(port = 8090) {
        const http = require('http');
        
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 3000 }, (res) => {
                res.destroy();
                resolve(res.statusCode >= 200 && res.statusCode < 400);
            });
            
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }
}

// ============================================
// Module Export
// ============================================
module.exports = VaneIntegration;
