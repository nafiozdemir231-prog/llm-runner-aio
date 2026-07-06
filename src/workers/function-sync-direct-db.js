/**
 * LLM Runner AIO - Direct Database Sync Worker
 * 
 * PyQt6 import_functions.py'nin Electron karşılığı (doğrudan SQLite erişim)
 * - function/ klasöründeki JSON dosyalarını OpenWebUI veritabanına ekler
 * - better-sqlite3 kullanarak doğrudan DB okuma/yazma
 * - action, filter, pipe, tool tiplerini işler
 * 
 * GEREKSİNİM: npm install better-sqlite3
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class FunctionSyncDirectDB {
    /**
     * Constructor
     * @param {string} openwebuiDir - OpenWebUI dizini yolu
     */
    constructor(openwebuiDir) {
        this.openwebuiDir = openwebuiDir;
        this.dbPath = null;
        this.conn = null;
        this.results = {
            functionsAdded: 0,
            functionsUpdated: 0,
            toolsAdded: 0,
            toolsUpdated: 0,
            errors: []
        };
    }
    
    /**
     * Veritabanı yolunu bul
     * PyQt6'daki db_path bulma mantığının karşılığı
     * @returns {string|null} Veritabanı yolu veya null
     */
    findDatabasePath() {
        const candidates = [
            path.join(this.openwebuiDir, 'database', 'webui.db'),
            path.join(this.openwebuiDir, 'openwebui.db'),
            path.join(this.openwebuiDir, 'backend', 'openwebui.db')
        ];
        
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        
        return null;
    }
    
    /**
     * Bağlantıyı aç
     * @returns {Promise<boolean>} Başarılı mı?
     */
    async connect() {
        this.dbPath = this.findDatabasePath();
        
        if (!this.dbPath) {
            console.log('[DB] Veritabanı bulunamadı — OpenWebUI henüz başlatılmamış olabilir.');
            return false;
        }
        
        console.log(`[DB] Veritabanı: ${this.dbPath}`);
        
        try {
            this.conn = new Database(this.dbPath);
            this.conn.pragma('journal_mode = WAL');
            return true;
        } catch (err) {
            console.error('[DB] Bağlantı hatası:', err.message);
            return false;
        }
    }
    
    /**
     * Admin user_id'sini bul
     * @returns {string|null} Admin user ID veya null
     */
    getAdminUserId() {
        try {
            const stmt = this.conn.prepare("SELECT id FROM user WHERE role = 'admin' LIMIT 1");
            const row = stmt.get();
            if (row) {
                console.log(`[DB] Admin user_id: ${row.id}`);
                return row.id;
            }
        } catch (err) {
            console.warn('[DB] Admin kullanıcı bulunamadı:', err.message);
        }
        return '';
    }
    
    /**
     * Tablo varlığını kontrol et
     * @param {string} tableName - Tablo adı
     * @returns {boolean} Tablo mevcut mu?
     */
    tableExists(tableName) {
        try {
            const stmt = this.conn.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
            );
            const row = stmt.get(tableName);
            return !!row;
        } catch {
            return false;
        }
    }
    
    /**
     * Fonksiyon senkronizasyonu başlat
     * PyQt6'daki import_functions() metodu
     * @returns {Promise<Object>} Sonuç objesi
     */
    async syncFunctions() {
        console.log('[SYNC] Starting direct DB function sync...');
        
        this.results = {
            functionsAdded: 0,
            functionsUpdated: 0,
            toolsAdded: 0,
            toolsUpdated: 0,
            errors: []
        };
        
        // Bağlantı aç
        const connected = await this.connect();
        if (!connected) {
            return this.results;
        }
        
        try {
            // function tablosu var mı?
            const hasFunctionTable = this.tableExists('function');
            if (!hasFunctionTable) {
                console.log('[DB] function tablosu henüz oluşturulmamış.');
                return this.results;
            }
            
            // tool tablosu var mı?
            const hasToolTable = this.tableExists('tool');
            
            // Admin user_id
            const adminUserId = this.getAdminUserId() || '';
            
            // function/ klasörünü bul
            const functionDir = path.join(this.openwebuiDir, 'function');
            if (!fs.existsSync(functionDir)) {
                console.error(`[ERROR] function/ klasörü bulunamadı: ${functionDir}`);
                return this.results;
            }
            
            // JSON dosyalarını yükle
            const jsonFiles = fs.readdirSync(functionDir)
                .filter(f => f.endsWith('.json'))
                .map(f => path.join(functionDir, f))
                .sort();
            
            if (jsonFiles.length === 0) {
                console.log('[SYNC] function/ klasöründe JSON dosyası yok.');
                return this.results;
            }
            
            console.log(`[SYNC] ${jsonFiles.length} fonksiyon dosyası bulundu.`);
            
            // Her JSON dosyasını işle
            for (const jsonFile of jsonFiles) {
                try {
                    const raw = fs.readFileSync(jsonFile, 'utf8-sig');
                    const data = JSON.parse(raw);
                    
                    if (!Array.isArray(data) || data.length === 0) {
                        continue;
                    }
                    
                    const item = data[0];
                    const itemId = item.id;
                    const name = item.name || 'Unknown';
                    const itemType = item.type; // action, filter, pipe, tool, undefined
                    
                    // Function type (action, filter, pipe) -> function tablosu
                    if (['action', 'filter', 'pipe'].includes(itemType)) {
                        const funcType = itemType;
                        const content = item.content || '';
                        const meta = JSON.stringify(item.meta || {});
                        let userId = item.user_id || '';
                        
                        if (!userId && adminUserId) {
                            userId = adminUserId;
                        }
                        
                        const isActive = item.is_active !== false;
                        const isGlobal = item.is_global || false;
                        const valves = JSON.stringify(item.valves || null);
                        const createdAt = item.created_at || Math.floor(Date.now() / 1000);
                        const updatedAt = Math.floor(Date.now() / 1000);
                        
                        // Var mı kontrolü
                        const existing = this.conn.prepare("SELECT id FROM function WHERE id = ?").get(itemId);
                        
                        if (existing) {
                            // Güncelle
                            this.conn.prepare(`
                                UPDATE function 
                                SET name=?, type=?, content=?, meta=?, user_id=?,
                                    is_active=?, is_global=?, valves=?, updated_at=?
                                WHERE id = ?
                            `).run(
                                name, funcType, content, meta, userId,
                                isActive, isGlobal, valves, updatedAt,
                                itemId
                            );
                            this.results.functionsUpdated++;
                            console.log(`  [OK] Güncellendi (function): ${name}`);
                        } else {
                            // Ekle
                            this.conn.prepare(`
                                INSERT INTO function
                                (id, user_id, name, type, content, meta, valves, created_at, updated_at, is_active, is_global)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).run(
                                itemId, userId, name, funcType, content, meta, valves,
                                createdAt, updatedAt, isActive, isGlobal
                            );
                            this.results.functionsAdded++;
                            console.log(`  [OK] Eklendi (function): ${name}`);
                        }
                    }
                    
                    // Tool type -> tool tablosu
                    if ((itemType === null || itemType === 'tool') && hasToolTable) {
                        const toolId = item.id;
                        const toolName = item.name || 'Unknown';
                        const content = item.content || '';
                        const specs = JSON.stringify(item.specs || []);
                        const meta = JSON.stringify(item.meta || {});
                        let userId = item.user_id || '';
                        
                        if (!userId && adminUserId) {
                            userId = adminUserId;
                        }
                        
                        const createdAt = item.created_at || Math.floor(Date.now() / 1000);
                        const updatedAt = Math.floor(Date.now() / 1000);
                        const valves = JSON.stringify(item.valves || null);
                        
                        // Var mı kontrolü
                        const existing = this.conn.prepare("SELECT id FROM tool WHERE id = ?").get(toolId);
                        
                        if (existing) {
                            // Güncelle
                            this.conn.prepare(`
                                UPDATE tool 
                                SET name=?, content=?, specs=?, meta=?, user_id=?,
                                    valves=?, updated_at=?
                                WHERE id = ?
                            `).run(
                                toolName, content, specs, meta, userId,
                                valves, updatedAt,
                                toolId
                            );
                            this.results.toolsUpdated++;
                            console.log(`  [OK] Güncellendi (tool): ${toolName}`);
                        } else {
                            // Ekle
                            this.conn.prepare(`
                                INSERT INTO tool
                                (id, user_id, name, content, specs, meta, valves, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).run(
                                toolId, userId, toolName, content, specs, meta, valves,
                                createdAt, updatedAt
                            );
                            this.results.toolsAdded++;
                            console.log(`  [OK] Eklendi (tool): ${toolName}`);
                        }
                    }
                    
                } catch (err) {
                    console.error(`  [ERROR] (${path.basename(jsonFile)}): ${err.message}`);
                    this.results.errors.push({ file: jsonFile, error: err.message });
                }
            }
            
        } finally {
            // Bağlantıyı kapat
            if (this.conn) {
                this.conn.close();
                this.conn = null;
            }
        }
        
        console.log(`\n[OK] Fonksiyonlar: ${this.results.functionsAdded} eklendi, ${this.results.functionsUpdated} güncellendi`);
        console.log(`[OK] Araçlar: ${this.results.toolsAdded} eklendi, ${this.results.toolsUpdated} güncellendi`);
        
        return this.results;
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
// CLI Kullanımı (node function-sync-direct-db.js)
// ============================================
if (require.main === module) {
    const openwebuiDir = process.argv[2] || path.join(__dirname, '..', '..', 'openwebui');
    
    const syncer = new FunctionSyncDirectDB(openwebuiDir);
    
    syncer.syncFunctions()
        .then(results => {
            console.log('\n=== SYNC RESULTS ===');
            console.log('Functions Added:', results.functionsAdded);
            console.log('Functions Updated:', results.functionsUpdated);
            console.log('Tools Added:', results.toolsAdded);
            console.log('Tools Updated:', results.toolsUpdated);
            if (results.errors.length > 0) {
                console.log('Errors:', results.errors.length);
            }
            process.exit(results.errors.length > 0 ? 1 : 0);
        })
        .catch(err => {
            console.error('[CLI] Fatal error:', err.message);
            process.exit(1);
        });
}

// ============================================
// Module Export
// ============================================
module.exports = FunctionSyncDirectDB;
