/**
 * git-bootstrap.js — .git olmayan mevcut bir dizini canlı git reposuna çevirir.
 *
 * Kullanım senaryosu: Kurucu (installer) servis klasörlerini (openwebui/, searxng/)
 * .git olmadan taşır. Update butonu böyle bir klasöre rastladığında bu modül:
 *   git init → remote add → shallow fetch → checkout -f -B <branch> → upstream ayarla
 * Dizideki yerel veri dosyaları (upstream ağacında OLMAYAN dosyalar: openwebui.db,
 * vector_db/, uploads/, config.json vb.) korunur; yalnızca upstream tarafından
 * izlenen dosyalar güncel sürümle değiştirilir.
 *
 * Saf modül: electron import ETMEZ — unit test edilebilir.
 */
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30 * 60 * 1000; // 30 dk (ilk fetch yavaş bağlantıda uzun sürebilir)

/**
 * @param {object} opts
 * @param {string} opts.dir       Hedef dizin (var olmalı; .git içermemeli)
 * @param {string} opts.remoteUrl Uzak depo URL'si
 * @param {string} opts.branch    Dal adı (ör. 'main')
 * @param {(msg:string)=>void} [opts.log] İlerleme kaydedici
 * @returns {Promise<{success:boolean, hash?:string, alreadyRepo?:boolean, error?:string}>}
 */
async function bootstrapGitDir({ dir, remoteUrl, branch, log = () => {} }) {
    if (!dir || !fs.existsSync(dir)) {
        throw new Error('Directory does not exist: ' + dir);
    }
    if (fs.existsSync(path.join(dir, '.git'))) {
        return { success: true, alreadyRepo: true, hash: headHash(dir) };
    }

    const run = (...args) =>
        execFileAsync('git', args, { cwd: dir, timeout: GIT_TIMEOUT_MS, encoding: 'utf8' }).then(
            (r) => r.stdout.trim()
        );

    try {
        log('[BOOTSTRAP] Initializing git repository...');
        await run('init');

        try {
            await run('remote', 'add', 'origin', remoteUrl);
        } catch {
            await run('remote', 'set-url', 'origin', remoteUrl);
        }

        log('[BOOTSTRAP] Fetching branch "' + branch + '" (first time may take a few minutes)...');
        await run('fetch', '--depth', '1', 'origin', '+refs/heads/' + branch + ':refs/remotes/origin/' + branch);

        log('[BOOTSTRAP] Checking out "' + branch + '" (local data files are kept intact)...');
        await run('checkout', '-f', '-B', branch, 'refs/remotes/origin/' + branch);
        await run('branch', '--set-upstream-to', 'origin/' + branch, branch);

        const hash = headHash(dir);
        log('[BOOTSTRAP] Done (commit ' + hash + ').');
        return { success: true, hash };
    } catch (err) {
        const detail = (err && (err.stderr || err.message)) ? String(err.stderr || err.message).slice(-800) : String(err);
        return { success: false, error: detail };
    }
}

/** HEAD kısa hash'i (başarısızsa boş string). */
function headHash(repoDir) {
    try {
        const { execFileSync } = require('child_process');
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir, encoding: 'utf8', timeout: 10000 }).trim();
    } catch {
        return '';
    }
}

module.exports = { bootstrapGitDir, headHash };
