# 🚀 LLM Runner AIO — GitHub Push Rehberi

Bu rehber, projenin **sadece gerekli** dosyalarının GitHub'a yüklenmesi için hazırlanmıştır. Gereksiz büyük dosyalar (modeller, node_modules, veritabanları) hariç tutulur.

---

## 📦 Dahil Edilecek Klasörler ve Dosyalar

### ✅ `launcher/` — Uygulama Çekirdeği
Tüm Python kaynak kodları, dil dosyaları ve yapılandırma dosyaları:
```
launcher/
├── main.py                  # Ana giriş noktası
├── app.py                   # Uygulama yöneticisi
├── config.json              # Kullanıcı ayarları
├── create_shortcut.py       # Kısayol oluşturma aracı
├── create_desktop_shortcut.bat
├── lang/                    # 8 dil dosyası (en, tr, de, es, fr, pt, zh, ja)
│   ├── en.json
│   ├── tr.json
│   ├── de.json
│   ├── es.json
│   ├── fr.json
│   ├── pt.json
│   ├── zh.json
│   └── ja.json
├── tabs/                    # Sekme modülleri
│   ├── servers.py           # Sunucu worker'ları (SearXNG, OpenWebUI, llama.cpp, Vane)
│   ├── system_detection.py  # Sistem tespiti
│   ├── models.py            # Model yönetimi
│   └── picoding.py          # Pi Coding sekmesi
└── ui/                      # Arayüz bileşenleri
    ├── main_window.py       # Ana pencere
    ├── settings_dialog.py   # Ayarlar diyalogu
    ├── toolbar.py           # Araç çubuğu
    └── tray.py              # Sistem tepsisi
```

### ✅ Ana Dizin Dosyaları — Yapılandırma ve Scriptler
```
*.py                         # Tüm Python scriptleri (*.pyc hariç)
*.bat                        # Batch dosyaları
*.ini                        # GPU/model yapılandırma dosyaları
*.json                       # JSON yapılandırma dosyaları
*.txt                        # README, LICENSE, requirements.txt vb.
*.md                         # Dokümantasyon dosyaları
*.vbs                        # Silent başlatma scripti
.gitignore                   # Git yok sayma listesi
LICENSE.txt                  # Lisans dosyası
README.md                    # Proje dokümantasyonu
requirements.txt             # Python bağımlılıkları
model_urls.json              # Model indirme URL'leri
```

### ✅ `tasks/` — Proje Takip Dosyaları
```
tasks/
├── todo.md                  # Yapılacaklar listesi
├── state.md                 # Proje durumu raporu
├── change.md                # Değişiklik geçmişi
├── lessons.md               # Öğrenilen dersler
├── project.md               # Proje mimari dökümanı
└── QA_SECURITY_REPORT.md    # Güvenlik raporları
```

### ✅ `assets/` — Görseller
```
assets/                      # İkonlar ve görsel varlıklar
```

---

## 🚫 Hariç Tutulacak Klasörler ve Dosyalar

### ❌ Büyük Veri ve Model Klasörleri
```
models/                      # GGUF modeller (~GB'larca veri)
openwebui/                   # OpenWebUI frontend/backend (2.3GB+)
Vane/                        # Vane AI Next.js proje (2GB+)
searxng/                     # SearXNG veritabanı (147MB+)
llama.cpp-cuda13+vulkan/     # CUDA binary dosyaları (~GB'larca)
```

### ❌ Sanal Ortam ve Önbellek
```
venv/                        # Python sanal ortamı
__pycache__/                 # Python byte kod önbelleği
node_modules/                # npm paketleri (her alt dizinde)
```

### ❌ Geçici ve Derleme Dosyaları
```
build/                       # Derleme çıktıları
dist/                        # Dağıtım dosyaları
*.exe                        # Çalıştırılabilir dosyalar
*.log                        # Log dosyaları
*.tmp                        # Geçici dosyalar
*.bak                        # Yedek dosyalar
installer/                   # Kurulum arşivleri
*.sfx, *.rar                 # Sıkıştırılmış arşivler
```

### ❌ Kişisel ve Gizli Dosyalar
```
.env                         # API anahtarları ve gizli ayarlar
.local.properties            # Yerel yapılandırma
.webui_secret_key            # WebUI gizli anahtarı
.vscode/, .idea/             # IDE klasörleri
.DS_Store, Thumbs.db         # İşletim sistemi dosyaları
```

### ❌ Test Dosyaları
```
test_*.py                    # Test scriptleri
icon_test.txt                # Test görselleri
test_write.txt               # Test çıktıları
nul                          # Boş dosya
```

---

## 🔧 Adım Adım GitHub Push Talimatları

### Ön Hazırlık

#### 1. Git Kurulumu (İlk Kez Kullanıyorsanız)
```powershell
# Git yüklü değilse indirin:
# https://git-scm.com/download/win

# Kurulum sonrası kullanıcı bilgilerini ayarlayın:
git config --global user.email "email@adresiniz.com"
git config --global user.name "Kullanıcı Adınız"
```

#### 2. Projeye Git Başlatma
```powershell
cd "D:\OpenCode\LLM-Runner-AIO"
git init
git remote add origin https://github.com/KULLANICIADI/llm-runner-aio.git
```

### Dosyaları Ekleme

#### 3. Sadece Gerekli Dosyaları Stage Etme
```powershell
# launcher klasörü
git add launcher/

# Ana dizindeki dosyalar (klasörler hariç)
git add *.py *.bat *.ini *.json *.txt *.md *.vbs .gitignore LICENSE.txt README.md requirements.txt

# tasks klasörü
git add tasks/

# assets klasörü
git add assets/
```

#### 4. Durumu Kontrol Etme
```powershell
git status
```
✅ **Doğru görünmeli:**
- `launcher/`, `tasks/`, `assets/` → **staged** (yeşil)
- `models/`, `openwebui/`, `Vane/`, `venv/`, `__pycache__/` → **unstaged** (kırmızı ??)

❌ **Yanlışsa:** `.gitignore` dosyanızı kontrol edin.

### Commit ve Push

#### 5. Commit Yapma
```powershell
git commit -m "feat: LLM Runner AIO - QA güvenlik düzeltmeleri ve tüm özellikler"
```

#### 6. GitHub'a Push Etme
```powershell
git push -u origin main
```

#### 7. Sonraki Güncellemeler İçin
```powershell
# Her değişiklikten sonra:
git add .
git commit -m "fix/aciklama: yapilan degisiklik"
git push origin main
```

---

## 🔄 Dal (Branch) Yönetimi

### Varsayılan Dalı `main` Olarak Ayarlama
GitHub'da:
1. Repo sayfasına git: `https://github.com/KULLANICIADI/llm-runner-aio`
2. **Settings** → **Branches**
3. **Default branch name** kutusundan `main`i seç
4. **Update** butonuna tıkla

### Eski `master` Dalını Temizleme (İsteğe Bağlı)
```powershell
git push origin --delete master
git branch -d master
```

---

## 📊 Toplam Dosya Özeti

| Kategori | Dosya Sayısı | Açıklama |
|----------|--------------|----------|
| `launcher/` | ~21 dosya | Uygulama çekirdeği, worker'lar, UI |
| `tasks/` | ~6 dosya | Proje takibi, raporlar, dokümantasyon |
| Ana dizin scriptleri | ~44 dosya | Build, setup, GPU yapılandırma, batch |
| `assets/` | ~10 dosya | Görseller, ikonlar |
| **TOPLAM** | **~80 dosya** | ~9000+ satır kod |

---

## 🔒 Güvenlik Kontrol Listesi

Push öncesi şu dosyaların **hariç** olduğundan emin olun:

- [ ] `.env` dosyası yok
- [ ] `venv/` klasörü yok
- [ ] `__pycache__/` klasörü yok
- [ ] `*.db` dosyaları yok
- [ ] `node_modules/` klasörleri yok
- [ ] `models/` klasörü yok
- [ ] `.webui_secret_key` dosyası yok
- [ ] API anahtarları kod içinde hardcoded değil

---

## ⚡ Sorun Giderme

### "Permission denied" Hatası
```powershell
# SSH anahtarı kontrolü
ssh -T git@github.com

# Eğer çalışmazsa HTTPS kullanın
git remote set-url origin https://github.com/KULLANICIADI/llm-runner-aio.git
```

### "Already up-to-date" Mesajı
Git zaten güncel demek. Değişiklik yapmadan push etmeyin.

### Büyük Dosya Push Hatası
GitHub maksimum 100MB dosya sınırı koyar. `.gitignore` dosyanızı kontrol edin.

### Çakışan Commit'ler
```powershell
git pull origin main --rebase
# Çakışmaları çözün
git add .
git rebase --continue
git push origin main
```

---

## 📞 Destek

Sorun yaşarsanız:
1. `git status` çıktısını kontrol edin
2. `.gitignore` dosyanızı gözden geçirin
3. GitHub repository settings'te branch koruma kurallarını kontrol edin

---

*Son Güncelleme: 2026-07-04*  
*Hazırlayan: QA & Security Analysis Team*
