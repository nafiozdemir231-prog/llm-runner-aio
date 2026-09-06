# Task: llama.cpp CPU Threads — "hep 10" fix'i + Detect Hardware ile otomatik doldurma

## Steps
- [x] 1. Teşhis: 3 başlatma yolu (manuel/auto/Start All) + restore eksikliği
- [x] 2. electron/main.js: detectHardware → cpuThreads (os.cpus().length)
- [x] 3. src/renderer.js: restore'a llamacpp parametreleri ekle
- [x] 4. src/renderer.js: buildLlamacppOptions() helper + auto-start & Start All'da kullan
- [x] 5. src/renderer.js: detectHardware → llamacpp-threads = cpuThreads - 2 (config'e de yaz)
- [x] 6. Doğrulama: node --check ×2, CRLF saflık ×2, helper fonksiyon testi (DOM stub)
- [x] 7. Dokümanlar + commit

## Notes
- Kök neden: (a) auto-start ve Start All yolunda threads/iniPreset gönderilmiyor → main'de `|| 10` fallback; (b) restorePreviousSelection port/host'u geri yüklüyor ama llamacpp_threads vb. geri yüklemiyor → her açılışta HTML default 10.
- Manuel Start butonu zaten doğru çalışıyor (DOM okuyor).
- ID'ler: ini-select, llamacpp-threads(10), llamacpp-parallel(1), llamacpp-sleep-idle(1000), llamacpp-max-model(1)
- main.js option anahtarları: threads, parallel, sleepIdle, maxModel, iniPreset
- Kural: 22 logical core → 20 threads (max(1, n-2)); config.llamacpp_threads anında persist edilir.
