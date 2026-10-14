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
