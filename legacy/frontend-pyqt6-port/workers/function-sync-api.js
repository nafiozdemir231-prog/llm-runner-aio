/**
 * LLM Runner AIO - Function Sync API Worker
 * 
 * PyQt6 import_functions_api.py'nin Electron karşılığı
 * - OpenWebUI'ye fonksiyon sync (REST API üzerinden)
 * - /api/v1/functions/sync endpoint
 * - action, filter, pipe tiplerini işler (tool skip edilir)
 * - HTTP POST ile JSON gönderir
 * 
 * NOT: Bu script manuel çalıştırma aracıdır, ana worker loop'unun parçası DEĞİLDİR.
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class FunctionSyncApi {
    /**
     * Constructor
     * @param {string} openwebuiDir - OpenWebUI dizini yolu
     * @param {string} apiUrl - OpenWebUI API URL'i
     */
    constructor(openwebuiDir, apiUrl = 'http://localhost:3000/api/v1/functions/sync') {
        this.functionDir = path.join(openwebuiDir, 'function');
        this.apiUrl = apiUrl;
        this.results = { success: 0, errors: 0, skipped: 0 };
    }
    
    /**
     * Fonksiyon senkronizasyonu başlat
     * PyQt6'daki import_functions() metodunun karşılığı
     * @returns {Promise<Object>} Sonuç objesi ({success, errors, skipped})
     */
    async syncFunctions() {
        console.log('[SYNC] Starting function sync...');
        console.log('[SYNC] Function dir:', this.functionDir);
        console.log('[SYNC] API URL:', this.apiUrl);
        
        this.results = { success: 0, errors: 0, skipped: 0 };
        
        // Function klasörünü kontrol et
        if (!fs.existsSync(this.functionDir)) {
            console.error('[SYNC] Function directory not found:', this.functionDir);
            return { error: 'Function directory not found', ...this.results };
        }
        
        // JSON dosyalarını oku
        const files = fs.readdirSync(this.functionDir)
            .filter(f => f.endsWith('.json'))
            .map(f => path.join(this.functionDir, f));
        
        console.log(`[SYNC] Found ${files.length} JSON file(s)`);
        
        if (files.length === 0) {
            console.log('[SYNC] No function files to sync.');
            return this.results;
        }
        
        // Her dosyayı işle
        for (const filePath of files) {
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(raw);
                
                // Array kontrolü
                if (!Array.isArray(data) || data.length === 0) {
                    console.log(`[SKIP] ${filePath}: Not an array or empty`);
                    this.results.skipped++;
                    continue;
                }
                
                const item = data[0]; // İlk elemanı al
                
                // Tip kontrolü — sadece action, filter, pipe sync edilir
                if (!['action', 'filter', 'pipe'].includes(item.type)) {
                    console.log(`[SKIP] ${item.name || 'unknown'}: type='${item.type}' not supported`);
                    this.results.skipped++;
                    continue;
                }
                
                // API'ye gönder
                const response = await this._sendToApi(data);
                
                if (response.ok) {
                    console.log(`[OK] Synced: ${item.name}`);
                    this.results.success++;
                } else {
                    const errorText = await response.text();
                    console.error(`[ERROR] HTTP ${response.status}: ${item.name} — ${errorText}`);
                    this.results.errors++;
                }
            } catch (err) {
                console.error(`[ERROR] Failed to process ${filePath}:`, err.message);
                this.results.errors++;
            }
        }
        
        console.log(`[SYNC] Complete: ${this.results.success} success, ${this.results.errors} errors, ${this.results.skipped} skipped`);
        
        return this.results;
    }
    
    /**
     * Fonksiyon verisini API'ye POST et
     * @param {Array} data - Fonksiyon verisi
     * @returns {Promise<Response>} Fetch response
     */
    async _sendToApi(data) {
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(10000) // 10 saniye timeout
            });
            
            return response;
        } catch (err) {
            console.error('[SYNC] Connection refused. OpenWebUI running?', this.apiUrl);
            throw err;
        }
    }
    
    /**
     * Health check — OpenWebUI erişilebilir mi?
     * @returns {Promise<boolean>} Sunucu sağlıklı mı?
     */
    async healthCheck() {
        try {
            const response = await fetch(`${this.apiUrl.replace('/sync', '')}/api/v1/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            
            return response.ok;
        } catch (err) {
            console.log('[SYNC] OpenWebUI not reachable at:', this.apiUrl);
            return false;
        }
    }
    
    /**
     * Otomatik sync — OpenWebUI hazır olana kadar poll yap
     * @param {number} maxRetries - Maksimum deneme sayısı
     * @param {number} intervalMs - Poll aralığı (ms)
     * @returns {Promise<Object>} Sonuç
     */
    async autoSync(maxRetries = 30, intervalMs = 1000) {
        console.log('[SYNC] Waiting for OpenWebUI...');
        
        for (let i = 0; i < maxRetries; i++) {
            const healthy = await this.healthCheck();
            
            if (healthy) {
                console.log(`[SYNC] OpenWebUI ready after ${i + 1} attempt(s). Starting sync...`);
                return await this.syncFunctions();
            }
            
            console.log(`[SYNC] Waiting... (${i + 1}/${maxRetries})`);
            await this._wait(intervalMs);
        }
        
        console.error('[SYNC] OpenWebUI did not become ready in time.');
        return { error: 'Timeout waiting for OpenWebUI', ...this.results };
    }
    
    /**
     * Bekleme yardımcısı
     * @param {number} ms - Milisaniye
     * @returns {Promise<void>}
     */
    _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Sonuçları döndür
     * @returns {Object} Sonuç objesi
     */
    getResults() {
        return { ...this.results };
    }
}

// ============================================
// CLI Kullanımı (node function-sync-api.js)
// ============================================
if (require.main === module) {
    // Komut satırından çalıştırılıyorsa
    const openwebuiDir = process.argv[2] || path.join(__dirname, '..', '..', 'openwebui');
    const apiUrl = process.argv[3] || 'http://localhost:3000/api/v1/functions/sync';
    
    const syncer = new FunctionSyncApi(openwebuiDir, apiUrl);
    
    syncer.autoSync()
        .then(results => {
            console.log('\n=== SYNC RESULTS ===');
            console.log('Success:', results.success);
            console.log('Errors:', results.errors);
            console.log('Skipped:', results.skipped);
            process.exit(results.errors > 0 ? 1 : 0);
        })
        .catch(err => {
            console.error('[CLI] Fatal error:', err.message);
            process.exit(1);
        });
}

// ============================================
// Module Export
// ============================================
module.exports = FunctionSyncApi;
