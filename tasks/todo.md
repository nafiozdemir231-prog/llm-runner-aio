# Task: PyQt6 → Electron Entegrasyon — Tüm Özellikler

## Phase 1: Server Manager Genişletme ✅ TAMAMLANDI
- [x] SearXNG: settings.yml güncelleme + PYTHONPATH injection
- [x] OpenWebUI: secret key + 15+ env vars + delayed import_functions.py
- [x] LlamaCPP: Dinamik BAT oluşturma + ctx-size desteği
- [x] Vane: .next cleanup + npm run dev pattern + SEARXNG_API_URL
- [x] Process tree kill (leaf-first termination)
- [x] Port bazlı emergency kill
- [x] Health check auto-restart

## Phase 2: IPC Handlers (electron/main.js)
- [ ] Database load handler (OpenWebUI DB swap)
- [ ] Atomic config write (fsyncSync)
- [ ] SHA256 model verify
- [ ] MCP advisor file update (mcp_web_reader.py)
- [ ] Local INI generation fix

## Phase 3: Model Manager (src/tabs/models.js)
- [ ] SHA256 verification during download
- [ ] Partial file (.part) cleanup on disk full
- [ ] model_urls.json hash lookup

## Phase 4: App-wide Features
- [ ] Language switch real-time UI update
- [ ] Config persistence improvements
- [ ] System tray status updates

## Notes
- Phase 1 tamamlandı — server-manager.js PyQt6 worker'larının tüm özelliklerini içeriyor
- Her phase sonunda tasks/state.md ve change.md güncellenecek
