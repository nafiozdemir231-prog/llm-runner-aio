current_step: 2
status: in_progress
verdict: PASS
last_action: PyQt6 → Electron entegrasyonu Phase 1 + Phase 2 tamamlandı
next_action: Phase 3 - Model Manager SHA256 verification + partial file cleanup

## Phase 1: Server Manager Genişletme ✅ TAMAMLANDI
### src/workers/server-manager.js
- SearXNGWorker: settings.yml güncelleme + PYTHONPATH injection
- OpenWebUIWorker: WEBUI_SECRET_KEY + 15+ env vars + delayed import_functions.py (15sn)
- LlamaCppWorker: Dinamik BAT oluşturma + ctx-size desteği
- VaneWorker: .next klasör temizleme + npm run dev pattern + SEARXNG_API_URL
- Process tree kill: Leaf-first terminate → 10s wait → force kill fallback
- Port bazlı emergency kill (netstat ile)
- Health check auto-restart: Unresponsive sunucuları otomatik restart

## Phase 2: IPC Handlers ✅ TAMAMLANDI
### electron/main.js
- loadDatabase(): OpenWebUI DB swap (eski'yi .backup olarak yedekler)
- calculateSHA256()/verifyModelSHA256(): Model hash doğrulama
- updateMCPAdvisorFile(): mcp_web_reader.py dosyasını güncelle
- Atomic config write: fs.fsyncSync() eklendi

### electron/preload.js
- database.load(), database.verifySHA256() eklendi
- picoding.saveAdvisor() → mcp-update-advisor-file IPC channel'a yönlendirildi

## PyQt6 Reference Files Read
- launcher/tabs/system_detection.py — Hardware detection + INI matching
- launcher/tabs/servers.py — 4 Worker class + graceful shutdown + health check
- launcher/tabs/picoding.py — Project detection + PATH + MCP advisor
- launcher/app.py — ConfigManager + LanguageManager + AppManager singleton
