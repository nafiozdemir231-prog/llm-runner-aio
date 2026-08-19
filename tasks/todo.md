# Task: Denetim Bulgularinin Duzeltilmesi

## Steps
- [x] 1. Renderer duzeltmeleri (HAT-02,04,11,17,18,20,23,25,28,32,33,34,35) — TAMAM
- [x] 2. Main process duzeltmeleri (HAT-01,03,06,07,08-timeout/resume/sha256,24) — TAMAM
- [x] 3. Preload duzeltmeleri (HAT-03-expose,09,13,14) — TAMAM
- [x] 4. Indirme concurrency cap (HAT-08) — renderer — ADIM 1'DE BIRLIKTE YAPILDI
- [x] 5. .gitignore duzeltme (HAT-05,26) — TAMAM
- [x] 6. INI load-mode duplikasyonlari (HAT-15) — TAMAM (4 INI'de 11 satir)
- [x] 7. package.json / gereksiz bagimliliklar (HAT-12) — TAMAM (8→2 paket)
- [x] 8. Legacy kod arsevine tasi (HAT-10) — TAMAM (13 dosya legacy/frontend-pyqt6-port/)
- [~] 9. requirements.txt / bat dosyalari (HAT-16) — KULLANICI EMRIYLE ATLANDI
- [x] 10. rebuild.js (HAT-19) — TAMAM (tam yeniden yazim: venv python, execSync string, olu bat/migrate bloklari kaldirildi)
- [x] 11. CSS + renderer ek duzeltmeler (HAT-22 cache, HAT-29 .hidden dup, HAT-35 pre-wrap) — TAMAM
- [ ] 12. Gereksiz dosyalar (HAT-27)
- [ ] 13. i18n eksik anahtarlari — degerlendirme (HAT-29)
- [ ] 14. Final dogrulama (syntax + smoke)
- [ ] 15. change.md + hatalar.md guncelleme

## Notlar
- Adim 1: 30/30 renderer degisikligi uygulandi, syntax OK, CRLF korundu.
- 0.0.0.0 eslesmelerinden 5'i bilincli uyumluluk harlamasi (`host==='0.0.0.0'? '127.0.0.1'`) — kaldirilmadi.
- startAllServers() icindeki host/port fallback de adim 1 sonu duzeltildi.
- formatBytes(downloaded) satir 1774 parametreden geliyor — hata degil.
- Adim 2: main.js 8/8 patch (config mkdir, guvenli orphan cleanup, single-instance + kosullu autostart,
  db-import-functions handler, downloadModel yeniden yazi: timeout/retry/resume/.part).
  Patch sirasinda `\d` regex'i template-escape nedeniyle `d` olmustu; fix_regex.js ile duzeltildi.
- Adim 3: preload.js 9/9 patch (shell import, events beyaz liste, getStatus/system/app latent API'ler
  kaldirildi, onProgress tek API + off(), db.importFunctions eklendi, dev ham IPC kaldirildi).
  Not: main.js 'server-status' kanali hic yoktu -> getStatus calismiyordu (dogru olarak kaldirildi).
- Adim 10: rebuild.js tamamen yeniden yazildi — VENV_PYTHON kullanimi, run(cmd) string tabanli,
  create_shortcut.py artik electron/ dizinindendir, model_urls migrasyonu ve bat uretimi (olu) kaldirildi.
- Adim 11: HAT-22 — autoDetectAndSaveHardware artik 24s TTL'li localStorage cache kullanir;
  manuel Detect her zaman taze tespit + cache yeniler. HAT-29 — ikinci .hidden kurali silindi.
  HAT-35 — #picoding-path-display'a white-space:pre-wrap + word-break eklendi.
- Not: hatalar.md numaralari bu todo'nunkilerden farkli (todo kendi siralamasini kullanir).
- HAT-34 (debug log gurultusu): kozmetik, dusuk oncelik — bilinçli olarak birakildi.
