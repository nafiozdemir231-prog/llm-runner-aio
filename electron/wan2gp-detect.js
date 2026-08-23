'use strict';

/**
 * Wan2GP GPU→preset eşleme ve preset metadata yardımcıları.
 * Saf Node modülü (Electron bağımlılığı YOK) — doğrudan unit-test edilebilir.
 *
 * Preset klasör düzeni:
 *   wan2gp-presets/<marka>/<nesil>/{KURULUM.md, requirements.txt}
 */

const fs = require('fs');
const path = require('path');

/** Marka sırası (görüntüleme/kontrol sırası) */
const BRAND_ORDER = ['nvidia', 'amd', 'intel'];

function _preset(brand, gen) {
    return { brand, gen, path: brand + '/' + gen };
}

/**
 * Tespit edilen GPU adını Wan2GP preset klasörüne eşler.
 * @param {string} gpuName ör. "NVIDIA GeForce RTX 4070", "AMD Radeon RX 7800 XT",
 *                        "Intel(R) Arc(TM) A770 Graphics", "AMD Ryzen AI 9 HX 370"
 * @returns {{brand:string, gen:string, path:string}|null} Eşleşme yoksa null
 */
function mapGpuToWan2gpPreset(gpuName) {
    const name = (gpuName || '').toLowerCase();
    if (!name.trim()) return null;

    // NVIDIA — daha spesifik desenler önce
    if (/gtx\s*10\d\d/.test(name)) return _preset('nvidia', 'gtx10xx');
    if (/gtx\s*16\d\d/.test(name)) return _preset('nvidia', 'rtx20xx-gtx16xx');
    if (/rtx\s*2\d\d/.test(name)) return _preset('nvidia', 'rtx20xx-gtx16xx');
    if (/rtx\s*3\d\d/.test(name)) return _preset('nvidia', 'rtx30xx');
    if (/rtx\s*4\d\d/.test(name)) return _preset('nvidia', 'rtx40xx');
    if (/rtx\s*5\d\d/.test(name)) return _preset('nvidia', 'rtx50xx');

    // AMD — önce ayrık nesiller, kalan AMD → APU/iGPU
    if (/rx\s*6\d\d\d/.test(name)) return _preset('amd', 'rx6xxx');
    if (/rx\s*7\d\d\d/.test(name)) return _preset('amd', 'rx7xxx');
    if (/rx\s*9\d\d\d/.test(name)) return _preset('amd', 'rx9xxx');
    if (/amd|radeon/.test(name)) return _preset('amd', 'apu');

    // Intel — yalnız ayrık Arc (Iris/Xe iGPU kapsam dışı)
    if (/intel/.test(name) && /\barc\b/.test(name)) return _preset('intel', 'arc');

    return null;
}

/**
 * Diskte mevcut presetleri listeler.
 * @param {string} presetsDir
 * @returns {Array<{brand:string, gen:string, path:string}>}
 */
function listPresets(presetsDir) {
    const out = [];
    try {
        if (!fs.existsSync(presetsDir)) return out;
        for (const brand of BRAND_ORDER) {
            const brandDir = path.join(presetsDir, brand);
            if (!fs.existsSync(brandDir)) continue;
            const gens = fs.readdirSync(brandDir, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => e.name)
                .sort();
            for (const gen of gens) {
                if (fs.existsSync(path.join(brandDir, gen, 'requirements.txt'))) {
                    out.push({ brand, gen, path: brand + '/' + gen });
                }
            }
        }
    } catch {}
    return out;
}

/**
 * KURULUM.md içindeki "## Sistem Gereksinimleri" tablosundan ön gereksinim satırlarını çıkarır.
 * @param {string} kurulumText
 * @returns {string[]} "- Öğe: sürüm" formatında satırlar (boş dizi = bulunamadı)
 */
function extractPrereqs(kurulumText) {
    const lines = [];
    if (!kurulumText) return lines;
    const text = kurulumText.replace(/\r\n/g, '\n');
    const start = text.indexOf('## Sistem Gereksinimleri');
    if (start === -1) return lines;
    let inTable = false;
    for (const raw of text.slice(start).split('\n')) {
        const line = raw.trim();
        if (!line.startsWith('|')) {
            if (inTable) break; // tablo bitti
            continue;           // henüz tabloya gelinmedi
        }
        inTable = true;
        const cells = line.split('|').slice(1, -1).map(s => s.trim());
        if (cells.length < 2) continue;
        if (cells.every(c => /^:?-+:?$/.test(c))) continue; // ayraç satırı
        if (/^Öğe$/i.test(cells[0])) continue; // başlık satırı
        lines.push('- ' + cells[0] + ': ' + (cells[1] || '?'));
    }
    return lines;
}

module.exports = { mapGpuToWan2gpPreset, listPresets, extractPrereqs, BRAND_ORDER };
