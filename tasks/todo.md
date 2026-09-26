# Task: picoding pi 0.85.1 → 0.87.1 (yerel yama korunarak)

## Steps
- [x] 1. Yerel yamayı tespit et: kurulu 0.85.1 vs ham npm 0.85.1 diff
- [x] 2. picoding/package.json'da sürümü 0.87.1'e yükselt, kur
- [x] 3. Yamayı 0.87.1'e yeniden uygula (gerekirse ofset düzelt)
- [x] 4. Doğrula: pi --version, pi list (pi-vcc sağlam), yama marker'ları mevcut
- [x] 5. Görev kayıtlarını güncelle (change.md, state.md) + commit

## Notes
- YAMA (dist/core/compaction/compaction.js, tek dosya):
  1) DEFAULT_COMPACTION_SETTINGS: reserveTokens 16384→32768, keepRecentTokens 20000→28672
  2) stopReason="length" mesajı bilgilendirici hale getirildi (completionTokens dahil)
  3) generateSummaryWithUsage: min(0.8*reserve, model.maxTokens) → max(...) — lokal model tavanının altına düşmez
  4) generateTurnPrefixSummary: aynı, çarpan 0.5→0.6
- Yeniden kullanılabilir script: picoding/patches/apply-compaction-patch.js (idempotent, 4/4 byte-eşit doğrulandı)
- 0.87.1'de ham satırlar aynen duruyordu → yama ofsetsiz oturdu
- dist/cli.js 0.87.1'de de mevcut → pi.cmd/pi.bat wrapper'ları bozulmadı
- Doğrulama: node --check OK, pi --version 0.87.1, pi list (pi-vcc 0.8.0 + mcp-adapter sağlam),
  canlı test: pi -p "Sadece OK yaz" --model Ling-3.0-tiny → "OK"

## Diagram
[kurulu 0.85.1] ──diff──> [yama: 4 nokta] ──script──> [0.87.1 temiz] ──apply──> [SONUÇ ✓]
