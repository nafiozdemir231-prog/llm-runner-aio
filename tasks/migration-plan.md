# 🔄 Eski PyQt6 → Electron Migration Planı

## 📋 Amaç
`D:\OpenCode\LLM-Runner-AIO\LLM-Runner-AIO` klasöründeki eski PyQt6 uygulamasındaki **her dosyayı** tek tek inceleyip, yeni Electron uygulamasına eksiksiz entegre etmek.

---

## 🔍 Dosya Analizi ve Karşılaştırma

### Root Dizin Dosyaları (25 dosya):

| # | Dosya | Boyut | Durum | Açıklama |
|---|-------|-------|-------|----------|
| 1 | `run.bat` | 3,585 B | ⏳ İncelenecek | Bootstrap script - venv oluşturma, pip install, migration, shortcut, app launch |
| 2 | `run2.bat` | 147 B | ⏳ İncelenecek | Basit batch - ne işe yarıyor? |
| 3 | `start_gpu*.bat` | ~350 B × 10 | ⏳ İncelenecek | GPU bazlı başlatma batch dosyaları (8 farklı GPU konfigürasyonu) |
| 4 | `gpu*.ini` | ~2-3 KB × 8 | ⏳ İncelenecek | GPU yapılandırma dosyaları (VRAM/RAM bazlı AI modelleri) |
| 5 | `import_functions.py` | 7,164 B | ⏳ İncelenecek | OpenWebUI fonksiyonlarını içe aktarma |
| 6 | `import_functions_api.py` | 2,466 B | ⏳ İncelenecek | API üzerinden fonksiyon senkronizasyonu |
| 7 | `migrate_ini_to_urls.py` | 2,605 B | ⏳ İncelenecek | INI → JSON migration aracı |
| 8 | `model_urls.json` | 11,610 B | ⏳ İncelenecek | Model URL'leri veritabanı |
| 9 | `requirements.txt` | 4,357 B | ⏳ İncelenecek | Python bağımlılıkları listesi |

### Launcher Dizini (30+ dosya):

| # | Modül | Dosyalar | Boyut | Durum |
|---|-------|----------|-------|-------|
| 10 | `app.py` | Ana uygulama çekirdeği | 15,913 B | ⏳ İncelenecek |
| 11 | `main.py` | Giriş noktası, orphan cleanup | 5,730 B | ⏳ İncelenecek |
| 12 | `config.json` | Uygulama ayarları | 637 B | ⏳ İncelenecek |
| 13 | `ui/main_window.py` | Ana pencere layout | 6,767 B | ⏳ İncelenecek |
| 14 | `ui/settings_dialog.py` | Ayarlar dialogu | 14,121 B | ⏳ İncelenecek |
| 15 | `ui/toolbar.py` | Toolbar butonları | 5,228 B | ⏳ İncelenecek |
| 16 | `ui/tray.py` | Sistem tepsisi menüsü | 2,522 B | ⏳ İncelenecek |
| 17 | `tabs/system_detection.py` | Donanım tespiti | 28,804 B | ⏳ İncelenecek |
| 18 | `tabs/servers.py` | Server yönetimi | 76,849 B | ⏳ İncelenecek |
| 19 | `tabs/models.py` | Model yönetimi | 5,700 B | ⏳ İncelenecek |
| 20 | `tabs/picoding.py` | PiCoding IDE | 15,579 B | ⏳ İncelenecek |
| 21 | `lang/*.json` | 8 dil dosyası | 7-9 KB × 8 | ✅ Mevcut |
| 22 | `create_shortcut.py` | Kısayol oluşturma | 3,596 B | ⏳ İncelenecek |
| 23 | `create_desktop_shortcut.bat` | Desktop kısayol bat | 157 B | ⏳ İncelenecek |

---

## 🎯 Entegrasyon Stratejisi

Her dosya için:
1. ✅ Oku - Ne işe yarıyor?
2. ✅ Mevcut Electron kodunda var mı? Kontrol et
3. ✅ Eksikse → Electron'a ekle
4. ✅ Tasks güncelle - Yapılanları işaretle
5. ✅ Commit ve push

---

## 📊 Mevcut Electron Dosyaları

### Electron Main Process:
- ✅ `electron/main.js` (24KB) - Ana süreç, orphan cleanup, server yönetimi
- ✅ `electron/preload.js` (12KB) - IPC bridge

### Renderer/Tab Modülleri:
- ✅ `src/index.html` (22KB) - HTML yapısı
- ✅ `src/renderer.js` (31KB) - Renderer mantığı
- ✅ `src/css/style.css` (16KB) - Stillar
- ✅ `src/tabs/system-detection.js` (13KB) - Donanım tespiti
- ✅ `src/tabs/servers.js` (var mı?) - ❓ Kontrol edilecek
- ✅ `src/tabs/models.js` (10KB) - Model yönetimi
- ✅ `src/tabs/picoding.js` (10KB) - PiCoding IDE

### Utils/Workers:
- ✅ `src/utils/config.js` (5KB) - Config yöneticisi
- ✅ `src/utils/helpers.js` (9KB) - Yardımcı fonksiyonlar
- ✅ `src/utils/i18n.js` (5KB) - Uluslararasılaştırma
- ✅ `src/utils/logger.js` (7KB) - Loglama
- ✅ `src/workers/function-sync-api.js` (7KB) - API senkronizasyon
- ✅ `src/workers/process-manager.js` (8KB) - Süreç yöneticisi
- ✅ `src/workers/server-manager.js` (16KB) - Server yöneticisi
- ✅ `src/workers/vane-integration.js` (12KB) - Vane entegrasyonu

### Dil Dosyaları:
- ✅ `src/lang/en.json` (7KB)
- ✅ `src/lang/tr.json` (7KB)
- ✅ `src/lang/de.json` (7KB)
- ✅ `src/lang/es.json` (8KB)
- ✅ `src/lang/fr.json` (8KB)
- ✅ `src/lang/ja.json` (9KB)
- ✅ `src/lang/pt.json` (8KB)
- ✅ `src/lang/zh.json` (7KB)

---

## 🚀 Öncelik Sırası

### Phase 1: Kritik Dosyalar (Uygulama Çekirdeği)
1. `app.py` → Tema, config, dil yöneticisi
2. `main.py` → Giriş noktası, orphan cleanup
3. `ui/main_window.py` → Pencere layout
4. `ui/settings_dialog.py` → Ayarlar
5. `ui/toolbar.py` → Toolbar
6. `ui/tray.py` → Sistem tepsisi

### Phase 2: Tab Modülleri (Ana İşlevsellik)
7. `tabs/system_detection.py` → Donanım tespiti
8. `tabs/servers.py` → Server yönetimi (EN BÜYÜK!)
9. `tabs/models.py` → Model yönetimi
10. `tabs/picoding.py` → PiCoding IDE

### Phase 3: Yardımcı Scriptler (Root)
11. `run.bat` → Bootstrap
12. `run2.bat` → Ek batch
13. `start_gpu*.bat` → GPU batch'leri
14. `gpu*.ini` → GPU configs
15. `import_functions.py` → Fonksiyon import
16. `import_functions_api.py` → API sync
17. `migrate_ini_to_urls.py` → Migration
18. `model_urls.json` → Model URLs
19. `requirements.txt` → Bağımlılıklar

### Phase 4: Konfigurasyon ve Kısayollar
20. `config.json` → Uygulama ayarları
21. `create_shortcut.py` → Kısayol oluşturma
22. `create_desktop_shortcut.bat` → Desktop kısayol bat

---

## 📝 Notlar
- Her dosya tamamlandığında bu planı güncelleyeceğim
- ✅ ile bitenler tamamlanmış olacak
- ⏳ ile işaretli olanlar bekleyenler
- Eksik bulunan özellikler Electron'a eklenecek
