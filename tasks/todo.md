# Task: Strata entegrasyonu v2 (port 1235 gateway + Electron UI)

## Steps
- [ ] 1. Upstream yetenek dogrula: serve/server.py bayraklari (--idle-unload?), /unload, sampling config, --calibrate
- [x] 2. Strata katmani: local/gateway.py, local/models.json, local/checkargs.py, MULTI-MODEL.bat, GUNCELLE.bat (+ git exclude)
- [x] 3. Dis repo: .gitignore + strata-layer/ izlenen ana kopyalar
- [ ] 4. main.js: serverStates.strata(1235), handler'lar status/setup/start/stop/update/calibrate/config(yedekli)
- [ ] 5. preload.js kanallari
- [ ] 6. UI Sunucular: Strata karti (context, PC/LAN+api-key, port, Calibrate)
- [ ] 7. UI System Detection: RAM>48GB -> model indirme secimi; modeller models/ klasorune
- [ ] 8. Dogrulama + rapor tablosu (spec formati)

## Diagram
[client] -> [gateway.py :1235 /v1, 2 model adi]
   |-- ark0 serve/server.py :1236 (strata-general.json)  motor imzasi exe+args+cwd AYNI olmali
   |-- ark1 serve/server.py :1237 (strata-coder.json)    fark SADECE sampling blogu
   |-- swap: yuklenirken rakibe POST /unload; uretimdeyse 503
   |-- idle_unload 600s; Windows job object

## Spec notlari
- .bat SAF ASCII+CRLF, yorumlar Ingilizce
- Config degisikligi öncesi yedek: .tmp/backups/manual-<TIME>/
- Kalibre parametreler kopyalanmaz; START-HERE.bat --calibrate ile PC'de uretilir; coder args general ile birebir esit (sampling hariç)
- İzlenen: local/*, MULTI-MODEL.bat, GUNCELLE.bat | İzlenmeyen: strata-*.json engine/ packs/ mtp/ data/ *.log *.dmp .rocm-win/ .strata-mcp/ .ccache/
