# Task: Wan2GP Update butonu + Auto-start + aihublocal sekmesi (gömülü site)

## Steps
- [x] 1. İnceleme: tab/CSS/i18n/notification desenleri, site header'ları (iframe uygunluğu)
- [x] 2. index.html: yeni "aihublocal" sekme butonu + #tab-home paneli (iframe) + CSP frame-src + Wan2GP Update butonu + cb-auto-wan2gp
- [x] 3. style.css: #tab-home iframe tam ekran stilleri
- [x] 4. main.js: ipcMain.handle('wan2gp-update') → git pull --ff-only (streaming)
- [x] 5. preload.js: wan2gp.update()
- [x] 6. renderer.js: switchTab lazy-load, runWan2gpUpdate(), auto-start'a wan2gp (map/port zinciri/guard/restore/save/cbs/labels)
- [x] 7. i18n ×8: tab_home, section_wan2gp
- [x] 8. Doğrulama: syntax, JSON×8, DOM ID, CRLF, div dengesi
- [x] 9. Dokümantasyon + commit

## Kararlar
- aihublocal sekmesi: ilk sırada; default aktif sekme DEĞİŞMEDİ (system)
- iframe lazy: ilk açılışta src set edilir, sonra saklı kalır; pasifte display:none
- Site X-Frame-Options göndermiyor → iframe güvenli (frame-src eklendi)
- Update butonu: yalnızca git pull (venv/pip'e dokunmaz); cloned değilse veya çalışıyorsa disabled
- Auto-start: cb-auto-wan2gp; kurulumu yoksa sessizce atlanır; Start All hâlâ hariç
- Port zinciri düzeltmesi: wan2gp→7860 (aksi halde 1234 olurdu — HATA riski)
- serverLabels diziye bölüm ekleme zorunlu (index-based mapping kırılır)

## Notes
- Progress kanalı: update de 'wan2gp-setup-log' kanalını yeniden kullanıyor (log aynı panel)
- Commit: tek commit; push YAPMA
