# Better-SQLite3 Native Compile Kurulum Rehberi

## Ön Koşullar

### Windows (Önerilen)
1. **Visual Studio Build Tools 2022** kurulumu:
   ```powershell
   # Chocolatey ile (önceden kurulu ise)
   choco install visualstudio2022buildtools --yes
   
   # Manuel kurulum: https://visualstudio.microsoft.com/downloads/
   # "Desktop development with C++" workload'u seçin
   ```

2. **Python Build Standalone** (eğer VS Build Tools sorun çıkarırsa):
   ```powershell
   npm install --global windows-build-tools
   ```

### macOS
```bash
xcode-select --install
brew install python@3.11
```

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install -y build-essential python3-dev
```

## Native Module Rebuild

Her platformda app'i çalıştırmadan önce:

```bash
# Better-sqlite3 native compile
npm run rebuild

# VEYA manuel
npx electron-rebuild -f -w better-sqlite3
```

## Doğrulama Testi

```javascript
// test_sqlite.js
const Database = require('better-sqlite3');
try {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO test (name) VALUES (?)').run('test');
    const row = db.prepare('SELECT * FROM test').get();
    console.log('✅ Better-SQLite3 works:', row);
} catch (err) {
    console.error('❌ Failed:', err.message);
}
```

```bash
node test_sqlite.js
```

## CI/CD Otomatik Derleme (GitHub Actions)

`.github/workflows/build.yml` dosyası:

```yaml
name: Build & Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: |
          npm ci
          npm run rebuild
          
      - name: Build NSIS installer
        run: npx electron-builder build --win --publish never
        
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: LLM-Runner-AIO-Windows-x64
          path: dist/LLM-Runner-AIO-*-windows-x64.exe
```

## Sorun Giderme

### Hata: `Cannot find module 'better_sqlite3.node'`
```bash
# Çözüm: Native modülü yeniden derle
npm run rebuild
```

### Hata: `MSBuild.exe bulunamadı`
- Visual Studio Build Tools kurun
- PATH kontrolü: `where MSBuild`

### Hata: `Python version mismatch`
```bash
# Node.js 20 için Python 3.11+ gerekli
python --version
# Eski sürüm ise:
nvm use 20  # veya
pyenv install 3.11
```

### Hata: `EPERM: operation not permitted`
```powershell
# Admin olarak PowerShell açın
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Cross-Platform Notlar

| Platform | Gereksinim | Komut |
|----------|------------|-------|
| Windows | VS Build Tools 2022 | `npm run rebuild` |
| macOS | Xcode Command Line Tools | `npm run rebuild` |
| Linux | build-essential + python3-dev | `npm run rebuild` |

**Önemli**: Her platformda native modül yeniden derlenmelidir. Bir platformda derlenen binary diğerinde çalışmaz!
