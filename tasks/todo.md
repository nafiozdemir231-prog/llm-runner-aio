# Task: PyQt6 → Electron Migration (Faz 1: Foundation & App Shell)

## Faz 1: Electron Foundation & App Shell (2 Hafta)
- [x] 1.1. `package.json` oluştur (✅ ZATEN MEVCUT)
- [x] 1.2. `electron/main.js` temel yapı (BrowserWindow, app lifecycle) ✅
- [x] 1.3. `preload.js` context bridge (contextIsolation: true) ✅
- [x] 1.4. `src/index.html` boş şablon + CSS linkleri ✅
- [x] src/css/style.css dark/light tema stilleri ✅
- [x] 1.5. `npm install` ile bağımlılıkları yükle ✅ (482 package, --ignore-scripts)
- [ ] 1.6. `electron-rebuild` ile better-sqlite3 native compile (VS Build Tools gerekli — Faz 2'ye ertelendi)
- [x] 1.7. 8 dil JSON dosyalarını `src/lang/` kopyala + i18n entegrasyonu ✅

**Faz 1 Durum: 6/7 tamamlandı (better-sqlite3 hariç)**

## Faz 2: Core Utility Modülleri (Sonraki)
- [x] 2.1. `src/utils/config.js` (ConfigManager — fs + atomic rename) ✅
- [x] 2.2. `src/utils/i18n.js` (LanguageManager — JSON yükleme, onChange listeners) ✅
- [x] 2.3. `src/utils/logger.js` (Rotating log — winston yerine custom RotatingLogger) ✅
- [x] 2.4. `src/utils/helpers.js` (Port check via net.Socket, SHA256 via crypto.createHash) ✅
- [ ] 2.5. `src/workers/function-sync-api.js` (import_functions_api.py → REST API sync)
- [x] 2.6. Cross-platform Python resolver (`which python` / `where python` helper) ✅ helpers.js içinde
- [x] 2.5. `src/workers/function-sync-api.js` (import_functions_api.py → REST API sync) ✅

## Faz 3: Ana Pencere ve UI (Sonraki)
- [x] 3.1. `src/index.html` toolbar + tab yapısı ✅ (Faz 1'de oluşturuldu)
- [x] 3.2. `src/css/style.css` dark/light tema ✅ (Faz 1'de oluşturuldu)
- [x] 3.3. `src/renderer.js` tab switching logic (pyqtSignal → EventEmitter pattern) ✅
- [x] 3.4. `src/settings-dialog.html/js` settings modal ✅ (renderer.js içinde)
- [ ] 3.5. System tray entegrasyonu (`electron.Tray`) — main.js'te var, renderer'dan kontrol gerekli
- [x] 3.6. Font size +/-, theme toggle, language switch UI ✅ (renderer.js içinde)

## Faz 4: Tab Modülleri & Process Management (Sonraki)
- [x] 4.1. `src/tabs/system-detection.js` hardware detection (gpu*.ini parsing, nvidia-smi execSync, systeminformation fallback) ✅
- [x] 4.2. `src/workers/server-manager.js` server control (child_process.spawn + tree-kill) ✅
- [x] 4.3. `src/workers/process-manager.js` stdout/stderr stream parser (UI console'a feed) ✅
- [x] 4.4. `src/tabs/picoding.js` working directory + MCP config ✅
- [x] 4.5. `src/tabs/models.js` model browser + download manager (node-fetch streaming) ✅
- [x] 4.6. Health check timer (setInterval HTTP ping, sleep-mode recovery) ✅ server-manager.js içinde

## Faz 5: Vane Entegrasyonu & İlk-Run Bootloader (Sonraki)
- [x] 5.1. Vane Next.js static export konfigürasyonu (output: 'export') ✅
- [x] 5.2. Build sırasında `npm run build` ile statik dosya üretimi ✅
- [x] 5.3. Electron'da `loadFile('Vane/out/index.html')` yükleme ✅
- [x] 5.4. İlk-run bootloader: Node.js venv oluşturma + pip install requirements.txt ✅
- [x] 5.5. OpenWebUI health-check poll loop → function-sync-api.js trigger ✅
- [x] 5.6. migrate_ini_to_urls.json migration script'i (ilk çalıştırma) ✅

**Faz 5 Durum: 6/6 tamamlandı (vane-integration.js içinde tümü)**

## Faz 6: Paketleme & Dağıtım (Sonraki)
- [x] 6.1. `electron-builder.json` konfigürasyonu ✅
- [x] 6.2. `.gitignore` güncelleme (node_modules/, dist/, *.log) ✅
- [x] 6.3. README.md güncelleme (Electron kurulum talimatları + Development Guide) ✅
- [ ] 6.4. Test dağıtımı — farklı dizinlerde portability test
- [ ] 6.5. Legacy Python launcher kaldırma (run.bat, main.py, import_functions.py)

**Faz 6 Durum: 3/5 tamamlandı**
- [ ] 6.2. `.gitignore` güncelleme (node_modules/, dist/, *.log)
- [ ] 6.3. README.md güncelleme (Electron kurulum talimatları)
- [ ] 6.4. Test dağıtımı — farklı dizinlerde portability test
- [ ] 6.5. Legacy Python launcher kaldırma (run.bat, main.py, import_functions.py)

## Notes
- Her faz sonunda tasks/state.md güncellenecek
- Electron mimarisi: electron.md dosyasındaki plana sadık kalınacak
- Mevcut PyQt6 kodu launcher/ klasöründe referans olarak duruyor
- Son güncelleme: 2026-07-05 — Faz 1 başlıyor
