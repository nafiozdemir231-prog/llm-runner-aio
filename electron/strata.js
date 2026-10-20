// electron/strata.js - Strata katman yonetimi (LLM-Runner-AIO'ya ozel; upstream koduna dokunulmaz).
// Katman dosyalarinin izlenen ana kopyalari: <PROJECT>/strata-layer/ -> Strata/ icine kopyalanir.
'use strict';

const path = require('path');
const fs = require('fs');

// Surum tablosu setup.py MODELS ile hizali (download GB / onerilen minimum RAM GB).
// Hizalama kaynagi: upstream v0.2.0-beta (Strata/main e88ee39d, 2026-10-19) — IQ3_XXS ram_gb 56->60,
// IQ3_S 64->62. setup.py MIN_ENGINE = 0.1.45: eski engine'de 🔄 Update (setup.py --update) engine'i indirir.
// Upstream'de bizim sunmadigimiz aileler de var (--family unsloth/gyro/nvfp4/swift); bilerek qwen+coder.
const CHOICES = [
    { size: 'IQ1_M', label: 'Coder — yarim uzmanli, koda odakli (en dusuk yer)', downloadGb: 58.4, minRamGb: 32 },
    { size: 'Q2_0', label: 'Q2_0 — en hizli tam model', downloadGb: 66.4, minRamGb: 48 },
    { size: 'IQ2_XS', label: 'IQ2_XS — 2-bit i-quant, biraz daha iyi kalite', downloadGb: 68.0, minRamGb: 48 },
    { size: 'IQ3_XXS', label: 'IQ3_XXS — 3-bit i-quant, daha iyi kalite', downloadGb: 75.8, minRamGb: 60 },
    { size: 'IQ3_S', label: 'IQ3_S — en iyi kalite, en yavas', downloadGb: 83.6, minRamGb: 62 }
];

// setup.py indirme satiri ornegi: "  qwen38_pack/experts.bin:  31.20 / 75.84 GB (41%)" — log yerine
// ayri 'strata-download-progress' olayina cevrilir (yuzde + dosya); log akişi sismanlar.
const DL_PROGRESS_RE = /^\s*(.+?):\s*([\d.]+) \/ ([\d.]+) GB \((\d+)%\)\s*$/;

const PARK = { '--conversation-cache-mib': '4096', '--conversation-cache-slots': '2', '--conversation-cache-min-free-mib': '4096' };
const SAMPLING = (temp) => ({ temperature: temp, top_k: 20, top_p: 0.95, min_p: 0.0, presence_penalty: 0.0, repetition_penalty: 1.08 });

// Kalibrasyon bayraklari: setup.py CAL.apply bunlari args'a yazar; hangi kapinin kalibre oldugunu bundan anlariz.
const CALIB_FLAGS = ['--pool-workers', '--adapt-every', '--adapt-swaps', '--adapt-decay', '--pcie-frac', '--spec-min-p'];
function pickCalibratedSource(g, c) {
    const score = (cfg) => CALIB_FLAGS.reduce((n, f) => n + ((cfg.args || []).map(String).includes(f) ? 1 : 0), 0);
    return score(c) > score(g) ? c : g;
}

// Iki kapinin args listelerini esitler (spec #2/#3: tek motor = birebir args).
// afterCalibration=true: kalibrasyon setup.py'de mtime'i en yeni config'e uygulanir (genelde coder);
// kalibre bayraklarin tam kumesi hangisindeyse KAYNAK odur ve iki kapida ayni degerleri alir —
// aksi halde kalibre edilmemis general, kalibre coder'i ezerdi (hedef PC bulgusu: --pool-workers 15 kaldisi).
function mergeGateConfigs(g, c, afterCalibration) {
    // #465 parallel anahtari args'ta degil config seviyesinde: iki kapida ayni olmali.
    const par = Number.isInteger(g.parallel) ? g.parallel : (Number.isInteger(c.parallel) ? c.parallel : 1);
    const src = afterCalibration ? pickCalibratedSource(g, c) : g;
    const args = (src.args || []).map(String);
    return {
        general: { ...g, args, parallel: par },
        coder: { ...c, args, parallel: par },
        changedGeneral: JSON.stringify(g.args || []) !== JSON.stringify(args),
        changedCoder: JSON.stringify(c.args || []) !== JSON.stringify(args),
        source: src === g ? 'general' : 'coder',
    };
}

let ctx = null;
let gatewayProc = null;

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };

// Katman dosyalari eksikse izlenen kopyalardan geri yukle (git pull / yeni klon sonrasi garanti).
function ensureLayer() {
    if (!ctx || !fs.existsSync(ctx.DIR)) return;
    const wanted = [['gateway.py', 'local/gateway.py'], ['checkargs.py', 'local/checkargs.py'],
        ['models.json', 'local/models.json'], ['MULTI-MODEL.bat', 'MULTI-MODEL.bat'], ['GUNCELLE.bat', 'GUNCELLE.bat']];
    for (const [srcName, rel] of wanted) {
        const dst = path.join(ctx.DIR, rel);
        const src = path.join(ctx.LAYER, srcName);
        if (!fs.existsSync(src)) continue;
        // Icerik farkliysa katmani tazele: hedef PC'de eski kopyalar durur, eksikse-kopyala yetmez.
        const same = fs.existsSync(dst) && fs.readFileSync(dst).equals(fs.readFileSync(src));
        if (!same) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    }
}

const gatewayPort = () => { const s = readJson(ctx ? ctx.MODELS_JSON : ''); return s && Number(s.port) ? Number(s.port) : 1235; };

async function health() {
    try {
        const r = await fetch(`http://127.0.0.1:${gatewayPort()}/health`, { signal: AbortSignal.timeout(4000) });
        return r.ok ? await r.json() : null;
    } catch { return null; }
}

function register(deps) {
    const { ipcMain, safeSend, detectHardware, runStreaming, runCapture, setServerState, PROJECT_DIR } = deps;
    const DIR = path.join(PROJECT_DIR, 'Strata');
    const LAYER = path.join(PROJECT_DIR, 'strata-layer');
    const VENV_PY = path.join(DIR, '.venv', 'Scripts', 'python.exe');
    const MODELS_JSON = path.join(DIR, 'local', 'models.json');
    let setupRunning = false;
    ctx = { DIR, LAYER, VENV_PY, MODELS_JSON, PROJECT_DIR, safeSend, setServerState };

    function backupStampDir() {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const dir = path.join(DIR, '.tmp', 'backups', 'manual-' + stamp);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    // Kural 7: her config degisikliginden once yedek (tum dosyalar ayni klasore).
    function writeBackup(p, obj, backupDir) {
        if (fs.existsSync(p)) {
            const dir = backupDir || backupStampDir();
            try { fs.copyFileSync(p, path.join(dir, path.basename(p))); } catch {}
        }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
        try { fs.unlinkSync(p); } catch {}
        fs.renameSync(tmp, p);
    }

    // syncCoderArgs: mergeGateConfigs sonucu iki dosyaya yazar; ayni olan dosyaya yazmaz (mtime stabil kalir,
    // siradaki kalibrasyonun "en yeni config" secimi bozulmaz).
    function syncCoderArgs(backupDir, afterCalibration) {
        const g = readJson(path.join(DIR, 'strata-general.json'));
        const c = readJson(path.join(DIR, 'strata-coder.json'));
        if (!g || !c) return false;
        const m = mergeGateConfigs(g, c, afterCalibration);
        if (m.changedGeneral) writeBackup(path.join(DIR, 'strata-general.json'), m.general, backupDir);
        if (m.changedCoder) writeBackup(path.join(DIR, 'strata-coder.json'), m.coder, backupDir);
        return true;
    }

    function ensureParking(cfg) {
        const args = (cfg.args || []).map(String);
        for (const [flag, val] of Object.entries(PARK)) {
            const i = args.indexOf(flag);
            if (i < 0) args.push(flag, val); else if (args[i + 1] !== val) args[i + 1] = val;
        }
        cfg.args = args;
    }

    async function checkargsReport(send) {
        if (!fs.existsSync(VENV_PY)) return null;
        const r = await runCapture([VENV_PY, path.join(DIR, 'local', 'checkargs.py')]);
        String(r.out || '').split(/\r?\n/).forEach((l) => l.trim() && send('checkargs| ' + l));
        return r;
    }

    ipcMain.handle('strata-status', async () => {
        const hw = await detectHardware();
        if (fs.existsSync(DIR)) ensureLayer();
        const s = readJson(MODELS_JSON);
        const general = readJson(path.join(DIR, 'strata-general.json'));
        let maxContext = null;
        let vision = null;
        let modelSize = null;
        let parallel = 1;
        if (general && Array.isArray(general.args)) {
            const i = general.args.indexOf('--max-context');
            if (i >= 0) maxContext = Number(general.args[i + 1]);
            const v = general.args.indexOf('--vision');
            // Vision durumu args'tan DEGIL config'in "vision" bolumunden okunur (upstream: args'ta --vision
            // bayragindan hemen sonra --vram-reserve-mib gelir; gpu/cpu ayrimi cfg["vision"] = {gpu: bool}'da).
            const vis = general.vision;
            if (vis && typeof vis === 'object') vision = vis.gpu ? 'gpu' : 'cpu';
            else if (typeof vis === 'string') vision = ['gpu', 'cpu'].includes(vis.toLowerCase()) ? vis.toLowerCase() : 'no';
            else vision = v >= 0 ? 'gpu' : 'no'; // eski config: bolum yoksa bayragin varligi
            // Uretilen args'te boyut '--pack <.../packs/iq3_xxs>' olarak geciyor -> basename = CHOICES.size (kucuk harf).
            const pk = general.args.indexOf('--pack');
            if (pk >= 0) modelSize = String(general.args[pk + 1]).replace(/[\\/]+$/, '').split(/[\\/]/).pop().toUpperCase();
        }
        // #465: "parallel": N config anahtari (serve bunu --batch N'ye cevirir; 1 = sirayla).
        if (general && Number.isInteger(general.parallel) && general.parallel >= 2) parallel = general.parallel;
        return {
            // STRATA_DEV=1: test makinesinde karti RAM esigi altinda da gorunur kilar (varsayilan davranis degismez).
            eligible: (hw.ramGb >= 48 && (hw.vramGb || 0) >= 12) || process.env.STRATA_DEV === '1',
            ramGb: hw.ramGb, vramGb: hw.vramGb || 0, gpuName: hw.gpuName || '',
            repoCloned: fs.existsSync(path.join(DIR, 'setup.py')),
            installed: fs.existsSync(VENV_PY),
            layerOk: fs.existsSync(path.join(DIR, 'local', 'gateway.py')),
            configured: !!(s && general),
            running: !!(await health()),
            setupRunning,
            port: s ? Number(s.port) : 1235,
            host: s ? String(s.host) : '0.0.0.0',
            hasApiKey: !!(s && String(s.api_key || '').trim()),
            apiKey: s ? String(s.api_key || '') : '',
            idleUnloadS: s ? s.idle_unload_s : 600,
            maxContext,
            vision,
            modelSize,
            parallel,
            choices: CHOICES.map((c) => ({ ...c, fits: hw.ramGb >= c.minRamGb }))
        };
    });

    ipcMain.handle('strata-setup', async (event, options = {}) => {
        if (setupRunning) return { success: false, error: 'Setup already in progress.' };
        const choice = CHOICES.find((c) => c.size === options.size);
        if (!choice) return { success: false, error: 'Unknown model size: ' + options.size };
        setupRunning = true;
        // Indirme yuzdeleri log'a degil strata-download-progress kanalina gider; diger satirlar log'da kalir.
        const send = (m) => {
            const pm = String(m).match(DL_PROGRESS_RE);
            if (pm) safeSend('strata-download-progress', { file: pm[1].trim(), gotGb: Number(pm[2]), totalGb: Number(pm[3]), pct: Number(pm[4]) });
            else safeSend('strata-setup-log', { message: m });
        };
        try {
            if (!fs.existsSync(path.join(DIR, 'setup.py'))) throw new Error('Strata klasoru bulunamadi — once klon gerekli.');
            ensureLayer();
            const vision = ['gpu', 'cpu'].includes(options.vision) ? options.vision : 'no';
            // #465 paralel istek (opt-in): setup.py --parallel N -> config'e "parallel": N yazilir (2-8).
            const parallelN = Number(options.parallel);
            const useParallel = Number.isInteger(parallelN) && parallelN >= 2 ? Math.min(parallelN, 8) : null;
            send('[SETUP] Model ' + choice.size + ' indiriliyor (~' + choice.downloadGb + ' GB) -> models\ ...' + (vision !== 'no' ? ' + vision (' + vision + ')' : '') + (useParallel ? ' + parallel ' + useParallel : ''));
            const setupArgs = ['cmd', '/c', path.join(DIR, 'START-HERE.bat'),
                '--yes', '--model', choice.size, '--vision', vision,
                '--models-dir', path.join(PROJECT_DIR, 'models'),
                '--data-dir', path.join(PROJECT_DIR, 'models', 'strata'),
                '--no-start'];
            if (useParallel) setupArgs.push('--parallel', String(useParallel));
            await runStreaming(setupArgs, send);

            // Uretilen config'ten iki kapi config'i: AYNI args (tek motor) + ayri sampling profili.
            const gen = fs.readdirSync(DIR)
                .filter((f) => /^strata-.*\.json$/i.test(f) && !['strata-general.json', 'strata-coder.json'].includes(f) && !f.endsWith('.tmp'))
                .map((f) => ({ f, p: path.join(DIR, f) }))
                .sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs);
            if (!gen.length) throw new Error('Setup bitti ama strata-*.json config uretilmedi.');
            const base = readJson(gen[0].p);
            if (!base || !Array.isArray(base.args)) throw new Error('Config okunamadi: ' + gen[0].f);
            ensureParking(base);
            const backupDir = backupStampDir();
            // Setup args'i bastan uretir: eski kapida kalibrasyon tuningi varsa ve yenide yoksa uyar
            // (upstream kayitli kalibrasyonu yalniz ayni imzada - model/ctx/vision - geri uygular).
            const prevG = readJson(path.join(DIR, 'strata-general.json'));
            const prevCalib = prevG && Array.isArray(prevG.args) ? CALIB_FLAGS.filter((f) => prevG.args.map(String).includes(f)) : [];
            for (const [name, temp] of [['strata-general.json', 1.0], ['strata-coder.json', 0.6]]) {
                const c = JSON.parse(JSON.stringify(base));
                c.sampling = SAMPLING(temp);
                writeBackup(path.join(DIR, name), c, backupDir);
            }
            send('[SETUP] strata-general.json + strata-coder.json yazildi (args birebir, sampling ayri). Yedek: ' + backupDir);
            if (prevCalib.length && !prevCalib.every((f) => (base.args || []).map(String).includes(f)))
                send('[SETUP] UYARI: Onceki kalibrasyon tuningi (' + prevCalib.join(', ') + ') setup ile sifirlandi - imza degisti ise (vision/context) 🎯 Calibrate tekrar calistirilmali.');

            // models.json garanti; API key artik ZORUNLU DEGIL ve otomatik uretilmez — bos birakilirsa ansikiz calisir.
            if (!fs.existsSync(MODELS_JSON)) fs.copyFileSync(path.join(LAYER, 'models.json'), MODELS_JSON);
            const s = readJson(MODELS_JSON) || {};
            const chk = await checkargsReport(send);
            if (chk && chk.code !== 0) send('[SETUP] UYARI: checkargs sert sorun buldu (yukarida liste).');
            send('[SETUP] Kurulum tamamlandi. Sunucular sekmesinden baslatabilirsin.');
            return { success: true, apiKey: String(s.api_key || '') };
        } catch (err) {
            console.error('[STRATA-SETUP] Failed:', err.message);
            send('[SETUP] FAILED: ' + err.message);
            return { success: false, error: err.message };
        } finally {
            setupRunning = false;
        }
    });

    ipcMain.handle('strata-calibrate', async () => {
        if (setupRunning) return { success: false, error: 'Setup/calibration already in progress.' };
        if (!fs.existsSync(path.join(DIR, 'strata-general.json'))) return { success: false, error: 'Once model kurulumu gerekli.' };
        setupRunning = true;
        const send = (m) => safeSend('strata-setup-log', { message: m });
        try {
            send('[CALIBRATE] Donanim olcumu basladi (~5-10 dk). --no-start: model gateway uzerinden calisacak.');
            const t0 = Date.now();
            const beat = setInterval(() => send('[CALIBRATE] Olcum suruyor... ' + Math.round((Date.now() - t0) / 60000) + ' dk - bittiginde loga Tamamlandi yazacak, lutfen bekleyin.'), 45000);
            try {
                await runStreaming(['cmd', '/c', path.join(DIR, 'START-HERE.bat'), '--calibrate', '--no-start', '--yes'], send);
            } finally { clearInterval(beat); }
            const backupDir = backupStampDir();
            if (syncCoderArgs(backupDir, true)) send('[CALIBRATE] Args iki kapida da kalibre degerlerle esitlendi (sampling korundu). Yedek: ' + backupDir);
            await checkargsReport(send);
            return { success: true };
        } catch (err) {
            console.error('[STRATA-CALIBRATE] Failed:', err.message);
            send('[CALIBRATE] FAILED: ' + err.message);
            return { success: false, error: err.message };
        } finally {
            setupRunning = false;
        }
    });

    ipcMain.handle('strata-config-read', async () => {
        const s = readJson(MODELS_JSON) || {};
        const g = readJson(path.join(DIR, 'strata-general.json'));
        let maxContext = null;
        if (g && Array.isArray(g.args)) {
            const i = g.args.indexOf('--max-context');
            if (i >= 0) maxContext = Number(g.args[i + 1]);
        }
        const parallel = (g && Number.isInteger(g.parallel) && g.parallel >= 2) ? g.parallel : 1;
        return { success: true, config: { host: String(s.host || '127.0.0.1'), port: Number(s.port || 1235), backendPortBase: Number(s.backend_port_base || 1236), apiKey: String(s.api_key || ''), idleUnloadS: Number(s.idle_unload_s === undefined ? 600 : s.idle_unload_s), maxContext, parallel } };
    });

    // UI config paneli: context, PC/YerelAg host modu, port. Her degisiklik yedekli (kural 7).
    ipcMain.handle('strata-config-write', async (event, options = {}) => {
        const s = readJson(MODELS_JSON);
        if (!s) return { success: false, error: 'models.json yok — once Setup calistirin.' };
        try {
            const backupDir = backupStampDir();
            const changed = [];
            if (options.port) {
                const port = Number(options.port);
                if (!Number.isInteger(port) || port < 1024 || port > 65000) throw new Error('Port 1024-65000 arasinda olmali.');
                s.port = port; s.backend_port_base = port + 1;
                changed.push('port=' + port + ' (backend base ' + (port + 1) + ')');
            }
            if (options.hostMode === 'pc') { s.host = '127.0.0.1'; changed.push('host=127.0.0.1 (sadece bu PC)'); }
            else if (options.hostMode === 'lan') {
                s.host = '0.0.0.0';
                changed.push('host=0.0.0.0 (yerel ag)');
            }
            // API key alani: yazilan deger aynen kullanilir; bos birakilirsa PC modunda temizlenir,
            // LAN modunda yeni key uretilir (Kural 9 bos keyle agaciga cikmaya izin vermez).
            if (options.apiKey !== undefined) {
                const k = String(options.apiKey).trim();
                // Bos birakilan alan artik bos kalir: key zorunlu degil, otomatik uretilmez.
                s.api_key = k;
                changed.push(k ? 'api_key guncellendi' : 'api_key temizlendi (ansikiz mod)');
            }
            if (options.idleUnloadS !== undefined && options.idleUnloadS !== '') {
                const v = Number(options.idleUnloadS);
                if (!Number.isFinite(v) || v <= 0) throw new Error('idle_unload_s > 0 olmali.');
                s.idle_unload_s = v; changed.push('idle_unload_s=' + v);
            }
            writeBackup(MODELS_JSON, s, backupDir);
            if (options.context) {
                const c = Number(options.context);
                const allowed = [32768, 65536, 131072, 262144];
                if (!allowed.includes(c)) throw new Error('Context secenekleri: ' + allowed.join(', '));
                for (const name of ['strata-general.json', 'strata-coder.json']) {
                    const p = path.join(DIR, name);
                    const g = readJson(p);
                    if (!g) continue;
                    const args = (g.args || []).map(String);
                    const i = args.indexOf('--max-context');
                    if (i >= 0) args[i + 1] = String(c); else args.push('--max-context', String(c));
                    g.args = args;
                    writeBackup(p, g, backupDir);   // iki config de ayni kalir -> tek motor bozulmaz
                }
                changed.push('max-context=' + c);
            }
            // #465 paralel istek: "parallel" config anahtari (serve --batch N'ye cevirir). Iki kapida da ayni
            // yazilir; args degismez -> motor imzasi bozulmaz, tek ark paylasimi korunur. 1 = sirayla (eski davranis).
            if (options.parallel !== undefined && options.parallel !== '') {
                const p = Number(options.parallel);
                if (!Number.isInteger(p) || p < 1 || p > 8) throw new Error('Parallel 1-8 arasinda tam sayi olmali (1 = sirayla).');
                for (const name of ['strata-general.json', 'strata-coder.json']) {
                    const fp = path.join(DIR, name);
                    const g = readJson(fp);
                    if (!g) continue;
                    g.parallel = p >= 2 ? p : 1;
                    writeBackup(fp, g, backupDir);
                }
                changed.push('parallel=' + (p >= 2 ? p + ' istek es zamanli (--batch)' : '1 (sirayla)'));
            }
            const chk = fs.existsSync(VENV_PY) ? await runCapture([VENV_PY, path.join(DIR, 'local', 'checkargs.py')]) : null;
            return { success: true, backupDir, changed, checkargs: chk ? String(chk.out || '') : 'venv yok - checkargs atlandi' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('strata-start', async () => await startGateway());

    ipcMain.handle('strata-stop', async () => stopGateway());

    // GUNCELLE mantiginin JS karsiligi (bat dosyasi manuel kullanim icin duruyor).
    ipcMain.handle('strata-update', async () => {
        if (setupRunning) return { success: false, error: 'Setup/calibration devam ediyor.' };
        setupRunning = true;
        const send = (m) => safeSend('strata-setup-log', { message: m });
        try {
            // Ayarlar korunur: pull/update öncesi models.json + kapı config'leri yedeklenir, eksilirse geri konur.
            const backupDir = backupStampDir();
            const keep = [MODELS_JSON, path.join(DIR, 'strata-general.json'), path.join(DIR, 'strata-coder.json')];
            for (const f of keep) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(backupDir, path.basename(f)));
            send('[UPDATE] Ayarlar yedeklendi: ' + backupDir);
            send('[UPDATE] Upstream kod cekiliyor (git fetch)...');
            await runStreaming(['git', '-C', DIR, 'fetch', 'origin'], send);
            const anc = await runCapture(['git', '-C', DIR, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
            if (anc.code === 0) {
                await runStreaming(['git', '-C', DIR, 'pull', '--ff-only'], send);
            } else {
                // Upstream rebased: yerel HEAD yeni main'in atasi degil -> hard reset (untracked katman dosyalari korunur).
                send('[UPDATE] Not: upstream yeniden duzenlendi (rebase) — git reset --hard origin/main uygulanacak; ayarlariniz yedekte.');
                await runStreaming(['git', '-C', DIR, 'reset', '--hard', 'origin/main'], send);
            }
            ensureLayer();
            for (const f of keep) {
                const b = path.join(backupDir, path.basename(f));
                if (!fs.existsSync(f) && fs.existsSync(b)) { fs.copyFileSync(b, f); send('[UPDATE] Geri yuklendi: ' + path.basename(f)); }
            }
            send('[UPDATE] Katman dosyalari ve ayarlar dogrulandi.');
            if (fs.existsSync(VENV_PY)) {
                send('[UPDATE] Engine yenileniyor (setup.py --update)...');
                await runStreaming([VENV_PY, 'setup.py', '--update'], send);
            }
            send('[UPDATE] Guncelleme tamamlandi.');
            return { success: true };
        } catch (err) {
            console.error('[STRATA-UPDATE] Failed:', err.message);
            send('[UPDATE] FAILED: ' + err.message);
            return { success: false, error: err.message };
        } finally {
            setupRunning = false;
        }
    });

    // Strata gateway'ini Open WebUI'nin OpenAI bağlantı listesine ekler (DB tabanlı: güncellemeler bunu silmez).
    ipcMain.handle('strata-connect-openwebui', async () => {
        const db = path.join(ctx.PROJECT_DIR, 'openwebui', 'openwebui.db');
        if (!fs.existsSync(db)) return { success: false, error: 'openwebui.db yok — once Open WebUIyi baslatin.' };
        const py = path.join(ctx.PROJECT_DIR, 'venv', 'Scripts', 'python.exe');
        if (!fs.existsSync(py)) return { success: false, error: 'Open WebUI venv bulunamadi (venv\\Scripts\\python.exe).' };
        const s = readJson(ctx.MODELS_JSON) || {};
        const url = `http://127.0.0.1:${Number(s.port || 1235)}/v1`;
        const apiKey = String(s.api_key || '');
        const script = [
            'import sqlite3,sys,json,time',
            'db,url,key=sys.argv[1],sys.argv[2],sys.argv[3]',
            'con=sqlite3.connect(db);cur=con.cursor()',
            'def get(k):',
            '    cur.execute("SELECT value FROM config WHERE key=?",(k,));r=cur.fetchone()',
            '    if not r: return None',
            '    return json.loads(r[0]) if isinstance(r[0],str) else r[0]',
            'def put(k,v):',
            '    cur.execute("INSERT INTO config(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",(k,json.dumps(v),int(time.time())))',
            'urls=get("openai.api_base_urls") or []',
            'keys=get("openai.api_keys") or []',
            'if url in urls:',
            '    i=urls.index(url)',
            '    if len(keys)>i and keys[i]!=key:',
            '        keys[i]=key;put("openai.api_keys",keys);con.commit()',
            '        print(json.dumps({"status":"updated","urls":urls}));sys.exit(0)',
            '    if len(keys)<=i and key:',
            '        keys.insert(i,key);put("openai.api_keys",keys);con.commit()',
            '        print(json.dumps({"status":"updated","urls":urls}));sys.exit(0)',
            '    print(json.dumps({"status":"exists","urls":urls}));sys.exit(0)',
            'urls.append(url);keys.append(key)',
            'put("openai.api_base_urls",urls);put("openai.api_keys",keys)',
            'con.commit()',
            'print(json.dumps({"status":"added","urls":urls}))'
        ].join('\n');
        const r = await runCapture([py, '-c', script, db, url, apiKey]);
        let parsed = null;
        try { parsed = JSON.parse(String(r.out || '').split(/\r?\n/).filter(Boolean).pop()); } catch {}
        if (r.code !== 0 || !parsed) return { success: false, error: 'DB islemi basarisiz: ' + String(r.out || '').slice(-300) };
        return { success: true, status: parsed.status, urls: parsed.urls, url };
    });
}

// Jenerik server-start/stop girisleri (Start All / Sunucular karti buradan gecer).
async function startGateway() {
    if (!ctx) return { success: false, error: 'Strata module kayitli degil.' };
    if (gatewayProc && gatewayProc.exitCode === null) return { success: true, note: 'Zaten calisiyor.', port: gatewayPort(), pid: gatewayProc.pid };
    if (!fs.existsSync(ctx.VENV_PY)) return { success: false, error: 'Strata venv yok — once Setup.' };
    ensureLayer();
    const { spawn } = require('child_process');
    const send = (m) => ctx.safeSend('strata-setup-log', { message: m });
    gatewayProc = spawn(ctx.VENV_PY, ['local/gateway.py', 'local/models.json'], { cwd: ctx.DIR, windowsHide: true });
    const fwd = (d) => String(d).split(/\r?\n/).forEach((l) => l.trim() && send('gateway| ' + l));
    gatewayProc.stdout.on('data', fwd);
    gatewayProc.stderr.on('data', fwd);
    gatewayProc.on('exit', (code) => {
        gatewayProc = null;
        ctx.setServerState('strata', false, gatewayPort());
        send('gateway| durdu (code ' + code + ')');
    });
    await new Promise((r) => setTimeout(r, 1500));
    if (!(await health())) await new Promise((r) => setTimeout(r, 3000));
    ctx.setServerState('strata', true, gatewayPort());
    return { success: true, port: gatewayPort(), pid: gatewayProc.pid };
}

function stopGateway() {
    if (gatewayProc) { gatewayProc.kill(); gatewayProc = null; }
    if (ctx) ctx.setServerState('strata', false, gatewayPort());
    return { success: true };
}

module.exports = { register, startGateway, stopGateway, CHOICES, pickCalibratedSource, mergeGateConfigs, CALIB_FLAGS };
