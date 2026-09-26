#!/usr/bin/env node
/**
 * pi-coding-agent — yerel compaction yamasını uygular (idempotent).
 *
 * Neden: Lokal modellerde (llama.cpp) varsayılan kompakt ayarları ve min()-tabanlı
 * maxTokens tavanı özet üretimini yarım kesiyor. Bu yama:
 *   1) DEFAULT_COMPACTION_SETTINGS: reserveTokens 16384→32768, keepRecentTokens 20000→28672
 *   2) stopReason="length" hata mesajını bilgilendirici hale getirir
 *   3) generateSummaryWithUsage: min()→max() — modelin beyan ettiği maxTokens'ı altına düşmez
 *   4) generateTurnPrefixSummary: aynı düzeltme, çarpan 0.5→0.6
 *
 * Kullanım: node picoding/patches/apply-compaction-patch.js [hedef-dizin]
 * Sürüm bağımsız: 0.85.1'den beri aynı noktalar; yeni sürümlerde de ham satırlar
 * değişmediği sürece çalışır (değiştiyse HATA verir, asla sessiz geçmez).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'core', 'compaction');
const file = path.join(targetDir, 'compaction.js');

if (!fs.existsSync(file)) {
  console.error('HATA: dosya bulunamadı:', file);
  process.exit(1);
}
let src = fs.readFileSync(file, 'utf8');

// İdempotency: daha önce uygulanmışsa dokunma
if (src.includes('suggestedMax')) {
  console.log('SKIP: yama zaten uygulanmış (suggestedMax mevcut)');
  process.exit(0);
}

const edits = [
  {
    name: 'settings-bloğu',
    from: 'enabled: true,\n    reserveTokens: 16384,\n    keepRecentTokens: 20000,',
    to: 'enabled: true,\n    reserveTokens: 32768,\n    keepRecentTokens: 28672,',
  },
  {
    name: 'length-hata-mesajı',
    from: 'return `${label} failed: generation hit the token cap and the summary is incomplete`;',
    to: 'return `${label} failed: generation hit the token cap (${response.usage?.completionTokens || \'?\'} tokens used). The context window is nearly full — try shorter conversations or a model with a larger context window.`;',
  },
  {
    name: 'summary-maxtokens',
    from: 'const maxTokens = Math.min(Math.floor(0.8 * reserveTokens), model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);',
    to: 'const suggestedMax = Math.floor(0.8 * reserveTokens);\n    const maxTokens = model.maxTokens > 0 ? Math.max(suggestedMax, model.maxTokens) : suggestedMax;',
  },
  {
    name: 'turnprefix-maxtokens',
    from: 'const maxTokens = Math.min(Math.floor(0.5 * reserveTokens), model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY); // Smaller budget for turn prefix',
    to: 'const suggestedMax = Math.floor(0.6 * reserveTokens);\n    const maxTokens = model.maxTokens > 0 ? Math.max(suggestedMax, model.maxTokens) : suggestedMax; // Larger budget for turn prefix',
  },
];

let ok = 0;
for (const e of edits) {
  const count = src.split(e.from).length - 1;
  if (count !== 1) {
    console.error(`HATA: "${e.name}" için beklenen tam 1 eşleşme, bulundu: ${count}. Yama uygulanmadı (dosya değişmeden bırakıldı).`);
    process.exit(2);
  }
  src = src.replace(e.from, e.to);
  ok++;
}

fs.writeFileSync(file, src, 'utf8');
console.log(`OK: ${ok}/4 yama uygulandı → ${file}`);
