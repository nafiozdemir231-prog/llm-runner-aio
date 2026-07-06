/**
 * LLM Runner AIO - System Detection Tab
 * 
 * PyQt6 tabs/system_detection.py'nin Electron karşılığı
 * - Hardware detection (GPU, VRAM, RAM, CPU)
 * - INI config parsing ve eşleştirme
 * - Model indirme (node-fetch streaming)
 * - SHA256 doğrulama
 * - Partial file cleanup
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// ============================================
// Hardware Detection
// ============================================

/**
 * Donanım bilgilerini tespit et
 * PyQt6'da: detect_hardware() metodu
 * @returns {Promise<Object>} Donanım bilgileri
 */
async function detectHardware() {
    const result = {
        gpuName: '',
        vramGb: 0.0,
        ramGb: 0.0,
        cpuName: '',
        platform: process.platform,
        osRelease: require('os').release()
    };
    
    // ============================================
    // NVIDIA GPU Detection
    // ============================================
    try {
        const output = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
            encoding: 'utf8',
            timeout: 5000
        }).trim();
        
        if (output) {
            const lines = output.split('\n');
            const firstLine = lines[0].split(',').map(s => s.trim());
            result.gpuName = firstLine[0];
            result.vramGb = parseFloat(firstLine[1]) / 1024;
        }
    } catch (e) {
        // NVIDIA yok, diğer GPU'lara geç
        result.gpuName = detectNonNvidiaGPU();
    }
    
    // ============================================
    // RAM Detection
    // ============================================
    const totalMem = require('os').totalmem();
    result.ramGb = Math.round(totalMem / (1024 * 1024 * 1024 * 100)) / 100;
    
    // ============================================
    // CPU Detection
    // ============================================
    try {
        if (process.platform === 'win32') {
            const cpuOutput = execSync('wmic cpu get Name', {
                encoding: 'utf8',
                timeout: 3000
            }).trim();
            
            const lines = cpuOutput.split('\n').filter(l => l.trim() && !l.includes('Name'));
            if (lines.length > 0) {
                result.cpuName = lines[0].trim();
            }
        } else {
            // macOS/Linux
            const cpuOutput = execSync('cat /proc/cpuinfo | grep "model name" | head -1', {
                encoding: 'utf8',
                timeout: 3000
            });
            
            if (cpuOutput) {
                result.cpuName = cpuOutput.split(':')[1]?.trim() || '';
            }
        }
    } catch (e) {
        // Fallback: os.cpus()
        const cpus = require('os').cpus();
        if (cpus.length > 0) {
            result.cpuName = cpus[0].model || 'Unknown CPU';
        }
    }
    
    return result;
}

/**
 * NVIDIA dışı GPU tespiti (AMD/Intel)
 * @returns {string} GPU adı
 */
function detectNonNvidiaGPU() {
    try {
        if (process.platform === 'win32') {
            // Windows: WMIC veya PowerShell
            try {
                const output = execSync('wmic path win32_VideoController get Name', {
                    encoding: 'utf8',
                    timeout: 3000
                }).trim();
                
                const lines = output.split('\n').filter(l => l.trim() && !l.includes('Name'));
                if (lines.length > 0) {
                    return lines[0].trim();
                }
            } catch (wmicErr) {
                // PowerShell fallback
                try {
                    const psOutput = execSync(
                        'powershell -command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"',
                        { encoding: 'utf8', timeout: 3000 }
                    ).trim();
                    
                    if (psOutput) {
                        return psOutput;
                    }
                } catch (psErr) {
                    console.log('[DETECT] Could not detect GPU via WMIC/PowerShell');
                }
            }
        } else {
            // Linux: lspci veya lshw
            try {
                const output = execSync("lspci 2>/dev/null | grep -i 'vga\\|3d\\|display'", {
                    encoding: 'utf8',
                    timeout: 3000
                });
                
                if (output) {
                    return output.split('\n')[0]?.trim()?.split(':')[1]?.trim() || '';
                }
            } catch (e) {
                // lspci yok
            }
        }
    } catch (e) {
        console.log('[DETECT] Non-NVIDIA detection failed:', e.message);
    }
    
    return 'Unknown GPU';
}

// ============================================
// INI Config Management
// ============================================

/**
 * GPU config INI dosyalarını tara ve eşleştir
 * PyQt6'da: auto_match_ini() metodu
 * @param {string} projectDir - Proje dizini
 * @returns {Promise<Array>} Eşleşen config dosyaları
 */
async function scanIniConfigs(projectDir) {
    const configs = [];
    
    try {
        const files = fs.readdirSync(projectDir);
        
        for (const file of files) {
            if (!file.endsWith('.ini')) {
                continue;
            }
            
            // gpu*.ini pattern'i
            if (!file.match(/^gpu.*models\.ini$/)) {
                continue;
            }
            
            try {
                const content = fs.readFileSync(path.join(projectDir, file), 'utf8');
                const parsed = parseIni(content);
                
                configs.push({
                    filename: file,
                    path: path.join(projectDir, file),
                    content: parsed,
                    size: fs.statSync(path.join(projectDir, file)).size
                });
            } catch (err) {
                console.warn(`[INI] Failed to parse ${file}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[INI] Failed to scan directory:', err.message);
    }
    
    return configs;
}

/**
 * Basit INI parser
 * @param {string} content - INI dosya içeriği
 * @returns {Object} Parse edilmiş obje
 */
function parseIni(content) {
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
// Model Download (Streaming)
// ============================================

/**
 * GGUF modelini HuggingFace'ten indir
 * PyQt6'da: hf_hub_download() eşdeğeri
 * @param {string} url - İndirilecek URL
 * @param {string} destPath - Hedef dosya yolu
 * @param {Function} onProgress - Progress callback (percent, downloaded, total)
 * @returns {Promise<Object>} Sonuç
 */
async function downloadModel(url, destPath, onProgress = null) {
    try {
        // Üst dizini oluştur
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Head request ile boyut al
        const headResponse = await fetch(url, { method: 'HEAD' });
        const totalSize = parseInt(headResponse.headers.get('content-length'), 10);
        
        if (isNaN(totalSize)) {
            throw new Error('Could not determine file size');
        }
        
        // Stream download
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const fileStream = fs.createWriteStream(destPath);
        let downloaded = 0;
        
        return new Promise((resolve, reject) => {
            response.body.pipe(fileStream);
            
            response.body.on('data', (chunk) => {
                downloaded += chunk.length;
                
                if (onProgress && totalSize) {
                    const percent = Math.round((downloaded / totalSize) * 100);
                    onProgress(percent, downloaded, totalSize);
                }
            });
            
            fileStream.on('finish', () => {
                fileStream.close();
                resolve({ success: true, path: destPath, size: downloaded });
            });
            
            fileStream.on('error', (err) => {
                fs.unlink(destPath, () => {}); // Partial dosyayı sil
                reject(err);
            });
            
            response.body.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });
    } catch (err) {
        console.error('[DOWNLOAD] Failed:', err.message);
        return { success: false, error: err.message };
    }
}

// ============================================
// SHA256 Verification
// ============================================

/**
 * GGUF modelinin SHA256 hash'ini doğrula
 * PyQt6'da: _verify_sha256() metodu
 * @param {string} filePath - Model dosya yolu
 * @param {string} expectedHash - Beklenen hash değeri
 * @returns {Promise<boolean>} Hash eşleşti mi?
 */
async function verifySHA256(filePath, expectedHash) {
    try {
        const actualHash = await calculateSHA256(filePath);
        return actualHash.toLowerCase() === expectedHash.toLowerCase();
    } catch (err) {
        console.error('[VERIFY] SHA256 verification failed:', err.message);
        return false;
    }
}

/**
 * Dosyanın SHA256 hash'ini hesapla
 * @param {string} filePath - Dosya yolu
 * @returns {Promise<string>} Hex hash
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
// Partial File Cleanup
// ============================================

/**
 * Yarıda kalmış .part dosyalarını temizle
 * PyQt6'da: _cleanup_partial_files() metodu
 * @param {string} modelsDir - Models dizini
 * @returns {Promise<number>} Temizlenen dosya sayısı
 */
async function cleanupPartialFiles(modelsDir) {
    try {
        const files = fs.readdirSync(modelsDir);
        let cleaned = 0;
        
        for (const file of files) {
            if (file.endsWith('.part')) {
                const fullPath = path.join(modelsDir, file);
                fs.unlinkSync(fullPath);
                console.log(`[CLEANUP] Deleted partial file: ${file}`);
                cleaned++;
            }
        }
        
        return cleaned;
    } catch (err) {
        console.error('[CLEANUP] Failed:', err.message);
        return 0;
    }
}

// ============================================
// Model Scan
// ============================================

/**
 * Models klasörünü tara (.gguf dosyaları)
 * PyQt6'da: scan_models() metodu
 * @param {string} modelsDir - Models dizini
 * @returns {Object} Model listesi ve toplam boyut
 */
function scanModels(modelsDir) {
    const ggufFiles = [];
    let totalSize = 0;
    
    function walk(dir) {
        if (!fs.existsSync(dir)) {
            return;
        }
        
        const files = fs.readdirSync(dir);
        
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                // Subdirectory'leri tara (max 3 seviye)
                walk(fullPath);
            } else if (file.endsWith('.gguf')) {
                ggufFiles.push({
                    name: file,
                    path: fullPath,
                    size: stat.size,
                    modified: stat.mtime
                });
                totalSize += stat.size;
            }
        }
    }
    
    walk(modelsDir);
    
    return {
        files: ggufFiles.sort((a, b) => b.size - a.size), // En büyükten küçüğe
        totalSize
    };
}

// ============================================
// Module Export
// ============================================
module.exports = {
    detectHardware,
    scanIniConfigs,
    parseIni,
    downloadModel,
    verifySHA256,
    calculateSHA256,
    cleanupPartialFiles,
    scanModels
};
