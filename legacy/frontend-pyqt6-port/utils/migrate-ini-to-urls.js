/**
 * LLM Runner AIO - Migrate INI to URLs
 * 
 * PyQt6 migrate_ini_to_urls.py'nin Electron karşılığı
 * - INI dosyalarındaki URL'leri çıkarıp model_urls.json oluşturur
 * - INI dosyalarını yerel path'lere çevirir (taşınabilirlik için)
 */

const fs = require('fs');
const path = require('path');
const ini = require('ini');

class IniUrlMigration {
    constructor(rootDir) {
        this.rootDir = rootDir;
        this.iniDir = rootDir;
        this.urlsJsonPath = path.join(rootDir, 'model_urls.json');
        this.modelsDir = path.join(rootDir, 'models');
    }

    /**
     * URL'i göreceli yerel dosya yoluna çevir
     * PyQt6'daki url_to_local_path() fonksiyonunun karşılığı
     * @param {string} url - Model URL'i
     * @param {string} sectionName - INI section adı
     * @returns {string} Yerel dosya yolu
     */
    urlToLocalPath(url, sectionName) {
        if (!url || !url.startsWith('http')) {
            return url;
        }

        // URL'den dosya adını çıkar
        const filename = url.split('/').pop();
        
        // Section adından klasör adını oluştur
        const folderName = sectionName.replace('-vision', '').replace('-Vision', '');
        
        // Göreceli path kullan — taşınabilir
        return `models/${folderName}/${filename}`;
    }

    /**
     * INI dosyasını parse et
     * @param {string} iniPath - INI dosyası yolu
     * @returns {Object} INI içeriği
     */
    parseIniFile(iniPath) {
        const content = fs.readFileSync(iniPath, 'utf8');
        return ini.parse(content);
    }

    /**
     * Parse edilmiş INI verisini string'e çevir
     * @param {Object} data - Parse edilmiş INI objesi
     * @returns {string} INI string formatı
     */
    stringifyIni(data) {
        return ini.stringify(data, { newline: '\r\n' });
    }

    /**
     * Tüm vram*.ini dosyalarını tara, URL'leri çıkar, model_urls.json oluştur
     * PyQt6'daki migrate_ini_files() metodunun karşılığı
     * @returns {Promise<Object>} Sonuç bilgileri
     */
    async migrateIniFiles() {
        // Zaten varsa skip
        if (fs.existsSync(this.urlsJsonPath)) {
            console.log(`[SKIP] ${path.basename(this.urlsJsonPath)} zaten mevcut`);
            return { skipped: true };
        }

        const allUrls = {};
        let iniCount = 0;
        let totalModels = 0;

        // Tüm dosyaları oku
        const files = fs.readdirSync(this.iniDir);
        const iniFiles = files.filter(f => f.match(/^vram.*\.ini$/)).sort();

        if (iniFiles.length === 0) {
            console.log('[INFO] vram*.ini dosyası bulunamadı.');
            return { iniCount: 0, totalModels: 0 };
        }

        for (const iniFile of iniFiles) {
            const iniPath = path.join(this.iniDir, iniFile);
            
            try {
                const config = this.parseIniFile(iniPath);
                
                allUrls[iniFile] = {};

                for (const section of Object.keys(config)) {
                    if (section === '*') continue;

                    const modelUrl = config[section].model || '';
                    const mmprojUrl = config[section].mmproj || '';

                    if (!modelUrl && !mmprojUrl) continue;

                    const entry = {};
                    if (modelUrl) entry.model = modelUrl;
                    if (mmprojUrl) entry.mmproj = mmprojUrl;

                    allUrls[iniFile][section] = entry;

                    // INI'deki URL'leri yerel path'e çevir
                    if (modelUrl) {
                        config[section].model = this.urlToLocalPath(modelUrl, section);
                    }
                    if (mmprojUrl) {
                        config[section].mmproj = this.urlToLocalPath(mmprojUrl, section);
                    }
                }

                // INI dosyasını güncelle (yerel path'lerle)
                fs.writeFileSync(iniPath, this.stringifyIni(config), 'utf8');
                
                iniCount++;
                totalModels += Object.keys(allUrls[iniFile]).length;
                console.log(`[OK] ${iniFile} güncellendi (${allUrls[iniFile].length} model)`);

            } catch (err) {
                console.error(`[ERROR] ${iniFile} işlenirken hata:`, err.message);
            }
        }

        // model_urls.json yaz
        fs.writeFileSync(this.urlsJsonPath, JSON.stringify(allUrls, null, 2), 'utf8');

        console.log(`\n[OK] ${path.basename(this.urlsJsonPath)} oluşturuldu`);
        console.log(`     Toplam INI: ${iniCount}`);
        console.log(`     Toplam model: ${totalModels}`);

        return {
            iniCount,
            totalModels,
            urlsJsonPath: this.urlsJsonPath
        };
    }

    /**
     * model_urls.json dosyasını oku
     * @returns {Object} Model URL'leri objesi
     */
    readModelUrls() {
        if (!fs.existsSync(this.urlsJsonPath)) {
            return {};
        }

        const raw = fs.readFileSync(this.urlsJsonPath, 'utf8');
        return JSON.parse(raw);
    }

    /**
     * Belirli bir INI preset'i için tüm modelleri döndür
     * @param {string} iniFileName - INI dosya adı (örn: gpu1vram12ram32models.ini)
     * @returns {Object} Section → {model, mmproj} eşleştirme
     */
    getModelsForIni(iniFileName) {
        const urls = this.readModelUrls();
        return urls[iniFileName] || {};
    }

    /**
     * Yeni bir model URL'i ekle
     * @param {string} iniFileName - INI dosya adı
     * @param {string} sectionName - Section adı
     * @param {Object} urls - {model, mmproj} URL'leri
     */
    addModelUrl(iniFileName, sectionName, urls) {
        const data = this.readModelUrls();
        
        if (!data[iniFileName]) {
            data[iniFileName] = {};
        }
        
        data[iniFileName][sectionName] = urls;
        
        fs.writeFileSync(this.urlsJsonPath, JSON.stringify(data, null, 2), 'utf8');
    }
}

// ============================================
// CLI Kullanımı (node migrate-ini-to-urls.js)
// ============================================
if (require.main === module) {
    const rootDir = process.argv[2] || __dirname;
    
    const migrator = new IniUrlMigration(rootDir);
    
    migrator.migrateIniFiles()
        .then(results => {
            console.log('\n=== MIGRATION COMPLETE ===');
            if (results.skipped) {
                console.log('Skipped — model_urls.json already exists.');
            } else {
                console.log('INI Files Processed:', results.iniCount);
                console.log('Total Models:', results.totalModels);
            }
        })
        .catch(err => {
            console.error('[CLI] Fatal error:', err.message);
            process.exit(1);
        });
}

// ============================================
// Module Export
// ============================================
module.exports = IniUrlMigration;
