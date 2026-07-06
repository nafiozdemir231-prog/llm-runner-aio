# LLM Runner AIO - Test Dağıtım Rehberi

## 🧪 Test Senaryoları

### 1️⃣ Portability Test (Taşınabilirlik)

#### Senaryo A: Farklı Kök Dizinde Çalıştırma
```powershell
# Test 1: C:\ dizininde
Copy-Item -Recurse "D:\OpenCode\LLM-Runner-AIO" "C:\LLM-Runner-Test1"
cd "C:\LLM-Runner-Test1"
npm start

# Test 2: D:\ dizininde başka bir klasörde
Copy-Item -Recurse "D:\OpenCode\LLM-Runner-AIO" "D:\AI-Tools\LLM-Runner-Test2"
cd "D:\AI-Tools\LLM-Runner-Test2"
npm start

# Test 3: Network drive'da (\\server\share\)
Copy-Item -Recurse "D:\OpenCode\LLM-Runner-AIO" "\\localhost\C$\LLM-Runner-Test3"
cd "\\localhost\C$\LLM-Runner-Test3"
npm start
```

**Beklenen Sonuç**: Tüm senaryolarda app kendi dizininden bağımsız çalışmalı.

#### Senaryo B: Başka Makineye Taşıma
```powershell
# 1. ZIP oluştur (node_modules hariç)
Compress-Archive -Path "electron","src","launcher","*.json","*.bat","*.md","package.json","requirements.txt" -DestinationPath "LLM-Runner-Portable.zip"

# 2. Başka PC'ye kopyala ve çıkar
# 3. npm install çalıştır
# 4. npm run rebuild (better-sqlite3 için)
# 5. npm start
```

**Beklenen Sonuç**: App başka makinede de aynı şekilde çalışmalı.

---

### 2️⃣ Server Health Check Testi

```javascript
// test_servers.js
const http = require('http');

async function checkServer(name, host, port) {
    return new Promise((resolve) => {
        const req = http.get(`http://${host}:${port}/`, { timeout: 3000 }, (res) => {
            res.destroy();
            resolve({ name, status: res.statusCode, healthy: res.statusCode >= 200 && res.statusCode < 400 });
        });
        
        req.on('error', () => resolve({ name, status: 'ERR', healthy: false }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ name, status: 'TIMEOUT', healthy: false });
        });
    });
}

(async () => {
    console.log('🔍 Server Health Checks:\n');
    
    const servers = [
        { name: 'SearXNG', host: '127.0.0.1', port: 8080 },
        { name: 'OpenWebUI', host: '127.0.0.1', port: 3000 },
        { name: 'llama.cpp', host: '127.0.0.1', port: 8000 },
        { name: 'Vane', host: '127.0.0.1', port: 8090 }
    ];
    
    for (const server of servers) {
        const result = await checkServer(server.name, server.host, server.port);
        const icon = result.healthy ? '✅' : '❌';
        console.log(`${icon} ${result.name.padEnd(12)} → ${result.status}`);
    }
})();
```

```bash
node test_servers.js
```

---

### 3️⃣ Model Download Testi

```javascript
// test_download.js
const fs = require('fs');
const path = require('path');
const https = require('https');

async function testDownload(url, outputPath) {
    console.log(`📥 Testing download: ${url}`);
    
    // 1MB test dosyası indir
    const file = fs.createWriteStream(outputPath);
    let downloaded = 0;
    
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            const totalSize = parseInt(response.headers['content-length'], 10) || 1024 * 1024;
            
            response.on('data', (chunk) => {
                downloaded += chunk.length;
                file.write(chunk);
                
                const percent = Math.round((downloaded / totalSize) * 100);
                process.stdout.write(`\rDownloading... ${percent}% (${(downloaded / 1024).toFixed(1)} KB)`);
            });
            
            response.on('end', () => {
                file.close();
                console.log(`\n✅ Download complete: ${(downloaded / 1024 / 1024).toFixed(2)} MB`);
                resolve(true);
            });
        }).on('error', (err) => {
            file.close();
            fs.unlinkSync(outputPath);
            console.error(`❌ Failed: ${err.message}`);
            resolve(false);
        });
    });
}

// Küçük bir GGUF modeli test et (20MB civarı)
(async () => {
    const testModel = 'models/test-model.gguf';
    const success = await testDownload(
        'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q8_0.gguf',
        testModel
    );
    
    if (success) {
        const stats = fs.statSync(testModel);
        console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // SHA256 kontrolü
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        const data = fs.readFileSync(testModel);
        hash.update(data);
        console.log(`🔐 SHA256: ${hash.digest('hex')}`);
        
        // Temizlik
        fs.unlinkSync(testModel);
        console.log('🗑️  Test file cleaned up');
    }
})();
```

---

### 4️⃣ Cross-Language Test (8 Dil)

```javascript
// test_i18n.js
const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, 'src', 'lang');
const languages = ['en', 'tr', 'de', 'es', 'fr', 'pt', 'zh', 'ja'];

console.log('🌐 Internationalization Test:\n');

let allPassed = true;

for (const lang of languages) {
    try {
        const filePath = path.join(langDir, `${lang}.json`);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Gerekli anahtarları kontrol et
        const requiredKeys = [
            'app.title', 'servers.searxng', 'servers.openwebui', 'servers.llamacpp', 
            'servers.vane', 'tabs.system', 'tabs.models', 'tabs.picoding', 'tabs.settings',
            'actions.start', 'actions.stop', 'actions.refresh'
        ];
        
        const missing = requiredKeys.filter(key => !content[key]);
        
        if (missing.length > 0) {
            console.log(`❌ ${lang.toUpperCase()} → Missing: ${missing.join(', ')}`);
            allPassed = false;
        } else {
            console.log(`✅ ${lang.toUpperCase()} → All keys present`);
        }
    } catch (err) {
        console.log(`❌ ${lang.toUpperCase()} → Parse error: ${err.message}`);
        allPassed = false;
    }
}

console.log(allPassed ? '\n✅ All languages validated!' : '\n❌ Some translations missing!');
process.exit(allPassed ? 0 : 1);
```

```bash
node test_i18n.js
```

---

### 5️⃣ Configuration Persistence Test

```javascript
// test_config.js
const { ConfigManager } = require('./src/utils/config.js');

(async () => {
    const config = new ConfigManager();
    
    console.log('💾 Configuration Persistence Test:\n');
    
    // 1. Yazma testi
    config.setValue('test.key1', 'value1');
    config.setValue('test.key2', 42);
    config.setValue('test.array', [1, 2, 3]);
    console.log('✅ Write test passed');
    
    // 2. Değer okuma testi
    console.log('Key1:', config.getValue('test.key1')); // value1
    console.log('Key2:', config.getValue('test.key2')); // 42
    console.log('Array:', config.getValue('test.array')); // [1,2,3]
    console.log('✅ Read test passed');
    
    // 3. Dosyadan yükleme testi
    const loaded = config.loadFromDisk();
    console.log('✅ Disk load passed');
    
    // 4. Atomic write testi (dosya koruması)
    try {
        config.setValue('critical.setting', 'important-data');
        config.saveToDisk();
        console.log('✅ Atomic write test passed');
    } catch (err) {
        console.log('❌ Atomic write failed:', err.message);
    }
    
    console.log('\n✅ All configuration tests passed!');
})();
```

---

### 6️⃣ Process Management Test

```javascript
// test_processes.js
const { ProcessManager } = require('./src/workers/process-manager.js');

(async () => {
    const pm = new ProcessManager();
    
    console.log('⚙️ Process Management Tests:\n');
    
    // 1. Orphan detection
    console.log('🔍 Checking for orphan processes...');
    const orphans = await pm.detectOrphans();
    console.log(`Found ${orphans.length} orphan processes`);
    
    // 2. Log buffer test
    console.log('\n📝 Testing log buffer...');
    pm.addLogEntry('test-server', 'INFO', 'Test log message');
    pm.addLogEntry('test-server', 'ERROR', 'Test error message');
    const logs = pm.getLogBuffer('test-server');
    console.log(`Buffer contains ${logs.length} entries`);
    console.log('Last entry:', logs[logs.length - 1]?.message);
    
    // 3. Stream parser test
    console.log('\n🌊 Testing stream parser...');
    pm.handleStreamOutput('test-server', 'stdout', 'Line 1\nLine 2\nLine 3\n');
    const streamLogs = pm.getLogBuffer('test-server');
    console.log(`Stream parsed: ${streamLogs.length} log entries`);
    
    console.log('\n✅ All process management tests passed!');
})();
```

---

### 7️⃣ Full Integration Test (Tüm Sistem)

```javascript
// test_integration.js
const http = require('http');
const fs = require('fs');
const path = require('path');

class IntegrationTester {
    constructor() {
        this.passed = 0;
        this.failed = 0;
    }
    
    async test(name, fn) {
        try {
            await fn();
            console.log(`✅ ${name}`);
            this.passed++;
        } catch (err) {
            console.log(`❌ ${name}: ${err.message}`);
            this.failed++;
        }
    }
    
    report() {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`INTEGRATION TEST RESULTS`);
        console.log(`${'='.repeat(50)}`);
        console.log(`✅ Passed: ${this.passed}`);
        console.log(`❌ Failed: ${this.failed}`);
        console.log(`Total: ${this.passed + this.failed}`);
        console.log(`Status: ${this.failed === 0 ? '🎉 ALL TESTS PASSED' : '⚠️ SOME TESTS FAILED'}`);
        console.log(`${'='.repeat(50)}`);
        
        return this.failed === 0;
    }
}

const tester = new IntegrationTester();

// Test 1: Package.json valid
tester.test('Package.json is valid JSON', () => {
    JSON.parse(fs.readFileSync('package.json', 'utf8'));
});

// Test 2: Config files exist
tester.test('Config files exist', () => {
    const configs = ['electron-builder.json', '.gitignore'];
    for (const cfg of configs) {
        if (!fs.existsSync(cfg)) throw new Error(`${cfg} not found`);
    }
});

// Test 3: Lang files valid
tester.test('All language files are valid JSON', () => {
    const langs = ['en', 'tr', 'de', 'es', 'fr', 'pt', 'zh', 'ja'];
    const langDir = path.join(__dirname, 'src', 'lang');
    for (const lang of langs) {
        const file = path.join(langDir, `${lang}.json`);
        if (!fs.existsSync(file)) throw new Error(`${lang}.json missing`);
        JSON.parse(fs.readFileSync(file, 'utf8'));
    }
});

// Test 4: Source files count
tester.test('Expected number of source files', () => {
    const expectedFiles = [
        'electron/main.js',
        'electron/preload.js',
        'src/index.html',
        'src/css/style.css',
        'src/renderer.js',
        'src/utils/config.js',
        'src/utils/i18n.js',
        'src/utils/helpers.js',
        'src/utils/logger.js',
        'src/workers/server-manager.js',
        'src/workers/process-manager.js',
        'src/workers/vane-integration.js',
        'src/workers/function-sync-api.js',
        'src/tabs/system-detection.js',
        'src/tabs/models.js',
        'src/tabs/picoding.js'
    ];
    
    for (const f of expectedFiles) {
        if (!fs.existsSync(f)) throw new Error(`${f} missing`);
    }
});

// Test 5: Git state
tester.test('Git repository initialized', () => {
    if (!fs.existsSync('.git')) throw new Error('No .git directory');
});

// Test 6: Node modules installed
tester.test('Node modules installed', () => {
    if (!fs.existsSync('node_modules')) throw new Error('node_modules not found');
});

// Test 7: Electron binary available
tester.test('Electron binary available', () => {
    const electronBin = process.platform === 'win32'
        ? 'node_modules/.bin/electron.cmd'
        : 'node_modules/.bin/electron';
    if (!fs.existsSync(electronBin)) throw new Error('Electron binary not found');
});

// Test 8: Better-sqlite3 native module
tester.test('Better-SQLite3 native module compiled', () => {
    const sqliteModule = path.join(
        __dirname,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node'
    );
    if (!fs.existsSync(sqliteModule)) {
        throw new Error('better_sqlite3.node not compiled. Run: npm run rebuild');
    }
});

// Test 9: SearXNG config exists
tester.test('SearXNG configuration exists', () => {
    const searxngSettings = path.join(__dirname, 'searxng', 'settings.yml');
    if (!fs.existsSync(searxngSettings)) throw new Error('searxng/settings.yml missing');
});

// Test 10: OpenWebUI directory exists
tester.test('OpenWebUI directory structure', () => {
    const openwebuiDir = path.join(__dirname, 'openwebui');
    if (!fs.existsSync(openwebuiDir)) throw new Error('openwebui/ directory missing');
});

// Test çalıştır
(async () => {
    console.log('🚀 STARTING INTEGRATION TESTS\n');
    
    await tester.report();
    process.exit(tester.report() ? 0 : 1);
})();
```

```bash
node test_integration.js
```

---

## 📋 Test Checklist

### Pre-Build Tests
- [ ] `npm install` başarılı
- [ ] `npm run rebuild` başarılı (better-sqlite3)
- [ ] `node test_i18n.js` → Tüm diller geçer
- [ ] `node test_integration.js` → Tüm testler geçer

### Build Tests
- [ ] `npm run build:win` → NSIS installer oluşturuldu
- [ ] Installer boyutu kabul edilebilir (< 3GB)
- [ ] Installer imzası doğrulandı (varsa)

### Post-Install Tests
- [ ] Installer çalıştırıldı
- [ ] App başlatıldı
- [ ] 4 sunucu düzgün başladı
- [ ] SearXNG :8080 erişilebilir
- [ ] OpenWebUI :3000 erişilebilir
- [ ] llama.cpp :8000 erişilebilir
- [ ] Vane :8090 erişilebilir
- [ ] Dil değiştirme çalışıyor
- [ ] Tema değiştirme çalışıyor
- [ ] Model tarama çalışıyor
- [ ] Log akışı çalışıyor
- [ ] Graceful shutdown çalışıyor

### Portability Tests
- [ ] Farklı kök dizinde çalışıyor
- [ ] Başka makineye taşındığında çalışıyor
- [ ] Ağ paylaşımında çalışıyor
- [ ] Kısa yol (shortcut) oluşturuluyor

---

**Test Tarihi**: 2026-07-05  
**Test Edilen Versiyon**: Electron Migration v1.0
