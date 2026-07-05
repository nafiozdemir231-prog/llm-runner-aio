# Lessons Learned

## UI Design System

### JSON File Corruption
**Root Cause:** Manual edits to JSON files (especially multilingual ones) can introduce syntax errors like missing commas at end of values. The `desc_vane` field in multiple language files had missing commas before `pi_instructions`.

**Verified Fix:** Always validate JSON files after edits with `python -c "import json; json.load(open('file.json'))"`. Check for missing commas at line boundaries, especially after long multilingual strings.

### QSS Transition Support
**Root Cause:** Qt's QSS supports CSS `transition` property for some properties (background-color, color, border-color) but not all (transform, opacity). Using unsupported properties silently fails.

**Verified Fix:** Only use supported transition properties: background-color, color, border-color. For transform effects, use `padding-top`/`padding-bottom` as workaround for pressed state.

### Inline Styles vs Global Theme
**Root Cause:** Inline styles in individual files (`servers.py`, `system_detection.py`) override global theme from `app.py`. When global theme changes, inline styles must be updated separately.

**Verified Fix:** Use consistent color values across all files. Document the color palette in `tasks/project.md` so all developers know the canonical values.

## SearXNG (Previous Session)

### Hardcoded Paths in settings.yml
**Root Cause:** SearXNG's `settings.yml` contained hardcoded paths that don't exist on target machines, causing `ValueError: Invalid settings.yml`.

**Verified Fix:** Set `static_path` and `templates_path` to empty strings in `settings.yml`. SearXNG dynamically resolves paths from `searx_dir` when these are empty.

## Vane AI (Previous Session)

### npm Execution on Windows
**Root Cause:** `shutil.which("npm")` returns `npm.CMD` (uppercase extension). `subprocess.Popen` with `shell=False` cannot execute `.cmd` files directly on Windows.

**Verified Fix:** Use `shell=True` when command is `npm`, `npx`, or ends with `.bat`/`.cmd`.

### Next.js Dev Mode HMR
**Root Cause:** Next.js dev mode blocks cross-origin HMR requests by default, causing page to hang when accessed via `127.0.0.1`.

**Verified Fix:** Add `allowedDevOrigins: ['127.0.0.1', 'localhost']` to `next.config.mjs`

## PyQt6 & Qt Signals (QA Security Report Session)

### QComboBox.valueChanged AttributeError
**Root Cause:** PyQt6'da QComboBox'nin `valueChanged` sinyali **yok**! Bu sinyal sadece QSpinBox ve QSlider gibi numeric widget'larda mevcut.

**Verified Fix:** 
```python
# ❌ HATALI (PyQt6'da yok!)
self.bind_combo.valueChanged.connect(handler)

# ✅ DOĞRU - currentIndexChanged kullan
self.bind_combo.currentIndexChanged.connect(lambda i: self._config.set("bind", str(self.bind_combo.itemData(i))))

# ✅ DOĞRU - currentTextChanged kullan
self.bind_combo.currentTextChanged.connect(lambda text: self._config.set("bind", text))
```

**Not:** QComboBox için doğru sinyaller:
- `currentIndexChanged(int)` — Seçim değiştiğinde index verir
- `currentTextChanged(str)` — Seçim değiştiğinde metin verir
- `activated(int)` — Kullanıcı seçim yaptığında index verir
- `valueChanged` — **YOK!** Sadece QSpinBox/QSlider var!

### Windows Config Save Error [WinError 183]
**Root Cause:** Windows'ta `Path.rename()` hedef dosya varsa `OSError: WinError 183` verir. Linux/macOS'ta overwrite yapar ama Windows farklı davranır.

**Verified Fix:**
```python
import os
from pathlib import Path

temp_path = CONFIG_PATH.with_suffix(".json.tmp")
with open(temp_path, "w") as f:
    json.dump(data, f)
    f.flush()  # Python buffer'ı temizle
    os.fsync(f.fileno())  # Fiziksel diske yazmayı garanti et

# ✅ Windows/Linux uyumlu - overwrite yapar
os.replace(temp_path, CONFIG_PATH)

# ❌ Windows'ta hata verir
temp_path.rename(CONFIG_PATH)
```

**Detay:** `os.replace()` cross-platform overwrite yapar. `fsync()` kritik çünkü uygulama çökerse config bozulmamalı.

### Double Port Check Logic Error
**Root Cause:** Her `_start_*` metodunda **çift port kontrolü** vardı — birinde return yapıp çıkması gerekirken ikinci kontrol de devredeydi. Bu mantık hatası nedeniyle vane sunucusu başlatılamıyordu.

**Verified Fix:** Tek kontrol noktası bırak, çift kontrol kaldır:
```python
if worker is running:
    → "Zaten Çalışıyor" bilgisi
elif port in use:
    → "Port Kullanımda!" uyarısı
else:
    → Normal başlatma akışı
```

### Cleanup Sonrası Worker=None Durumu
**Root Cause:** Uygulama açılışında orphan process temizlendiğinde `finished_signal` tetikleniyor → `_server_finished()` çağrılıyor → `self._worker = None`. Sonra kullanıcı Start'a basınca worker None oluyor, "Already Running" mesajı yanlış gösteriliyor.

**Verified Fix:** Worker None ise port kontrolünü devreye sok:
```python
if not self._worker or self._worker.get_status() != "running":
    if self.is_port_in_use(port):
        → "Port Kullanımda!" uyarısı
    else:
        → Temiz başlatma
```

## Atomic Write Pattern (Config Güvenliği)

### File Handle Kapatılmadan Önce Replace Yapmak
**Root Cause:** Context manager (`with`) kapanmadan önce `os.replace()` çağrılırsa dosya handle hala açık olabilir.

**Verified Fix:**
```python
# ✅ DOĞRU - with bloğu içinde flush + fsync sonra exit
with open(temp_path, "w") as f:
    json.dump(data, f)
    f.flush()
    os.fsync(f.fileno())
# with bitti, dosya kapandı
os.replace(temp_path, CONFIG_PATH)  # Şimdi güvenli
```

## Method Signature Consistency

### stop_process TypeError in Worker Classes
**Root Cause:** Base class `ServerWorker.stop_process(self, timeout=10)` takes a `timeout` parameter, but subclasses like `OpenWebUIWorker` and `VaneWorker` defined their own `stop_process(self)` without it. When `stop_all_servers()` calls `worker.stop_process(timeout=10)` on all workers uniformly, subclasses throw `TypeError: stop_process() got an unexpected keyword argument 'timeout'`.

**Verified Fix:** Ensure ALL subclasses match the base method signature:
```python
class ServerWorker(QThread):
    def stop_process(self, timeout=10):  # ← Base class has timeout
        ...

class OpenWebUIWorker(ServerWorker):
    def stop_process(self, timeout=10):  # ← MUST match base!
        ...

class VaneWorker(ServerWorker):
    def stop_process(self, timeout=10):  # ← MUST match base!
        ...
```

**Rule:** When calling methods polymorphically (e.g., iterating over all workers), every subclass must accept the same parameters as the base class.

## Widget Instance Attributes for Dynamic Updates

### QLabel Not Updating on Language Change
**Root Cause:** Labels created inline as local variables (`QLabel(text)`) cannot be updated later because there's no reference to them. Only QComboBox items were being refreshed, not the "Bind to:" labels next to them.

**Verified Fix:** Always store widgets as instance attributes when they need dynamic updates:
```python
# ❌ KÖTÜ - Local değişken, güncellenemez
bind_layout.addWidget(QLabel(self._lang.get("label_bind", "Bind to") + ":"))

# ✅ İYİ - Instance attribute, setText() ile güncellenebilir
self.searxng_bind_label = QLabel(self._lang.get("label_bind", "Bind to") + ":")
bind_layout.addWidget(self.searxng_bind_label)

# Dil değiştiğinde güncelle
self.searxng_bind_label.setText(self._lang.get("label_bind", "Bind to") + ":")
```

**Rule:** Any widget that needs runtime text updates (labels, titles, status messages) should be stored as `self.<name>` attribute.

## Multilingual JSON Updates

### Globalization Checklist
**Root Cause:** Yeni çeviri anahtarı eklediğimizde 8 dil dosyasının hepsini güncellemeyi unutmak kolay.

**Verified Fix:**
```bash
# Tüm JSON dosyalarını valid et
for lang in en tr de es fr pt zh ja; do
    python -m json.tool "launcher/lang/$lang.json" > /dev/null && echo "✅ $lang"
done
```

**Kural:** Her yeni string anahtarı için:
1. en.json'da ekle
2. tr.json'da ekle
3. Kalan 6 dili aynı key ile güncelle
4. JSON validity kontrolü yap

## Taşınabilir Uygulama Mimarisi (Portable App Architecture)

### Dinamik Path Yönetimi
**Root Cause:** Uygulamanın her klasörde sorunsuz çalışması gerekiyordu (`D:/Programlar/`, `D:/OpenCode/`, `C:/Users/...` vb.). Hardcoded path'ler dağıtımda çökme yaratıyordu.

**Verified Fix:**
```python
# ✅ app.py — Dinamik ROOT tespiti
ROOT = Path(__file__).parent.parent  # launcher/'in bir üstü
CONFIG_PATH = ROOT / "launcher" / "config.json"
LANG_DIR = ROOT / "launcher" / "lang"
```

Bu yaklaşım uygulamanın **herhangi bir dizine** kopyalanabilmesini sağlar:
- `Path(__file__)` → Script'in bulunduğu dosyayı verir
- `.parent.parent` → `launcher/app.py` → iki kez üst klasöre çıkar → proje kökünü bulur

### Batch Dosyasında %~dp0 Kullanımı
**Root Cause:** `.bat` dosyalarında sabit yol (`cd /d "D:\OpenCode\LLM-Runner-AIO"`) kullanılıyordu. Dağıtımda bu yol bozuluyordu.

**Verified Fix:**
```batch
REM ❌ HATALI — Sabit yol, taşınmaz!
cd /d "D:\OpenCode\LLM-Runner-AIO"

REM ✅ DOĞRU — %~dp0: batch dosyasının bulunduğu dizin
cd /d "%~dp0"
```

`%~dp0` batch script'inin **kendisinin bulunduğu dizini** temsil eder. Script `C:/Test/LLM-Runner-AIO/start_llm_runner.bat` konumunda olursa `%~dp0` otomatik olarak `C:/Test/LLM-Runner-AIO/` olur.

### SearXNG Launcher Düzeltmesi
**Önce:**
```batch
"D:/OpenCode/Llm-Runner-aio/searxng/searx-pyenv/Scripts/python.exe" app.py
```
**Sonra:**
```batch
REM Ana uygulama venv'sini kullan (taşınır)
"..\\venv\\Scripts\\python.exe" -m searx.webapp
```

### Dağıtım Kontrol Listesi
Uygulamayı ZIP olarak paketlemeden önce şunları doğrula:

- [ ] Tüm `.bat` dosyalarında `cd /d "%~dp0"` kullanılıyor
- [ ] Hiçbir `.py` dosyasında hardcoded `D:\` veya `C:\` yolu yok
- [ ] `Path(__file__)` pattern'i tüm yol hesaplamalarında kullanılıyor
- [ ] `venv/`, `__pycache__/`, `node_modules/`, `models/`, `.env` hariç tutuluyor
- [ ] README.md ve kurulum talimatları mevcut

### Proje Yapısı (Dağıtım İçin)
```
LLM-Runner-AIO/
├── launcher/              # Ana uygulama (Python)
│   ├── main.py            # Giriş noktası (Path(__file__).parent.parent)
│   ├── app.py             # Config, dil, tema yöneticisi
│   ├── tabs/              # Sekmeler (servers, models, picoding)
│   ├── ui/                # Arayüz bileşenleri
│   └── lang/              # 8 dil dosyası
├── venv/                  # Python sanal ortamı (pip install sonrası)
├── openwebui/             # OpenWebUI frontend/backend
├── searxng/               # SearXNG metaserch motoru
├── Vane/                  # Vane AI Next.js arayüzü
├── llama.cpp-cuda13+vulkan/  # llama.cpp binary'leri
├── models/                # GGUF modelleri (kullanıcı ekleyecek)
├── assets/                # İkonlar ve görseller
├── start_llm_runner.bat   # Ana başlatma (%~dp0 ile taşınır)
├── run.bat                # Venv python ile başlatma (%~dp0)
├── requirements.txt       # Python bağımlılıkları
└── README.md              # Kurulum talimatları
```

### Test Senaryosu
Dağıtımdan önce uygulamayı farklı yollarda test et:
```powershell
# Test 1: Program Files'a kopyala
Copy-Item "LLM-Runner-AIO" -Destination "C:\Program Files\LLM-Runner-AIO" -Recurse
Start-Process "C:\Program Files\LLM-Runner-AIO\start_llm_runner.bat"

# Test 2: Masaüstüne kopyala
Copy-Item "LLM-Runner-AIO" -Destination "$HOME\Desktop\LLM-Runner-AIO" -Recurse
Start-Process "$HOME\Desktop\LLM-Runner-AIO\start_llm_runner.bat"

# Test 3: USB belleğe kopyala
Copy-Item "LLM-Runner-AIO" -Destination "E:\LLM-Runner-AIO" -Recurse
Start-Process "E:\LLM-Runner-AIO\start_llm_runner.bat"
```

Her senaryo **sorunsuz** başlamalıdır. Eğer hata alırsan, `logs/app.log` dosyasını kontrol et.
