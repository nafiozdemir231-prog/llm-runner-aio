'use strict';
/**
 * preset-store.js
 *
 * Aktif INI preset dosyasindaki model bolumlerini ve model_urls.json
 * kayitlarini MINIMAL MUDAHALE ile yonetir:
 *   - INI: sadece hedef bolum icindeki model/mmproj satirlari degisir,
 *     diger tum satirlar (yorumlar dahil) bayt-bayt korunur.
 *   - JSON: sadece jsonKey[bolumAdi] anahtari eklenir/guncellenir/silinir,
 *     diger tum kayitlara dokunulmaz. Bosalan ust anahtar (orn. vramX.ini)
 *     KALDIRILMAZ (karsilikli log/uyari akislari bu anahtarlari kullanir).
 *
 * Electron bagimliligi YOKTUR — testlerde dogrudan require edilir.
 */

const fs = require('fs');

const SECTION_NAME_RE = /^[A-Za-z0-9._-]+$/;
const HTTP_URL_RE = /^https?:\/\//i;

function assertSafeIniName(iniName) {
    if (typeof iniName !== 'string' || !/^[\w.-]+\.ini$/.test(iniName)) {
        const err = new Error('Invalid INI name: ' + String(iniName));
        err.code = 'INVALID_INI_NAME';
        throw err;
    }
}

function assertSafeSectionName(sectionName) {
    if (typeof sectionName !== 'string' || !SECTION_NAME_RE.test(sectionName)) {
        const err = new Error('Invalid section name: ' + String(sectionName));
        err.code = 'INVALID_SECTION_NAME';
        throw err;
    }
}

function detectEol(content) {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * INI bolum araligini bulur: [name] basligi satiri -> sonraki bolum basligi (dahil degil).
 * Bulamazsa { start: -1, end: -1 }.
 */
function findSectionRange(lines, sectionName) {
    const headerRe = new RegExp('^\\[' + escapeRegExp(sectionName) + '\\]$');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (headerRe.test(lines[i].trim())) { start = i; break; }
    }
    if (start < 0) return { start: -1, end: -1 };
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^\[.+\]$/.test(lines[i].trim())) { end = i; break; }
    }
    return { start, end };
}

/**
 * INI icindeki tum bolumleri sirayla dondurur: [{ name, keys:{...} }, ...]
 */
function listSections(iniPath) {
    const content = fs.readFileSync(iniPath, 'utf8');
    const sections = [];
    let current = null;
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const m = line.match(/^\[(.+)\]$/);
        if (m) {
            current = { name: m[1], keys: {} };
            sections.push(current);
            continue;
        }
        const kv = line.match(/^(.+?)=(.*)$/);
        if (kv && current) {
            current.keys[kv[1].trim()] = kv[2].trim().replace(/^['"]|['"]$/g, '');
        }
    }
    return sections;
}

/**
 * Yerel yol kurali — indirme akisiyla birebir ayni (main.js downloadModel):
 *   folder = isimden '-vision' parcalanmis halinin kalani; file = URL'in son parcasi.
 */
function deriveLocalPaths(sectionName, modelUrl, mmprojUrl) {
    const folderName = sectionName.replace('-vision', '').replace('-Vision', '');
    const fileName = (modelUrl || '').split('/').pop() || '';
    const out = { localModel: 'models/' + folderName + '/' + fileName };
    if (mmprojUrl) {
        const mmFile = mmprojUrl.split('/').pop() || '';
        out.localMmproj = 'models/' + folderName + '/' + mmFile;
    } else {
        out.localMmproj = null;
    }
    return out;
}

/**
 * INI ismi -> model_urls.json ust anahtari (ayni kural: ^gpu\d+ cikarilir).
 */
function jsonKeyFor(iniName) {
    return iniName.replace(/^gpu\d+/, '');
}

function readJsonPreserving(urlsJsonPath) {
    if (!fs.existsSync(urlsJsonPath)) {
        return { data: {}, eol: '\r\n', existed: false };
    }
    const raw = fs.readFileSync(urlsJsonPath, 'utf8');
    const data = JSON.parse(raw);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        const err = new Error('model_urls.json must be a JSON object');
        err.code = 'BAD_JSON_ROOT';
        throw err;
    }
    return { data, eol: detectEol(raw), existed: true };
}

function writeJsonPreserving(urlsJsonPath, data, eol) {
    let out = JSON.stringify(data, null, 2);
    if (out.indexOf('\n') >= 0) out = out.replace(/\n/g, eol);
    fs.writeFileSync(urlsJsonPath, out + eol, 'utf8');
}

/**
 * Model bolumunu ekler veya gunceller (INI + model_urls.json).
 *
 * opts: { iniPath, urlsJsonPath, iniName, sectionName, modelUrl, mmprojUrl? }
 * Donus: { success, mode: 'added'|'updated', localModel, localMmproj, jsonKey }
 */
function saveSection(opts) {
    const iniPath = opts.iniPath;
    const urlsJsonPath = opts.urlsJsonPath;
    const iniName = opts.iniName;
    const sectionName = opts.sectionName;
    const modelUrl = opts.modelUrl;
    const mmprojUrl = opts.mmprojUrl || '';

    assertSafeIniName(iniName);
    assertSafeSectionName(sectionName);
    if (typeof modelUrl !== 'string' || !HTTP_URL_RE.test(modelUrl)) {
        const err = new Error('modelUrl must be an http(s) URL');
        err.code = 'MODEL_URL_REQUIRED';
        throw err;
    }
    if (mmprojUrl && (typeof mmprojUrl !== 'string' || !HTTP_URL_RE.test(mmprojUrl))) {
        const err = new Error('mmprojUrl must be an http(s) URL when provided');
        err.code = 'MMPROJ_URL_INVALID';
        throw err;
    }
    if (!fs.existsSync(iniPath)) {
        const err = new Error('INI file not found: ' + iniName);
        err.code = 'INI_NOT_FOUND';
        throw err;
    }

    const content = fs.readFileSync(iniPath, 'utf8');
    const eol = detectEol(content);
    const original = content.split(/\r?\n/);
    const range = findSectionRange(original, sectionName);
    const derived = deriveLocalPaths(sectionName, modelUrl, mmprojUrl || null);
    const localModel = derived.localModel;
    const localMmproj = derived.localMmproj;

    const setKeys = [['model', localModel]];
    if (localMmproj) setKeys.push(['mmproj', localMmproj]);

    let lines;
    let mode;
    if (range.start >= 0) {
        // ---- MEVCUT BOLUM: sadece model/mmproj satirlarini degistir/ekle ----
        mode = 'updated';
        const head = original.slice(0, range.start + 1);
        const tail = original.slice(range.end);
        const seg = original.slice(range.start + 1, range.end);
        for (const pair of setKeys) {
            const key = pair[0];
            const value = pair[1];
            const keyRe = new RegExp('^' + key + '\\s*=', 'i');
            const idx = seg.findIndex(l => keyRe.test(l.trim()));
            if (idx >= 0) {
                seg[idx] = key + ' = ' + value;
            } else {
                let insertAt = seg.length;
                while (insertAt > 0 && seg[insertAt - 1].trim() === '') insertAt--;
                seg.splice(insertAt, 0, key + ' = ' + value);
            }
        }
        if (!localMmproj) {
            // MMProj temizlendi -> eski mmproj satirini da kaldir
            const mmIdx = seg.findIndex(l => /^mmproj\s*=/i.test(l.trim()));
            if (mmIdx >= 0) seg.splice(mmIdx, 1);
        }
        lines = head.concat(seg, tail);
    } else {
        // ---- YENI BOLUM: dosyanin sonuna ekle ----
        mode = 'added';
        lines = original.slice();
        if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
        lines.push('[' + sectionName + ']');
        lines.push('model = ' + localModel);
        if (localMmproj) lines.push('mmproj = ' + localMmproj);
        lines.push('');
    }

    fs.writeFileSync(iniPath, lines.join(eol), 'utf8');

    // ---- model_urls.json: salt ekleyici/guncelleyici ----
    const parsed = readJsonPreserving(urlsJsonPath);
    const jsonKey = jsonKeyFor(iniName);
    if (!parsed.data[jsonKey] || typeof parsed.data[jsonKey] !== 'object' || parsed.data[jsonKey] === null) {
        parsed.data[jsonKey] = {};
    }
    const entry = { model: modelUrl };
    if (mmprojUrl) entry.mmproj = mmprojUrl;
    parsed.data[jsonKey][sectionName] = entry;
    writeJsonPreserving(urlsJsonPath, parsed.data, parsed.eol);

    return { success: true, mode, localModel, localMmproj, jsonKey };
}

/**
 * Model bolumunu siler (INI + model_urls.json kaydi birlikte).
 *
 * opts: { iniPath, urlsJsonPath, iniName, sectionName }
 * Donus: { success, iniRemoved, jsonRemoved }
 */
function deleteSection(opts) {
    const iniPath = opts.iniPath;
    const urlsJsonPath = opts.urlsJsonPath;
    const iniName = opts.iniName;
    const sectionName = opts.sectionName;

    assertSafeIniName(iniName);
    assertSafeSectionName(sectionName);
    if (!fs.existsSync(iniPath)) {
        const err = new Error('INI file not found: ' + iniName);
        err.code = 'INI_NOT_FOUND';
        throw err;
    }

    const content = fs.readFileSync(iniPath, 'utf8');
    const eol = detectEol(content);
    const original = content.split(/\r?\n/);
    const range = findSectionRange(original, sectionName);

    let iniRemoved = false;
    if (range.start >= 0) {
        let delStart = range.start;
        // Bolumu izleyen tek bos satiri da temizle (cift bosluk kalmasin)
        if (delStart > 0 && original[delStart - 1].trim() === '') delStart--;
        const lines = original.slice(0, delStart).concat(original.slice(range.end));
        fs.writeFileSync(iniPath, lines.join(eol), 'utf8');
        iniRemoved = true;
    }

    let jsonRemoved = false;
    if (fs.existsSync(urlsJsonPath)) {
        const parsed = readJsonPreserving(urlsJsonPath);
        const jsonKey = jsonKeyFor(iniName);
        const bucket = parsed.data[jsonKey];
        if (bucket && typeof bucket === 'object' && sectionName in bucket) {
            delete bucket[sectionName];
            jsonRemoved = true;
            writeJsonPreserving(urlsJsonPath, parsed.data, parsed.eol);
        }
    }

    return { success: true, iniRemoved, jsonRemoved };
}

module.exports = {
    assertSafeIniName,
    assertSafeSectionName,
    listSections,
    deriveLocalPaths,
    jsonKeyFor,
    saveSection,
    deleteSection,
    _internal: { findSectionRange, detectEol, readJsonPreserving, writeJsonPreserving }
};
