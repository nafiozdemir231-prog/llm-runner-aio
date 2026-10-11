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
- [x] 10. Strata upstream fb58e0d (v0.1.41) ff-only güncelleme + "Paralel istekler" config seçeneği (parallel→--batch, 1=off/2-8; iki kapıda aynı yazılır, değişimde gateway otomatik restart; label_parallel+opt_parallel_off 8 dil)
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

# Task: Arayüz göçü — tab → sidebar kontrol paneli (kademeli) [2026-10-11]

## Steps
- [x] 1. Faz 1 — Sidebar iskeleti: toolbar'daki tab-bar kaldirilir; #main-container icine sol aside (ayni .tab-btn/data-tab elementleri -> renderer.js DEGISMEZ) + CSS flex duzeni. Geri kalan her sey ayni.
- [x] 2. Faz 2 — Sunucular perdesi: launcher gorunumu (Start/Stop All + baslangic seçenekleri karti) + sidebar alt menuyu ile sunucu bazli filtreleme; Strata kartina durum led'i.
- [x] 3. Faz 3 — Ayarlar modalini sidebar gorunumune tasimayi degerlendirme (modal kalabilir; once Faz 2 otursun).
- [x] 4. Faz 4 — Görsel stil gecisi: mock04 kart/details estetik (🔧 Yapılandırmayı Göster/Gizle toggle, 📋 Günlükler) mevcut id + data-i18n yapilarina dokanmadan.
- [ ] 5. Kabul: hedef PC'de birebir kontrol; geri alma icin her faz ayri commit.

## Diagram
[toolbar (drag+win controls)] 
   +----------------------------------------------+
   | aside sidebar      | #tabs-content           |
   |  .tab-btn data-tab |   tab-home / system /   |
   |  home,servers,     |   servers / picoding /  |
   |  models,picoding   |   models (PANELLER AYNI)|
   +----------------------------------------------+

## Notlar
- renderer.js switchTab(.tab-btn/.data-tab/#tab-<name>) aynen calisir -> Faz 1 renderer degisikligi gerektirmez
- Eski task "Strata v3" madde 9 (hedef PC elle kabul) hala bekliyor; bu task onu engellemez

# Task: Strata context bildirimi — pi'da hep 128K gorunmesi (HAT-42) [2026-10-12]

## Steps
- [x] 1. Kok neden: gateway /v1/models meta'yi yalniz ark CALISKENSE backend'den aliyor; lazy-start'ta meta bos → extension varsayilan 128000
- [x] 2. ctx_from_cfg() eklendi: cfg.args icinde --max-context (Strata) / --ctx-size ara
- [x] 3. do_GET models bloguna baglandi: meta.n_ctx + context_length setdefault (canli backend gercek ctx one cikar)
- [x] 4. Uctan uca test: .tmp/gwtest sahte gateway, ark UNLOADED → /v1/models meta.n_ctx=131072 PASS
