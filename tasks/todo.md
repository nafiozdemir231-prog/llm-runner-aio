# Task: Strata entegrasyonu v2 (port 1235 gateway + Electron UI)

## Steps
- [x] 1. Upstream yetenek dogrula: serve/server.py bayraklari (--idle-unload?), /unload, sampling config, --calibrate
- [x] 2. Strata katmani: local/gateway.py, local/models.json, local/checkargs.py, MULTI-MODEL.bat, GUNCELLE.bat (+ git exclude)
- [x] 3. Dis repo: .gitignore + strata-layer/ izlenen ana kopyalar
- [x] 4. main.js: serverStates.strata(1235), handler'lar status/setup/start/stop/update/calibrate/config(yedekli)
- [x] 5. preload.js kanallari
- [x] 6. UI Sunucular: Strata karti (context, PC/LAN+api-key, port, Calibrate)
- [x] 7. UI System Detection: RAM>48GB -> model indirme secimi; modeller models/ klasorune
- [x] 8. Dogrulama + rapor tablosu (spec formati)

## Diagram
[client] -> [gateway.py :1235 /v1, 2 model adi]
   |-- ark0 serve/server.py :1236 (strata-general.json)  motor imzasi exe+args+cwd AYNI olmali
   |-- ark1 serve/server.py :1237 (strata-coder.json)    fark SADECE sampling blogu
   |-- swap: yuklenirken rakibe POST /unload; uretimdeyse 503
   |-- idle_unload 600s; Windows job object

# Task: Strata v3 iyileştirmeleri (2026-10-06/07)

## Steps
- [x] 1. Open WebUI otomatik bağlantı: openwebui.db config tablosuna 1235 ekleme butonu (DB kalıcı, update-safe) + idempotent test
- [x] 2. Auto-start: cb-auto-strata (varsayılan açık) → Windows→uygulama→gateway zinciri; configured guardu
- [x] 3. Vision seçeneği (no/gpu/cpu): install bölümü + Sunucular config paneli; değişimde otomatik re-setup
- [x] 4. Kalibrasyon UX: --yes (menü takılmaz), 45 sn kalp atışı log, buton "⏳ Calibrating..." durumu
- [x] 5. API key config alanı + gateway ?api_key= query auth (Open in Browser hatası çözüldü; canlı test 401/200)
- [x] 6. Update sağlamlaştırma: fetch + merge-base → ff-only veya reset --hard (upstream rebase dayanıklılığı); öncesi config yedek
- [x] 7. Strata upstream güncelleme: 6f32ec0 → 82f46a8; uyumluluk testleri yeniden geçti (--check, mock chat, injection probe)
- [x] 8. i18n: Strata kartı/install/settings 8 dilde (~17 anahtar); dinamik metinler İngilizce kalıba çekildi
- [ ] 9. HEDEF PC elle kabul: Update → Start → Open in Browser (key'li) → OW sohbetleri → idle unload gözlemi → auto-start doğrulama

## Notlar
- STRATA_DEV=1: RAM eşiği altındaki test makinelerinde kartı görünür kılar (varsayılan davranış değişmez)
- Upstream MODELS tablosunda yeni boyutlar: UD-IQ4_XS (93.7 GB, normal), UD-Q4_K_XL (111 GB, deneysel) — CHOICES'e eklemek opsiyonel
- Yeni sürümde /v1/models yanıtları meta/architecture alanları içeriyor; OW uyumlu

---

## Spec notlari
- .bat SAF ASCII+CRLF, yorumlar Ingilizce
- Config degisikligi öncesi yedek: .tmp/backups/manual-<TIME>/
- Kalibre parametreler kopyalanmaz; START-HERE.bat --calibrate ile PC'de uretilir; coder args general ile birebir esit (sampling hariç)
- İzlenen: local/*, MULTI-MODEL.bat, GUNCELLE.bat | İzlenmeyen: strata-*.json engine/ packs/ mtp/ data/ *.log *.dmp .rocm-win/ .strata-mcp/ .ccache/
