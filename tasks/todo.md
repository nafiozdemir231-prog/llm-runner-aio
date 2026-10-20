# Task: Strata q36 entegrasyonu — Qwen3.6-35B-A3B ailesi uygulamada [2026-10-13]

## Steps
- [x] 1. Strata guncellik kontrolu (YAPILDI: v0.1.44.1, 0/0)
- [x] 2. Mevcut setup/kalibrasyon akisini oku (electron/strata.js + renderer Strata paneli)
- [x] 3. setup.py q36 CLI kullanimini dogrula (non-interaktif boyut/secim bayraklari)
- [x] 4. strata.js: CHOICES aile-duyarli hale getir + q36 kurulum/gate akisi (qwen3.6-35b-a3b name, vision:False etiketi)
- [x] 5. models.json semasi: ucuncu kapı ornegi + mergeGateConfigs uyumu
- [x] 6. Renderer UI: aile secimi + q36 boyut kartlari (RAM esikleri 32/44/52)
- [x] 7. Dogrulama: node --check, sentetik setup cagrisi (.tmp), katman testleri
- [x] 8. Kayitlar + commit + push

## Notlar
- q36 hibrit mod: sabit VRAM min yok; NVIDIA/AMD zorunlu (Intel Arc reddeder); vision henüz BAGLI DEGIL (setup.py "vision": False)
- RAM esikleri: UD-Q4_K_XL 32 / UD-Q6_K_XL 44 / Q8_0 52 GB (altina setup sorar)
- MTP dosya icinde (mtp:2) -> ayri draft indirme yok

# Task: q36 geri alindi — Strata yalniz Qwen3.8-Flash-Next [2026-10-15]

## Steps
- [x] 1. strata.js: FAMILY_CHOICES/GATE_NAMES/isQwen36Config/families/eligibleQwen36/--family/gate-rename/calibrate-skip/context-guard kaldirildi
- [x] 2. renderer.js: aile select wiring + q36 toggle'lari + family param'lar kaldirildi (indirme yuzde cubugu KORUNDU)
- [x] 3. index.html: aile select + q36 notu kaldirildi; dil dosyalari: 2 anahtar silindi
- [x] 4. PC temizligi: models/qwen36-UD-Q4_K_XL (22G) + packs + Strata q36 config/log'lari silindi; models.json adlari Flash-Next default
- [x] 5. Dogrulama: node --check x4 PASS; headless DOM: boyut listesi flash, buton/panel Flash esigine tabii, q36 izleri yok PASS
- [x] 6. Kayit + commit + push

# Task: Strata upstream guncellemesi (v0.1.44.1 -> v0.2.0-beta) [2026-10-20]

## Steps
- [x] 1. Upstream kontrolu: fetch, yeni tag'ler (v0.1.45, v0.2.0-beta), 1483 dosya degisiklik ozeti
- [x] 2. Katman uyumlulugu: serve/server.py hâlâ ayni yolda/argümanlarda; bizim kullandigimiz bayraklar (max-context/pack/conversation-cache-*/pool-workers/adapt-*/pcie-frac/spec-min-p) upstream'de mevcut; --update bayragi duruyor
- [x] 3. Strata/ git pull --ff-only -> HEAD e88ee39d (v0.2.0-beta-12); katman dosyalari (local/, MULTI-MODEL.bat, GUNCELLE.bat) korundu
- [x] 4. Dogrulama: setup.py --update calisti (model kurulu olmadigini soyluyor, soru sormuyor), py_compile server/setup/gateway/checkargs PASS, checkargs.py PASS
- [x] 5. electron/strata.js CHOICES upstream MODELS ile hizalandi (IQ3_XXS 56->60 RAM, IQ3_S 64->62) + MIN_ENGINE 0.1.45 notu
- [x] 6. Kayit + commit + push

## Notlar
- Engine: Strata/engine 0.1.44.1 < setup.py MIN_ENGINE 0.1.45. Bu PC'de model kurulu olmadigi icin --update engine indirmiyor; model kurulu PC'lerde Update butonu engine'i otomatik yeniler (model dosyalarina dokunmaz, soru sormaz).
- Upstream yeni aileler: --family unsloth (UD-IQ4_XS 93.7/48, UD-Q4_K_XL 111.3/48), gyro (Gyro-S 58.5 dl / 27.6 GB toplam bellek!, Gyro-M 92.0/35.0), nvfp4, swift; qwen36 artik parallel + vision destekli (engine 0.1.45). Uygulamada bilerek sadece qwen+coder sunuluyor.
