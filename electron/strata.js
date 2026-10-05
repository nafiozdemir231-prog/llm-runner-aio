// electron/strata.js - Strata katman yonetimi (LLM-Runner-AIO'ya ozel; upstream koduna dokunulmaz).
// Katman dosyalarinin izlenen ana kopyalari: <PROJECT>/strata-layer/ -> Strata/ icine kopyalanir.
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Surum tablosu setup.py MODELS ile hizali (download GB / onerilen minimum RAM GB).
const CHOICES = [
    { size: 'IQ1_M', label: 'Coder — yarim uzmanli, koda odakli (en dusuk yer)', downloadGb: 58.4, minRamGb: 32 },
    { size: 'Q2_0', label: 'Q2_0 — en hizli tam model', downloadGb: 66.4, minRamGb: 48 },
    { size: 'IQ2_XS', label: 'IQ2_XS — 2-bit i-quant, biraz daha iyi kalite', downloadGb: 68.0, minRamGb: 48 },
    { size: 'IQ3_XXS', label: 'IQ3_XXS — 3-bit i-quant, daha iyi kalite', downloadGb: 75.8, minRamGb: 56 },
    { size: 'IQ3_S', label: 'IQ3_S — en iyi kalite, en yavas', downloadGb: 83.6, minRamGb: 64 }
];

const PARK = { '--conversation-cache-mib': '4096', '--conversation-cache-slots': '2', '--conversation-cache-min-free-mib': '4096' };
const SAMPLING = (temp) => ({ temperature: temp, top_k: 20, top_p: 0.95, min_p: 0.0, presence_penalty: 0.0, repetition_penalty: 1.08 });

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
        if (!fs.existsSync(dst)) {
            const src = path.join(ctx.LAYER, srcName);
            if (fs.existsSync(src)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
        }
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

    // syncCoderArgs: coder args <- general (spec #2/#3)
    function syncCoderArgs(backupDir) {
        const g = readJson(path.join(DIR, 'strata-general.json'));
        const c = readJson(path.join(DIR, 'strata-coder.json'));
        if (!g || !c) return false;
        c.args = (g.args || []).map(String);
        writeBackup(path.join(DIR, 'strata-coder.json'), c, backupDir);
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
        if (general && Array.isArray(general.args)) {
            const i = general.args.indexOf('--max-context');
            if (i >= 0) maxContext = Number(general.args[i + 1]);
        }
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
            idleUnloadS: s ? s.idle_unload_s : 600,
            maxContext,
            choices: CHOICES.map((c) => ({ ...c, fits: hw.ramGb >= c.minRamGb }))
        };
    });

    ipcMain.handle('strata-setup', async (event, options = {}) => {
        if (setupRunning) return { success: false, error: 'Setup already in progress.' };
        const choice = CHOICES.find((c) => c.size === options.size);
        if (!choice) return { success: false, error: 'Unknown model size: ' + options.size };
        setupRunning = true;
        const send = (m) => safeSend('strata-setup-log', { message: m });
        try {
            if (!fs.existsSync(path.join(DIR, 'setup.py'))) throw new Error('Strata klasoru bulunamadi — once klon gerekli.');
            ensureLayer();
            send('[SETUP] Model ' + choice.size + ' indiriliyor (~' + choice.downloadGb + ' GB) -> models\ ...');
            await runStreaming(['cmd', '/c', path.join(DIR, 'START-HERE.bat'),
                '--yes', '--model', choice.size, '--vision', 'no',
                '--models-dir', path.join(PROJECT_DIR, 'models'),
                '--data-dir', path.join(PROJECT_DIR, 'models', 'strata'),
                '--no-start'], send);

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
            for (const [name, temp] of [['strata-general.json', 1.0], ['strata-coder.json', 0.6]]) {
                const c = JSON.parse(JSON.stringify(base));
                c.sampling = SAMPLING(temp);
                writeBackup(path.join(DIR, name), c, backupDir);
            }
            send('[SETUP] strata-general.json + strata-coder.json yazildi (args birebir, sampling ayri). Yedek: ' + backupDir);

            // models.json garanti + kural 9: LAN aciksa api_key ZORUNLU — yoksa uret ve bildir.
            if (!fs.existsSync(MODELS_JSON)) fs.copyFileSync(path.join(LAYER, 'models.json'), MODELS_JSON);
            let s = readJson(MODELS_JSON) || {};
            const loopback = ['127.0.0.1', 'localhost', '::1'].includes(String(s.host));
            if (!loopback && !String(s.api_key || '').trim()) {
                s.api_key = crypto.randomBytes(24).toString('hex');
                writeBackup(MODELS_JSON, s, backupDir);
                send('[SETUP] KURAL 9: host ' + s.host + ' agacik — API key uretildi: ' + s.api_key);
            }
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
            await runStreaming(['cmd', '/c', path.join(DIR, 'START-HERE.bat'), '--calibrate', '--no-start'], send);
            const backupDir = backupStampDir();
            if (syncCoderArgs(backupDir)) send('[CALIBRATE] coder args <- general ile birebir esitlendi (sampling korundu). Yedek: ' + backupDir);
            await checkargsReport(send);
            send('[CALIBRATE] Tamamlandi.');
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
        return { success: true, config: { host: String(s.host || '127.0.0.1'), port: Number(s.port || 1235), backendPortBase: Number(s.backend_port_base || 1236), apiKey: String(s.api_key || ''), idleUnloadS: Number(s.idle_unload_s === undefined ? 600 : s.idle_unload_s), maxContext } };
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
                if (!String(s.api_key || '').trim()) s.api_key = crypto.randomBytes(24).toString('hex');
                changed.push('host=0.0.0.0 (yerel ag) + api_key (' + s.api_key.slice(0, 8) + '...)');
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
            send('[UPDATE] Upstream kod cekiliyor (git pull --ff-only)...');
            await runStreaming(['git', '-C', DIR, 'pull', '--ff-only'], send);
            ensureLayer();
            send('[UPDATE] Katman dosyalari dogrulandi.');
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

module.exports = { register, startGateway, stopGateway, CHOICES };
