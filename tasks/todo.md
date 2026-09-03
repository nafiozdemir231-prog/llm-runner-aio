# Task: PiCoding SDK bump (0.79→0.84) + picoding-update'e npm install adımı

## Steps
- [x] 1. picoding/package.json → @earendil-works/pi-coding-agent ^0.84.4
- [x] 2. electron/main.js: picoding-update akışına git pull sonrası npm install adımı ekle
- [x] 3. Bu makinede picoding/ içinde npm install çalıştır, pi-ai sürümünü doğrula
- [x] 4. Doğrulama: @earendil-works/pi-ai/compat adapter konumundan resolve olmalı + node --check + CRLF saflık
- [ ] 5. Dokümanlar (change.md, README gerekirse) + commit

## Notes
- Kök neden: yeni pi-mcp-adapter `@earendil-works/pi-ai/compat` import ediyor; ./compat export'u sadece pi-ai ≥0.81.0'da var; repo 0.79.1 pinliyordu (^0.79.1).
- node_modules git'te DEĞİL — her PC kendi npm install'ını koşar; bu yüzden update akışına npm install eklendi.
- package-lock.json tracked ise commit'e dahil et.
- CRLF hassas: main.js patch'i snippet/script ile, benzersizlik assert'li.
