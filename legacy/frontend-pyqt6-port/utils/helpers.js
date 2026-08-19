/**
 * LLM Runner AIO - Helper Utilities
 * 
 * PyQt6'daki utility fonksiyonların Electron karşılığı:
 * - Port kontrolü (is_port_in_use)
 * - SHA256 hash hesaplama
 * - İnternet bağlantısı kontrolü
 * - Dosya boyutu formatlama
 * - Python path resolver
 */

const net = require('net');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

// ============================================
// Port Check (PyQt6'daki is_port_in_use() karşılığı)
// ============================================

/**
 * Port'un kullanımda olup olmadığını kontrol et
 * PyQt6'da: socket.bind() denemesi ile
 * @param {number} port - Kontrol edilecek port
 * @param {string} host - Bağlanılacak host (varsayılan: 127.0.0.1)
 * @returns {Promise<boolean>} Port meşgul mü?
 */
async function checkPortInUse(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(2000);
        
        socket.connect(port, host, () => {
            socket.destroy();
            resolve(true); // Port meşgul
        });
        
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false); // Timeout = port boş
        });
        
        socket.on('error', () => {
            socket.destroy();
            resolve(false); // Hata = port boş veya erişilemez
        });
    });
}

// ============================================
// SHA256 Hash (PyQt6'daki hashlib.sha256() karşılığı)
// ============================================

/**
 * Dosyanın SHA256 hash'ini hesapla
 * PyQt6'da: _calculate_sha256() fonksiyonu
 * @param {string} filePath - Hash'lenecek dosya yolu
 * @returns {Promise<string>} Hex SHA256 hash
 */
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

// ============================================
// Internet Connection Check (PyQt6'daki ping kontrolü karşılığı)
// ============================================

/**
 * İnternet bağlantısını kontrol et
 * PyQt6'da: ping-based check (subprocess ile)
 * @param {string} host - Test edilecek host
 * @param {number} timeout - Timeout ms cinsinden
 * @returns {Promise<boolean>} Bağlantı var mı?
 */
async function checkInternetConnection(host = '8.8.8.8', timeout = 3000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        
        socket.connect(53, host, () => {
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

// ============================================
// File Size Formatting (PyQt6'daki formatBytes() karşılığı)
// ============================================

/**
 * Bayt cinsinden dosya boyutunu okunabilir formata çevir
 * @param {number} bytes - Bayt cinsinden boyut
 * @returns {string} Formatlanmış boyut string'i
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================
// Partial File Cleanup (PyQt6'daki _cleanup_partial_files() karşılığı)
// ============================================

/**
 * Yarıda kalmış .part dosyalarını temizle
 * PyQt6'da: try/finally ile disk full durumunda silme
 * @param {string} dir - Taranacak dizin
 */
async function cleanupPartialFiles(dir) {
    try {
        const files = await fs.readdir(dir);
        const partials = files.filter(f => f.endsWith('.part'));
        
        for (const file of partials) {
            const fullPath = path.join(dir, file);
            await fs.unlink(fullPath);
            console.log(`[CLEANUP] Deleted partial file: ${file}`);
        }
        
        return partials.length;
    } catch (err) {
        console.error('[CLEANUP] Failed to clean partial files:', err.message);
        return 0;
    }
}

// ============================================
// Python Resolver (Cross-Platform)
// ============================================

/**
 * Python executable'ını bul
 * PyQt6'da: subprocess.which() veya platform'a göre farklı komutlar
 * @returns {Promise<string>} Python yolu
 */
async function findPython() {
    // Windows: where python
    // macOS/Linux: which python3 veya which python
    try {
        if (process.platform === 'win32') {
            const output = execSync('where python', { encoding: 'utf8', timeout: 2000 }).trim();
            const lines = output.split('\n').filter(l => l.trim());
            if (lines.length > 0) {
                return lines[0].trim();
            }
        } else {
            const output = execSync('which python3 || which python', { encoding: 'utf8', timeout: 2000 }).trim();
            const line = output.split('\n').find(l => l.trim());
            if (line) {
                return line.trim();
            }
        }
    } catch (err) {
        console.log('[PYTHON] Could not find python via shell command');
    }
    
    // Fallback: process.env PATH'tan dene
    const paths = process.env.PATH?.split(process.platform === 'win32' ? ';' : ':') || [];
    const binName = process.platform === 'win32' ? 'python.exe' : 'python3';
    
    for (const p of paths) {
        const candidate = path.join(p, binName);
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // Skip
        }
    }
    
    throw new Error('Python executable not found in PATH');
}

// ============================================
// Wait Helper (PyQt6'daki QTimer/QThread.sleep() karşılığı)
// ============================================

/**
 * Belirli süre bekle (async/await uyumlu)
 * PyQt6'da: QTimer.singleShot() veya time.sleep()
 * @param {number} ms - Milisaniye cinsinden bekleme süresi
 * @returns {Promise<void>}
 */
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Health Check Poll (PyQt6'daki QTimer health check karşılığı)
// ============================================

/**
 * HTTP ile sunucu sağlık kontrolü yap
 * PyQt6'da: QTimer ile periyodik ping
 * @param {string} url - Kontrol edilecek URL
 * @param {number} timeout - Timeout ms
 * @returns {Promise<boolean>} Sunucu sağlıklı mı?
 */
async function healthCheck(url, timeout = 5000) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        
        const req = client.get(url, { timeout }, (res) => {
            res.destroy();
            resolve(res.statusCode >= 200 && res.statusCode < 400);
        });
        
        req.on('error', () => {
            resolve(false);
        });
        
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

// ============================================
// Ini File Parser (Basit INI parser)
// PyQt6'da: configparser modülü eşdeğeri
// ============================================

/**
 * Basit INI dosyasını parse et
 * @param {string} filePath - INI dosya yolu
 * @returns {Object} Parse edilmiş obje
 */
async function parseIni(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const result = {};
    let currentSection = null;
    
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        
        // Boş satır veya yorum
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
            continue;
        }
        
        // Section başlığı
        const sectionMatch = trimmed.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1];
            result[currentSection] = {};
            continue;
        }
        
        // Key=Value
        const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
        if (kvMatch && currentSection) {
            const key = kvMatch[1].trim();
            const value = kvMatch[2].trim();
            result[currentSection][key] = value;
        }
    }
    
    return result;
}

// ============================================
// Model Export
// ============================================
module.exports = {
    checkPortInUse,
    calculateSHA256,
    checkInternetConnection,
    formatBytes,
    cleanupPartialFiles,
    findPython,
    wait,
    healthCheck,
    parseIni
};
