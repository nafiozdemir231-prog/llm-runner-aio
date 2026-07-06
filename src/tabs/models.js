/**
 * LLM Runner AIO - Models Tab
 * 
 * PyQt6 tabs/models.py'nin Electron karşılığı
 * - GGUF model taraması (.gguf dosyalarını bul)
 * - Model silme
 * - Depolama hesaplama (toplam GB)
 * - Model indirme (node-fetch streaming)
 * - Progress tracking
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');

class ModelsManager {
    constructor(modelsDir) {
        this.modelsDir = modelsDir;
        this.models = [];
        this.totalSize = 0;
        this.selectedModel = null;
    }
    
    // ============================================
    // Scan Models
    // ============================================
    
    /**
     * Models klasörünü tara (.gguf dosyaları)
     * PyQt6'da: scan_models() metodu
     * @param {string} dir - Taranacak dizin
     * @param {number} maxDepth - Maksimum dizin derinliği
     * @returns {Object} Model listesi
     */
    scan(dir = this.modelsDir, maxDepth = 3) {
        const ggufFiles = [];
        let totalSize = 0;
        
        function walk(currentDir, depth) {
            if (depth > maxDepth || !fs.existsSync(currentDir)) {
                return;
            }
            
            const files = fs.readdirSync(currentDir);
            
            for (const file of files) {
                const fullPath = path.join(currentDir, file);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    walk(fullPath, depth + 1);
                } else if (file.endsWith('.gguf')) {
                    ggufFiles.push({
                        name: file,
                        path: fullPath,
                        size: stat.size,
                        modified: stat.mtime,
                        relativePath: path.relative(dir, fullPath)
                    });
                    totalSize += stat.size;
                }
            }
        }
        
        walk(dir, 0);
        
        // En büyükten küçüğe sırala
        ggufFiles.sort((a, b) => b.size - a.size);
        
        this.models = ggufFiles;
        this.totalSize = totalSize;
        
        return {
            files: ggufFiles,
            totalSize,
            count: ggufFiles.length
        };
    }
    
    // ============================================
    // Delete Model
    // ============================================
    
    /**
     * Model dosyasını sil
     * PyQt6'da: delete_selected_models() metodu
     * @param {string} filePath - Silinecek dosya yolu
     * @returns {Promise<Object>} Sonuç
     */
    async deleteModel(filePath) {
        try {
            // Dosya var mı kontrol et
            if (!fs.existsSync(filePath)) {
                return { success: false, error: 'File does not exist' };
            }
            
            // Dosya bilgilerini al
            const stat = fs.statSync(filePath);
            const fileName = path.basename(filePath);
            
            // Dosyayı sil
            fs.unlinkSync(filePath);
            
            console.log(`[MODEL] Deleted: ${fileName} (${this.formatBytes(stat.size)})`);
            
            // Listeyi güncelle
            this.models = this.models.filter(m => m.path !== filePath);
            this.totalSize -= stat.size;
            
            // Seçili model silindiyse resetle
            if (this.selectedModel === filePath) {
                this.selectedModel = null;
            }
            
            return { success: true, deleted: fileName };
        } catch (err) {
            console.error('[MODEL] Delete failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    /**
     * Birden fazla modeli sil
     * @param {Array<string>} filePaths - Silinecek dosya yolları
     * @returns {Promise<Object>} Sonuç
     */
    async deleteMultiple(filePaths) {
        const results = { success: 0, errors: 0, deleted: [], failed: [] };
        
        for (const filePath of filePaths) {
            const result = await this.deleteModel(filePath);
            
            if (result.success) {
                results.success++;
                results.deleted.push(result.deleted);
            } else {
                results.errors++;
                results.failed.push({ path: filePath, error: result.error });
            }
        }
        
        return results;
    }
    
    // ============================================
    // Select/Deselect Model
    // ============================================
    
    /**
     * Model seç
     * @param {string|number} identifier - Dosya yolu veya index
     */
    selectModel(identifier) {
        let model = null;
        
        if (typeof identifier === 'number') {
            model = this.models[identifier];
        } else if (typeof identifier === 'string') {
            model = this.models.find(m => m.path === identifier);
        }
        
        if (model) {
            this.selectedModel = model.path;
            return model;
        }
        
        this.selectedModel = null;
        return null;
    }
    
    /**
     * Seçili modeli döndür
     * @returns {Object|null} Seçili model
     */
    getSelectedModel() {
        return this.models.find(m => m.path === this.selectedModel) || null;
    }
    
    // ============================================
    // Download Model
    // ============================================
    
    /**
     * GGUF modelini HuggingFace'ten indir
     * PyQt6'da: hf_hub_download() eşdeğeri
     * @param {string} url - İndirilecek URL
     * @param {string} destFolder - Hedef klasör
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} Sonuç
     */
    async downloadModel(url, destFolder, onProgress = null) {
        try {
            // Üst dizini oluştur
            const dir = path.dirname(destFolder);
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
            
            const fileStream = fs.createWriteStream(destFolder);
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
                    resolve({ success: true, path: destFolder, size: downloaded });
                });
                
                fileStream.on('error', (err) => {
                    fs.unlink(destFolder, () => {}); // Partial dosyayı sil
                    reject(err);
                });
                
                response.body.on('error', (err) => {
                    fs.unlink(destFolder, () => {});
                    reject(err);
                });
            });
        } catch (err) {
            console.error('[DOWNLOAD] Failed:', err.message);
            return { success: false, error: err.message };
        }
    }
    
    // ============================================
    // Verify Model (SHA256)
    // ============================================
    
    /**
     * Model'in SHA256 hash'ini doğrula
     * PyQt6'da: _verify_sha256() metodu
     * @param {string} filePath - Model dosya yolu
     * @param {string} expectedHash - Beklenen hash
     * @returns {Promise<boolean>} Hash eşleşti mi?
     */
    async verifySHA256(filePath, expectedHash) {
        try {
            const actualHash = await this.calculateSHA256(filePath);
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
    async calculateSHA256(filePath) {
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
    // Utility
    // ============================================
    
    /**
     * Bayt cinsinden boyutu okunabilir formata çevir
     * @param {number} bytes - Bayt
     * @returns {string} Formatlanmış boyut
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Model listesini döndür
     * @returns {Array} Model array'i
     */
    getList() {
        return [...this.models];
    }
    
    /**
     * Toplam depolama boyutunu döndür
     * @returns {number} Bayt cinsinden
     */
    getTotalSize() {
        return this.totalSize;
    }
    
    /**
     * Model sayısını döndür
     * @returns {number} Model sayısı
     */
    getCount() {
        return this.models.length;
    }
    
    /**
     * Tüm modelleri temizle (listeyi sıfırla)
     */
    clearCache() {
        this.models = [];
        this.totalSize = 0;
        this.selectedModel = null;
    }
}

// ============================================
// Module Export
// ============================================
module.exports = ModelsManager;
