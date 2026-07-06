# PyQt6 → Electron Entegrasyon Planı

## Analiz Sonucu

PyQt6 (`launcher/`) uygulamasını inceledim. Electron (`electron/` + `src/`) mevcut altyapıya sahip ancak şu **kritik özellikler eksik**:

---

## 🔴 CRITICAL — Server Startup Logic (PyQt6 Worker'ları)

### 1. SearXNGWorker (servers.py satır ~270-330)
**Python'da:**
- `settings.yml` dosyasına YAML parser ile bind_address/port yazıyor
- PYTHONPATH'e searxng klasörünü ekliyor
- `python -m searx.webapp` komutu çalıştırıyor

**Electron'da eksik:**
- Sadece `python -m searx.webapp` çalıştırılıyor
- settings.yml güncellemesi YOK
- PYTHONPATH env var eklemesi YOK

**Çözüm:** `startSearXNG()` fonksiyonunu genişlet
- YAML parser veya regex ile settings.yml güncelle
- Environment variables ekle

---

### 2. OpenWebUIWorker (servers.py satır ~330-470)
**Python'da:**
- `secrets.token_hex(32)` ile WEBUI_SECRET_KEY oluştur/kaydet
- DATABASE_URL, OPENAI_API_BASE_URL, SEARXNG_QUERY_URL gibi 15+ env var ayarla
- `backend/` dizinine PYTHONPATH ekle
- `import_functions.py` scriptini 15sn sonra arka planda çalıştır
- `uvicorn.run('open_webui.main:app', ...)` komutu oluştur (python -c ile)

**Electron'da eksik:**
- Basit `python -m uvicorn` komutu var
- Secret key oluşturma YOK
- 15+ environment variable YOK
- import_functions delay execution YOK

**Çözüm:** `startOpenWebUI()` fonksiyonunu genişlet
- crypto.randomBytes ile secret key oluştur
- Tüm env vars ekle
- Arka plan import thread'i ekle

---

### 3. LlamaCppWorker (servers.py satır ~470-530)
**Python'da:**
- Seçili INI'ya göre DİNAMİK `.bat` dosyası oluşturur
- Bat içeriği: `--host`, `--port`, `--ctx-size`, `--models-preset`, `--jinja` parametreleri
- `.bat` dosyasını subprocess ile çalıştırır

**Electron'da eksik:**
- Direkt `llama-server.exe` çalıştırma var
- Dinamik BAT oluşturma YOK
- Context Size desteği YOK

**Çözüm:** `startLlamaCPP()` fonksiyonunu genişlet
- INI preset varsa dinamik BAT oluştur
- Bat'ı subprocess ile çalıştır
- Context Size parametresi ekle

---

### 4. VaneWorker (servers.py satır ~530-590)
**Python'da:**
- `.next` klasörünü siler (Turbopack junction hatası önleme)
- `shutil.which("node")` ile Node.js bulur
- Port çakışması kontrolü (3000 → 3001)
- `SEARXNG_API_URL` env var ayarla
- `npm run dev -- -p PORT` komutu çalıştırır

**Electron'da eksik:**
- `.next` temizleme YOK
- Turbopack fix YOK
- npm run dev pattern'i YOK

**Çözüm:** `startVane()` fonksiyonunu genişlet
- `.next` dizinini sil
- `npm run dev` pattern kullan
- SEARXNG_API_URL ekle

---

## 🟡 HIGH — Process Management & Lifecycle

### 5. Graceful Shutdown with Process Tree Kill
**Python'da (stop_process):**
- psutil.Process(pid) ile parent bul
- children(recursive=True) ile tüm alt process'leri topla
- Leaf-first terminate (çocuklar önce, sonra ebeveyn)
- 10s wait → force kill fallback
- Port bazlı emergency kill (netstat ile)

**Electron'da eksik:**
- Basit SIGTERM → 10s → treeKill var
- Process tree traversal YOK
- Leaf-first termination YOK
- Port bazlı fallback kill YOK

**Çözüm:** `stopServer()` fonksiyonunu genişlet
- Windows tasklist/netstat ile process tree bul
- Leaf-first kill sequence uygula
- Port bazlı emergency kill ekle

---

### 6. Health Check Timer (Bug #10)
**Python'da:**
- QTimer ile her 60 saniyede bir çalışır
- Her sunucu için HTTP ping yapar (HEAD request)
- Yanıt yoksa: stop → 2s bekle → yeniden başlat

**Electron'da eksik:**
- Health check polling var ama RESTART yok
- Unresponsive sunucu tespiti YOK

**Çözüm:** `startHealthCheck()` fonksiyonunu genişlet
- Unresponsive sunucuları otomatik restart et
- Renderer'a 'health-restart' event gönder

---

### 7. Port Conflict Detection (Bug #4)
**Python'da:**
- socket.bind() denemesi ile port meşgul mü kontrol eder
- Meşgulse QMessageBox uyarısı gösterir

**Electron'da kısmen var:**
- net.Socket connect denemesi var ✓
- Ama start_all_servers içinde çağrılmıyor

**Çözüm:** `_startServer()` içinde çağrıyı garanti et

---

## 🟢 MEDIUM — Config, DB, and Model Management

### 8. Database Loading (Load Database Button)
**Python'da (_load_database):**
- QFileDialog ile .db dosyası seçtirir
- Eski openwebui.db'yi .backup olarak yedekler
- Yeni db'yi kopyalar
- OpenWebUI'yi 2s sonra yeniden başlatır

**Electron'da eksik:**
- Bu özellik hiç yok

**Çözüm:** IPC handler ekle + renderer'dan tetikle

---

### 9. Atomic Config Write (Bug #6)
**Python'da (ConfigManager._save):**
- Önce temp dosyaya yazar
- f.flush() + os.fsync() ile diske garanti
- os.replace() ile atomik taşıma

**Electron'da kısmen var:**
- fs.writeFileSync + renameSync var ✓
- fsync equivalent (fs.fdatasyncSync) YOK

**Çözüm:** fsyncSync ekle

---

### 10. Model Download with SHA256 Verification (Bug #5)
**Python'da (DownloadThread):**
- hf_hub_download ile indirir
- model_urls.json'dan expected hash alır
- SHA256 hesapla ve karşılaştırır
- Disk dolunca .part dosyası temizler

**Electron'da kısmen var:**
- node-fetch streaming var ✓
- SHA256 verification YOK
- Partial file cleanup YOK

**Çözüm:** downloadModel() fonksiyonuna ekle

---

### 11. Auto-generated Local INI (system_detection.py)
**Python'da (_create_local_ini):**
- INI dosyasındaki URL'leri yerel relative path'lere çevirir
- `models/foldername/filename.gguf` formatında
- models_gpu*.ini olarak kaydeder

**Electron'da kısmen var:**
- ipcMain handle var ✓
- Ama parseINI/stringifyINI tam değil

**Çözüm:** INI parser'ı düzelt

---

### 12. MCP Advisor Integration (picoding.py)
**Python'da (_save_advisor_config):**
- advisor_config.json'a kaydet
- mcp_web_reader.py dosyasını güncelle (ADVISOR_URL, ADVISOR_KEY, ADVISOR_MODEL replace)

**Electron'da eksik:**
- Config kaydetme var ama file update YOK

**Çözüm:** mcp_web_reader.py güncelleme ekle

---

## 📋 Entegrasyon Stratejisi

### Phase 1: Server Manager Genişletme (server-manager.js)
- SearXNG: settings.yml + PYTHONPATH
- OpenWebUI: secret key + env vars + delayed import
- LlamaCPP: Dynamic BAT + ctx-size
- Vane: .next cleanup + npm run dev

### Phase 2: Process Management (server-manager.js)
- Process tree kill (leaf-first)
- Port-based emergency kill
- Health check auto-restart

### Phase 3: IPC Handlers (main.js)
- Database load handler
- Atomic config write
- SHA256 model verify
- MCP advisor file update

### Phase 4: Model Manager (models.js)
- SHA256 verification
- Partial file cleanup
- Local INI generation

### Phase 5: App-wide Features
- Language switch real-time update
- Config persistence improvements
