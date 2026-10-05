/**
 * LLM Runner AIO - Renderer Process
 * 
 * PyQt6 mainWindow.py + tab'larının Electron/JS karşılığı
 * - Tab switching logic
 * - Button event handlers
 * - Server start/stop controls
 * - Hardware detection display
 * - Model management UI
 * - Settings dialog
 * - Theme/font/language management
 */

// ============================================
// State Management
// ============================================
const state = {
    currentTab: 'system',
    theme: 'dark',
    fontSize: 13,
    language: 'en',
    config: {},
    languages: {},
    hardware: null,
    servers: {
        searxng: { running: false, port: 8080, host: '127.0.0.1' },
        openwebui: { running: false, port: 3000, host: '127.0.0.1' },
        llamacpp: { running: false, port: 1234, host: '127.0.0.1' },
        vane: { running: false, port: 3001, host: '127.0.0.1' },
        wan2gp: { running: false, port: 7860, host: '127.0.0.1', installed: false },
        strata: { running: false, port: 1235, host: '127.0.0.1', installed: false, eligible: false }
    },
    models: [],
    selectedModel: null
};

// ============================================
// Helper Functions
// ============================================

/**
 * Bayt boyutunu okunabilir formata cevirir
 * PyQt6'da: format_bytes() fonksiyonu
 */
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i >= sizes.length) return bytes + ' B';
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * HTML entity escape (markup bozulmasi/enjeksiyon korumasi)
 */
function escHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Sinirli es zamanlilik ile gorev calistirma havuzu (indirme concurrency cap)
 */
async function runWithConcurrency(items, limit, fn) {
    const results = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= items.length) break;
            try {
                results.push(await fn(items[i]));
            } catch (e) {
                results.push({ success: false, name: items[i].name, error: e.message });
            }
        }
    });
    await Promise.all(workers);
    return results;
}


// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[RENDERER] LLM Runner AIO initialized');

    try {
        // Load config
        await loadConfig();
    } catch (err) {
        console.error('[INIT] loadConfig failed:', err);
    }

    try {
        // Auto-detect hardware on startup (save to config)
        await autoDetectAndSaveHardware();
    } catch (err) {
        console.error('[INIT] autoDetectHardware failed:', err);
    }

    try {
        // Restore previous hardware selection from config
        await restorePreviousSelection();
    } catch (err) {
        console.error('[INIT] restorePreviousSelection failed:', err);
    }

    try {
        // Load language
        await loadLanguage(state.language);
    } catch (err) {
        console.error('[INIT] loadLanguage failed:', err);
    }

    try {
        // Apply theme
        applyTheme(state.theme);
    } catch (err) {
        console.error('[INIT] applyTheme failed:', err);
    }

    try {
        // Apply font size
        applyFontSize(state.fontSize);
    } catch (err) {
        console.error('[INIT] applyFontSize failed:', err);
    }

    try {
        // Load INI presets for llama.cpp — saved_ini'yi otomatik seç
        const savedIni = state.config?.selected_ini || null;
        if (savedIni) {
            console.log('[INI] Restoring saved INI:', savedIni);
        }
        await loadINIPresets(savedIni);
    } catch (err) {
        console.error('[INIT] loadINIPresets failed:', err);
    }

    try {
        // Setup event listeners
        setupEventListeners();
        console.log('[INIT] Event listeners attached successfully');
    } catch (err) {
        console.error('[INIT] setupEventListeners failed:', err);
    }
    
    // ✨ YENİ: Main process'ten mevcut server durumlarını senkronize et
    try {
        await syncInitialServerStates();
        console.log('[INIT] Server states synchronized with main process');
    } catch (err) {
        console.error('[INIT] Initial state sync failed:', err.message);
    }
    
    // Auto-start individual servers if enabled
    if (state.config.auto_start_servers) {
        console.log('[AUTO] Checking auto-start for individual servers...');
        const serverMap = [
            { key: 'auto_start_searxng', type: 'searxng' },
            { key: 'auto_start_openwebui', type: 'openwebui' },
            { key: 'auto_start_vane', type: 'vane' },
            { key: 'auto_start_llamacpp', type: 'llamacpp' },
            { key: 'auto_start_wan2gp', type: 'wan2gp' }
        ];
        
        for (const srv of serverMap) {
            if (state.config[srv.key]) {
                console.log(`[AUTO] Starting ${srv.type}...`);
                
                // Wan2GP: kurulmamissa otomatik baslatma yapma
                if (srv.type === 'wan2gp') {
                    try {
                        const st = await window.electronAPI.wan2gp.status();
                        if (!st.installed) {
                            console.log('[AUTO] Wan2GP not installed - skipping.');
                            continue;
                        }
                    } catch (e) {
                        console.log('[AUTO] Wan2GP status check failed - skipping.');
                        continue;
                    }
                }
                
                const portInput = document.getElementById(`${srv.type}-port`);
                const hostInput = document.getElementById(`${srv.type}-host`);
                const port = parseInt(portInput?.value || (srv.type === 'searxng' ? 8080 : srv.type === 'openwebui' ? 3000 : srv.type === 'vane' ? 3001 : srv.type === 'wan2gp' ? 7860 : 1234));
                const host = hostInput?.value || '127.0.0.1';
                
                // llama.cpp: ekran uzerindeki canli degerleri kullan (INI, CPU Threads, parallel, sleep-idle, max-model)
                const startOptions = srv.type === 'llamacpp'
                    ? buildLlamacppOptions({ port, host })
                    : { port, host };
                if (srv.type === 'llamacpp' && startOptions.iniPreset) {
                    console.log(`[AUTO] llama.cpp INI: ${startOptions.iniPreset}, threads: ${startOptions.threads}`);
                }
                
                const browserId = `btn-open-${srv.type}`;
                const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
                
                window.electronAPI.server.start(srv.type, startOptions).then(result => {
                    if (result.success) {
                        state.servers[srv.type].running = true;
                        state.servers[srv.type].port = port;
                        state.servers[srv.type].host = host;
                        updateServerStatus(srv.type, true);
                        updateBrowserButton(browserId, true, url);
                        appendToLog(srv.type, `${srv.type} started.`);
                    } else {
                        appendToLog(srv.type, `${srv.type} failed: ${result.error}`, true);
                    }
                });
            }
        }
    }
    
    
});

// ============================================
// Initial State Sync (Main Process → Renderer)
// ============================================
async function syncInitialServerStates() {
    try {
        // Main process'ten anlık durumu al
        const currentStates = await window.electronAPI.tray.getServerStates();
        
        console.log('[SYNC] Received server states from main:', JSON.stringify(currentStates));
        
        // Her sunucu için UI durumunu güncelle
        for (const [type, s] of Object.entries(currentStates)) {
            state.servers[type].running = s.running;
            state.servers[type].port = s.port || state.servers[type].port;
            
            // Butonları ve status textini güncelle
            updateServerStatus(type, s.running);
            
            if (s.running) {
                // Stop butonu aktif
                const stopBtn = document.getElementById(`btn-stop-${type}`);
                if (stopBtn) stopBtn.disabled = false;
                
                // Browser butanı aktif + URL güncelle
                const host = state.servers[type].host || '127.0.0.1';
                updateBrowserButton(
                    `btn-open-${type}`, 
                    true, 
                    `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${s.port}`
                );
                
                appendToLog(type, 'Synced — Running on port ' + s.port);
            }
        }
    } catch (err) {
        console.error('[SYNC] Failed to get initial states:', err.message);
        throw err;
    }
}

// ============================================
// Config & Language Loading
// ============================================
async function loadConfig() {
    try {
        state.config = await window.electronAPI.config.read();
        state.theme = state.config.theme || 'dark';
        state.fontSize = state.config.font_size || 13;
        state.language = state.config.language || 'en';
        
        console.log('[CONFIG] Loaded:', state.config);
    } catch (err) {
        console.error('[CONFIG] Failed to load:', err);
    }
}

// ============================================
// Auto Hardware Detection on Startup
// ============================================
const HW_CACHE_KEY = 'hw-detect-cache-v1';
const HW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readHwCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(HW_CACHE_KEY) || 'null');
        if (cached && typeof cached.ts === 'number' && Date.now() - cached.ts < HW_CACHE_TTL_MS) {
            return { gpuName: cached.gpuName, vramGb: cached.vramGb, ramGb: cached.ramGb, cpuName: cached.cpuName, iniMatch: cached.iniMatch };
        }
    } catch (e) { /* cache gecersiz */ }
    return null;
}

function writeHwCache(hw) {
    try {
        localStorage.setItem(HW_CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            gpuName: hw.gpuName,
            vramGb: hw.vramGb,
            ramGb: hw.ramGb,
            cpuName: hw.cpuName,
            iniMatch: hw.iniMatch
        }));
    } catch (e) { /* storage dolu olabilir */ }
}

async function autoDetectAndSaveHardware() {
    try {
        // HAT-22: Her acilista donanim tespiti tekrarlaniyordu — 24s cache kullan
        // (manuel Detect butonu her zaman taze tespit yapar)
        const cached = readHwCache();
        if (cached) {
            console.log('[HARDWARE] Cached detection used (<24h) — skipping full detect');
            state.hardware = cached;
            updateHardwareDisplay(cached);
            const cfgFromCache = { ...state.config };
            cfgFromCache.vram_gb = cached.vramGb;
            cfgFromCache.ram_gb = cached.ramGb;
            cfgFromCache.gpu_name = cached.gpuName || '';
            cfgFromCache.cpu_name = cached.cpuName || '';
            if (cached.iniMatch) cfgFromCache.selected_ini = cached.iniMatch;
            await window.electronAPI.config.write(cfgFromCache);
            state.config = cfgFromCache;
            return cached;
        }

        console.log('[HARDWARE] Auto-detecting hardware on startup...');
        const hw = await window.electronAPI.hardware.detect();
        writeHwCache(hw);
        
        // Save to config immediately
        const updatedConfig = { ...state.config };
        updatedConfig.vram_gb = hw.vramGb;
        updatedConfig.ram_gb = hw.ramGb;
        updatedConfig.gpu_name = hw.gpuName || '';
        updatedConfig.cpu_name = hw.cpuName || '';
        
        if (hw.iniMatch) {
            updatedConfig.selected_ini = hw.iniMatch;
        }
        
        await window.electronAPI.config.write(updatedConfig);
        state.config = updatedConfig;
        
        console.log('[HARDWARE] Saved to config:', {
            vram: hw.vramGb,
            ram: hw.ramGb,
            gpu: hw.gpuName,
            ini: hw.iniMatch
        });
        
        return hw;
    } catch (err) {
        console.error('[HARDWARE] Auto-detect failed:', err.message);
        return null;
    }
}

// ============================================
// Restore Previous Selection from Config
// ============================================
async function restorePreviousSelection() {
    try {
        console.log('[RESTORE] Restoring previous settings from config...');
        
        // Restore server ports and hosts
        const portFields = [
            { key: 'searxng_port', id: 'searxng-port', defaultVal: 8080 },
            { key: 'openwebui_port', id: 'openwebui-port', defaultVal: 3000 },
            { key: 'llamacpp_port', id: 'llamacpp-port', defaultVal: 1234 },
            { key: 'vane_port', id: 'vane-port', defaultVal: 3001 },
            { key: 'wan2gp_port', id: 'wan2gp-port', defaultVal: 7860 }
        ];
        
        for (const field of portFields) {
            const el = document.getElementById(field.id);
            if (el) {
                el.value = state.config[field.key] ?? field.defaultVal;
            }
        }
        
        // Restore server hosts
        const hostFields = [
            { key: 'searxng_host', id: 'searxng-host', defaultVal: '127.0.0.1' },
            { key: 'openwebui_host', id: 'openwebui-host', defaultVal: '127.0.0.1' },
            { key: 'llamacpp_host', id: 'llamacpp-host', defaultVal: '127.0.0.1' },
            { key: 'vane_host', id: 'vane-host', defaultVal: '127.0.0.1' },
            { key: 'wan2gp_host', id: 'wan2gp-host', defaultVal: '127.0.0.1' }
        ];
        
        for (const field of hostFields) {
            const el = document.getElementById(field.id);
            if (el) {
                el.value = state.config[field.key] ?? field.defaultVal;
            }
        }
        
        // Restore llama.cpp params (CPU Threads, Max User, Sleep Idle, Max Model)
        const llamaParamFields = [
            { key: 'llamacpp_threads', id: 'llamacpp-threads', defaultVal: 10 },
            { key: 'llamacpp_parallel', id: 'llamacpp-parallel', defaultVal: 1 },
            { key: 'llamacpp_sleep_idle', id: 'llamacpp-sleep-idle', defaultVal: 1000 },
            { key: 'llamacpp_max_model', id: 'llamacpp-max-model', defaultVal: 1 }
        ];
        
        for (const field of llamaParamFields) {
            const el = document.getElementById(field.id);
            if (el) {
                el.value = state.config[field.key] ?? field.defaultVal;
            }
        }
        
        // Restore auto-start checkboxes
        const autoStartChecks = [
            { key: 'auto_start_servers', id: 'cb-auto-server-autostart' },
            { key: 'auto_start_searxng', id: 'cb-auto-searxng' },
            { key: 'auto_start_openwebui', id: 'cb-auto-openwebui' },
            { key: 'auto_start_vane', id: 'cb-auto-vane' },
            { key: 'auto_start_llamacpp', id: 'cb-auto-llamacpp' },
            { key: 'auto_start_wan2gp', id: 'cb-auto-wan2gp' }
        ];
        
        for (const check of autoStartChecks) {
            const el = document.getElementById(check.id);
            if (el) {
                el.checked = !!state.config[check.key];
            }
        }
        
        // Restore language selector
        const langSelect = document.getElementById('language-select');
        if (langSelect) {
            langSelect.value = state.language || 'en';
        }
        
        // Restore start with windows
        const startWithWindows = document.getElementById('cb-start-windows');
        if (startWithWindows) {
            startWithWindows.checked = !!state.config.start_with_windows;
        }
        
        // Update hardware display if already detected
        if (state.hardware) {
            updateHardwareDisplay(state.hardware);
        }
        
        console.log('[RESTORE] Settings restored successfully');
    } catch (err) {
        console.error('[RESTORE] Failed to restore settings:', err.message);
    }
}

// ============================================
// Save All Current Settings
// ============================================
async function saveAllSettings() {
    try {
        const configToSave = {
            ...state.config,
            theme: state.theme,
            font_size: state.fontSize,
            language: state.language,
            searxng_port: parseInt(document.getElementById('searxng-port')?.value) || 8080,
            openwebui_port: parseInt(document.getElementById('openwebui-port')?.value) || 3000,
            llamacpp_port: parseInt(document.getElementById('llamacpp-port')?.value) || 1234,
            vane_port: parseInt(document.getElementById('vane-port')?.value) || 3001,
            wan2gp_port: parseInt(document.getElementById('wan2gp-port')?.value) || 7860,
            wan2gp_preset: document.getElementById('wan2gp-preset')?.value || '',
            searxng_host: document.getElementById('searxng-host')?.value || '127.0.0.1',
            openwebui_host: document.getElementById('openwebui-host')?.value || '127.0.0.1',
            llamacpp_host: document.getElementById('llamacpp-host')?.value || '127.0.0.1',
            vane_host: document.getElementById('vane-host')?.value || '127.0.0.1',
            wan2gp_host: document.getElementById('wan2gp-host')?.value || '127.0.0.1',
            llamacpp_threads: parseInt(document.getElementById('llamacpp-threads')?.value) || 10,
            llamacpp_parallel: parseInt(document.getElementById('llamacpp-parallel')?.value) || 1,
            llamacpp_sleep_idle: parseInt(document.getElementById('llamacpp-sleep-idle')?.value) || 1000,
            llamacpp_max_model: parseInt(document.getElementById('llamacpp-max-model')?.value) || 1,
            selected_ini: document.getElementById('ini-select')?.value || '',
            auto_start_servers: !!document.getElementById('cb-auto-server-autostart')?.checked,
            auto_start_searxng: !!document.getElementById('cb-auto-searxng')?.checked,
            auto_start_openwebui: !!document.getElementById('cb-auto-openwebui')?.checked,
            auto_start_vane: !!document.getElementById('cb-auto-vane')?.checked,
            auto_start_llamacpp: !!document.getElementById('cb-auto-llamacpp')?.checked,
            auto_start_wan2gp: !!document.getElementById('cb-auto-wan2gp')?.checked,
            start_with_windows: !!document.getElementById('cb-start-windows')?.checked
        };
        
        await window.electronAPI.config.write(configToSave);
        state.config = configToSave;
        
        // Registry islemi (start_with_windows degisdi mi?)
        const wasEnabled = state.config._prev_start_with_windows || false;
        const isEnabled = !!configToSave.start_with_windows;
        
        if (isEnabled && !wasEnabled) {
            try {
                await window.electronAPI.autostart.enable();
                console.log('[AUTOSTART] Enabled via registry');
            } catch (regErr) {
                console.error('[AUTOSTART] Enable failed:', regErr.message);
            }
        } else if (!isEnabled && wasEnabled) {
            try {
                await window.electronAPI.autostart.disable();
                console.log('[AUTOSTART] Disabled via registry');
            } catch (regErr) {
                console.error('[AUTOSTART] Disable failed:', regErr.message);
            }
        }
        
        state.config._prev_start_with_windows = isEnabled;
        
        console.log('[SETTINGS] All settings saved to config.json');
        return true;
    } catch (err) {
        console.error('[SETTINGS] Failed to save settings:', err.message);
        return false;
    }
}

// Helper: Update hardware display in UI
function updateHardwareDisplay(hw) {
    const gpuEl = document.getElementById('gpu-name');
    if (gpuEl) gpuEl.textContent = hw.gpuName || 'Not Detected';
    
    const vramEl = document.getElementById('vram-info');
    if (vramEl) vramEl.textContent = hw.vramGb > 0 ? `${hw.vramGb.toFixed(1)} GB` : '--';
    
    const ramEl = document.getElementById('ram-info');
    if (ramEl) ramEl.textContent = hw.ramGb > 0 ? `${hw.ramGb.toFixed(1)} GB` : '--';
    
    const cpuEl = document.getElementById('cpu-info');
    if (cpuEl) cpuEl.textContent = hw.cpuName || '--';
    
    const iniInfo = document.getElementById('ini-info');
    if (hw.iniMatch && iniInfo) {
        iniInfo.textContent = `Config: ${hw.iniMatch}`;
    }
}

// PyQt6: _update_lang() — Dil degisikliginde UI metinlerini güncelle
function updateModelsTabLang() {
    const strings = state.languages;
    
    // Refresh button text
    const refreshBtn = document.getElementById('btn-refresh-models');
    if (refreshBtn && strings.btn_refresh) {
        refreshBtn.textContent = strings.btn_refresh;
    }
    
    // Delete button text
    const deleteBtn = document.getElementById('btn-delete-selected');
    if (deleteBtn && strings.btn_delete) {
        deleteBtn.textContent = strings.btn_delete;
    }
}

async function loadLanguage(langCode) {
    try {
        state.languages = await window.electronAPI.lang.read(langCode);
        state.language = langCode;
        
        // Update all translatable elements
        updateUIText();
        
        // PyQt6 _update_lang() karsiligi — Models tab metinlerini de guncelle
        updateModelsTabLang();
        
        console.log('[LANG] Loaded:', langCode);
    } catch (err) {
        console.error('[LANG] Failed to load:', err);
    }
}

function updateUIText() {
    const s = state.languages || {};
    
    // 1) App title
    const appTitle = document.getElementById('app-title');
    if (appTitle && s.app_title) appTitle.textContent = s.app_title;
    
    // NOT: Tab butonlari ve panel basliklari artik HTML'deki data-i18n
    // attribute'lari uzerinden cevriliyor (pozisyon tabanli esleme kaldirildi - HAT-30).
    
    // 2) Fieldset legends (only those with data-i18n)
    document.querySelectorAll('fieldset legend[data-i18n]').forEach(leg => {
        const key = leg.getAttribute('data-i18n');
        if (s[key]) leg.textContent = s[key];
    });
    
    // 4b) Fieldset span children (new pattern for inline i18n)
    document.querySelectorAll('fieldset > span[data-i18n]').forEach(span => {
        const key = span.getAttribute('data-i18n');
        if (s[key]) span.textContent = s[key];
    });
    
    // 5) [data-i18n] attributes — global translation
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (s[key]) el.textContent = s[key];
    });
    
    // 6) Select options
    document.querySelectorAll('select option[value="127.0.0.1"]').forEach(opt => {
        if (s.opt_this_pc) opt.textContent = s.opt_this_pc;
    });
    document.querySelectorAll('select option[value="0.0.0.0"]').forEach(opt => {
        if (s.opt_local_network) opt.textContent = s.opt_local_network;
    });
    
    // 6b) Language selector options
    const langSelect = document.getElementById('language-select');
    if (langSelect && s.lang_en) {
        const langOptions = [
            { value: 'en', key: 'lang_en' },
            { value: 'tr', key: 'lang_tr' },
            { value: 'de', key: 'lang_de' },
            { value: 'es', key: 'lang_es' },
            { value: 'fr', key: 'lang_fr' },
            { value: 'ja', key: 'lang_ja' },
            { value: 'pt', key: 'lang_pt' },
            { value: 'zh', key: 'lang_zh' }
        ];
        langSelect.querySelectorAll('option').forEach((opt, i) => {
            if (langOptions[i] && s[langOptions[i].key]) {
                opt.textContent = s[langOptions[i].key];
            }
        });
    }
    
    // 7) Buttons by class
    document.querySelectorAll('.start-btn').forEach(btn => {
        if (s.btn_start) btn.textContent = s.btn_start;
    });
    document.querySelectorAll('.stop-btn').forEach(btn => {
        if (s.btn_stop) btn.textContent = s.btn_stop;
    });
    document.querySelectorAll('.browser-btn').forEach(btn => {
        if (s.btn_open_browser) btn.textContent = s.btn_open_browser;
    });
    
    // 8) Global action buttons
    const startAll = document.getElementById('btn-start-all');
    if (startAll && s.btn_start_all) startAll.textContent = s.btn_start_all;
    const stopAll = document.getElementById('btn-stop-all');
    if (stopAll && s.btn_stop_all) stopAll.textContent = s.btn_stop_all;
    
    // 9) Settings buttons
    const supportBtn = document.getElementById('support-btn');
    if (supportBtn && s.btn_support) supportBtn.textContent = s.btn_support;
    const closeSettings = document.getElementById('close-settings');
    if (closeSettings && s.btn_close_settings) closeSettings.title = s.btn_close_settings;
    const saveAdvisor = document.getElementById('btn-save-advisor');
    if (saveAdvisor && s.btn_save_advisor) saveAdvisor.textContent = s.btn_save_advisor;
    
    // 10) Log toggle buttons
    document.querySelectorAll('.log-toggle').forEach(btn => {
        if (s.btn_logs) btn.textContent = s.btn_logs;
    });
    
    // 11) Status labels
    document.querySelectorAll('.status-text-label').forEach(st => {
        if (s.status_stopped) st.textContent = s.status_stopped;
    });
    
    // 12) PiCoding section
    const detectProject = document.getElementById('btn-detect-project');
    if (detectProject && s.detect_project_btn) detectProject.textContent = s.detect_project_btn;
    const addToPath = document.getElementById('btn-add-to-path');
    if (addToPath && s.add_path_btn) addToPath.textContent = s.add_path_btn;
    
    // 13) Models tab
    const refreshModels = document.getElementById('btn-refresh-models');
    if (refreshModels && s.refresh_models_btn) refreshModels.textContent = s.refresh_models_btn;
    const deleteSelected = document.getElementById('btn-delete-selected');
    if (deleteSelected && s.delete_selected_btn) deleteSelected.textContent = s.delete_selected_btn;
    const downloadAll = document.getElementById('btn-download-all');
    if (downloadAll && s.download_all_btn) downloadAll.textContent = s.download_all_btn;
    
    // 14) Open Function Folder
    const openFuncBtn = document.getElementById('btn-open-function-folder');
    if (openFuncBtn && s.open_function_folder) openFuncBtn.textContent = s.open_function_folder;
    
    // 14b) Load Database
    const loadDb = document.getElementById('btn-load-database');
    if (loadDb && s.btn_load_database) loadDb.textContent = s.btn_load_database;
    
    // 14b) Config toggle buttons (her server icin)
    const configBtnIds = ['btn-hide-vane-config', 'btn-hide-searxng-config', 'btn-hide-openwebui-config', 'btn-hide-llamacpp-config'];
    configBtnIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn && s.hide_config_btn) btn.textContent = s.hide_config_btn;
    });
    
    // 15) Checkbox labels (span IDs)
    const lblStartWindows = document.getElementById('lbl-start-windows');
    if (lblStartWindows && s.cb_start_windows) lblStartWindows.textContent = s.cb_start_windows;
    const lblAutoServers = document.getElementById('lbl-auto-servers');
    if (lblAutoServers && s.cb_auto_servers) lblAutoServers.textContent = s.cb_auto_servers;
    
    // 15b) Server auto-start checkboxes
    const serverLabels = [
        { id: 'section_searxng', key: 'section_searxng' },
        { id: 'section_openwebui', key: 'section_openwebui' },
        { id: 'section_vane', key: 'section_vane' },
        { id: 'section_llamacpp', key: 'section_llamacpp' },
        { id: 'section_wan2gp', key: 'section_wan2gp' }
    ];
    document.querySelectorAll('.server-checkboxes label span').forEach((label, i) => {
        if (s[serverLabels[i].key]) label.textContent = s[serverLabels[i].key];
    });
    
    
    // 17) Advisor labels
    const lblAdvisorUrl = document.getElementById('lbl-advisor-url');
    if (lblAdvisorUrl && s.advisor_url_label) lblAdvisorUrl.textContent = s.advisor_url_label;
    const lblAdvisorKey = document.getElementById('lbl-advisor-key');
    if (lblAdvisorKey && s.advisor_key_label) lblAdvisorKey.textContent = s.advisor_key_label;
    const lblAdvisorModel = document.getElementById('lbl-advisor-model');
    if (lblAdvisorModel && s.advisor_model_label) lblAdvisorModel.textContent = s.advisor_model_label;
    
    // 18) Helper text
    const funcFolderHelp = document.getElementById('function-folder-help');
    if (funcFolderHelp && s.function_folder_help) funcFolderHelp.textContent = s.function_folder_help;
    
    const loadDbHelp = document.getElementById('load-database-help');
    if (loadDbHelp && s.load_database_help) loadDbHelp.textContent = s.load_database_help;
    
    // 19) Instructions content (large text block)
    const instrContent = document.getElementById('instructions-content');
    if (instrContent && s.pi_instructions) {
        instrContent.textContent = s.pi_instructions;
    }
    
    // 20) Description texts by ID
    const descIds = ['desc-searxng', 'desc-openwebui', 'desc-llamacpp', 'desc-vane'];
    const descKeys = ['desc_searxng', 'desc_openwebui', 'desc_llamacpp', 'desc_vane'];
    descIds.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el && s[descKeys[i]]) el.textContent = s[descKeys[i]];
    });
}

// ============================================
// Theme Management
// ============================================
function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    
    // Save to config
    window.electronAPI.config.write({ ...state.config, theme });
}

// ============================================
// Font Size Management
// ============================================
function applyFontSize(size) {
    state.fontSize = Math.max(10, Math.min(20, size));
    document.documentElement.style.setProperty('--font-size', `${state.fontSize}px`);
    
    // Update font size displays
    const displays = [
        document.getElementById('settings-font-size')
    ];
    
    displays.forEach(display => {
        if (display) {
            display.textContent = `${state.fontSize}px`;
        }
    });
    
    // Save to config
    window.electronAPI.config.write({ ...state.config, font_size: state.fontSize });
}

// ============================================
// Tab Switching Logic
// ============================================
const HOME_SITE_URL = 'https://www.aihublocal.com/llm/configs';

function switchTab(tabName) {
    // Hide all panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    // Deactivate all tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected panel
    const targetPanel = document.getElementById(`tab-${tabName}`);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
    
    // Activate selected tab button
    const targetBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (targetBtn) {
        targetBtn.classList.add('active');
    }
    
    // aihublocal sekmesi: siteyi ilk acilisinda tembel yukle
    if (tabName === 'home') {
        const frame = document.getElementById('home-site-frame');
        if (frame && !frame.getAttribute('src')) {
            frame.src = HOME_SITE_URL;
        }
    }
    
    state.currentTab = tabName;
    
    console.log('[TAB] Switched to:', tabName);
}

// ============================================
// Event Listeners Setup
// ============================================
function setupEventListeners() {
    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchTab(tab);
        });
    });
    
    // Window controls (Minimize/Maximize/Close)
    const btnMinimize = document.getElementById('btn-minimize');
    if (btnMinimize) {
        btnMinimize.addEventListener('click', () => {
            window.electronAPI.window.minimize();
        });
    }
    
    const btnMaximize = document.getElementById('btn-maximize');
    if (btnMaximize) {
        btnMaximize.addEventListener('click', () => {
            window.electronAPI.window.maximize();
        });
    }
    
    const btnClose = document.getElementById('btn-close');
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            window.electronAPI.window.close();
        });
    }
    
    // Settings modal
    setupSettingsModal();
    
    // Hardware detection
    const detectBtn = document.getElementById('btn-detect');
    if (detectBtn) {
        detectBtn.addEventListener('click', detectHardware);
    }
    
    // Server controls
    setupServerControls();
    
    // Wan2GP: kurulum durumu + Setup butonu + kurulum log akisi
    refreshWan2gpStatus();
    const wgpSetupBtn = document.getElementById('btn-wan2gp-setup');
    if (wgpSetupBtn) wgpSetupBtn.addEventListener('click', () => runWan2gpSetup());
    const wgpUpdateBtn = document.getElementById('btn-wan2gp-update');
    if (wgpUpdateBtn) wgpUpdateBtn.addEventListener('click', () => runWan2gpUpdate());
    window.electronAPI.wan2gp.onSetupLog((data) => {
        appendToLog('wan2gp', data.message);
    });

    // Strata: durum + kurulum/kalibrasyon/guncelleme/config butonlari + log akisi
    refreshStrataStatus();
    const stInstallBtn = document.getElementById('btn-strata-install');
    if (stInstallBtn) stInstallBtn.addEventListener('click', () => runStrataSetup());
    const stCalBtn = document.getElementById('btn-strata-calibrate');
    if (stCalBtn) stCalBtn.addEventListener('click', () => runStrataCalibrate());
    const stUpdBtn = document.getElementById('btn-strata-update');
    if (stUpdBtn) stUpdBtn.addEventListener('click', () => runStrataUpdate());
    const stCfgSave = document.getElementById('btn-strata-config-save');
    if (stCfgSave) stCfgSave.addEventListener('click', () => saveStrataConfig());
    window.electronAPI.strata.onSetupLog((data) => appendToLog('strata', data.message));
    
    // Model management
    setupModelControls();
    
    // PiCoding controls
    setupPicodingControls();
    
    // Support button
    const supportBtn = document.getElementById('support-btn');
    if (supportBtn) {
        supportBtn.addEventListener('click', () => {
            window.electronAPI.shell.openExternal('https://ko-fi.com/vincespeed');
        });
    }
    
    // INI preset callbacks
    setupINICallbacks();
    
    // System Detection model controls
    setupSystemModelControls();
    
    // GUI model management (Add/Edit/Delete active INI + URL health)
    setupModelEditorModal();
    
    // Server log/event listeners (yeni stil - events API)
    // Bunlar setupServerControls() icersinde de tanimlanmis, oraya bakin.
    
    // Global download progress (toplam)
    window.electronAPI.model.onProgress((data) => {
        if (data.taskId !== undefined) {
            updatePerModelProgress(data);
        } else {
            updateDownloadProgress(data.percent, data.downloaded, data.total);
        }
    });
}

// ============================================
// Settings Modal
// ============================================
function setupSettingsModal() {
    const settingsBtn = document.getElementById('settings-btn');
    const closeBtn = document.getElementById('close-settings');
    const cancelBtn = document.getElementById('cancel-settings');
    const applyBtn = document.getElementById('apply-settings');
    const modal = document.getElementById('settings-modal');
    const overlay = document.querySelector('.modal-overlay');
    
    // Open settings
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            modal.classList.remove('hidden');
            populateSettingsForm();
        });
    }
    
    // Close modal
    const closeModal = () => {
        modal.classList.add('hidden');
    };
    
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) overlay.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    
    // Theme toggle buttons in settings
    const themeDarkBtn = document.getElementById('theme-toggle-settings');
    const themeLightBtn = document.getElementById('theme-toggle-settings-light');
    
    if (themeDarkBtn) {
        themeDarkBtn.addEventListener('click', () => {
            applyTheme('dark');
            themeDarkBtn.classList.add('active');
            themeLightBtn.classList.remove('active');
        });
    }
    
    if (themeLightBtn) {
        themeLightBtn.addEventListener('click', () => {
            applyTheme('light');
            themeLightBtn.classList.add('active');
            themeDarkBtn.classList.remove('active');
        });
    }
    
    // Apply settings — now uses unified saveAllSettings()
    if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
            const newLang = document.getElementById('language-select')?.value;
            
            // Once state.language guncelle (saveAllSettings bunu kullanacak!)
            if (newLang) {
                state.language = newLang;
            }
            
            // Save all current settings (ports, hosts, checkboxes, theme, etc.)
            await saveAllSettings();
            
            // Dil degisikligi varsa aninda uygula
            if (newLang) {
                await loadLanguage(newLang);
            }
            
            closeModal();
            showNotification('Success', 'Settings applied successfully.');
        });
    }
}

function populateSettingsForm() {
    // Set theme toggle buttons
    const themeDarkBtn = document.getElementById('theme-toggle-settings');
    const themeLightBtn = document.getElementById('theme-toggle-settings-light');
    if (themeDarkBtn && themeLightBtn) {
        if (state.theme === 'dark') {
            themeDarkBtn.classList.add('active');
            themeLightBtn.classList.remove('active');
        } else {
            themeLightBtn.classList.add('active');
            themeDarkBtn.classList.remove('active');
        }
    }
    
    // Set font size display
    document.getElementById('settings-font-size').textContent = `${state.fontSize}px`;
    
    // Set language
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.value = state.language;
    }
    
    // Set checkboxes — config üzerinden sync set (async check UI'yi bozar)
    const startWithWindows = document.getElementById('cb-start-windows');
    if (startWithWindows) {
        startWithWindows.checked = !!state.config.start_with_windows;
    }
    
    const autoStart = document.getElementById('cb-auto-server-autostart');
    if (autoStart) {
        autoStart.checked = state.config.auto_start_servers || false;
    }
    
    // Set individual server checkboxes
    const serverCbs = [
        { id: 'cb-auto-searxng', key: 'auto_start_searxng' },
        { id: 'cb-auto-openwebui', key: 'auto_start_openwebui' },
        { id: 'cb-auto-vane', key: 'auto_start_vane' },
        { id: 'cb-auto-llamacpp', key: 'auto_start_llamacpp' },
        { id: 'cb-auto-wan2gp', key: 'auto_start_wan2gp' }
    ];
    serverCbs.forEach(cb => {
        const el = document.getElementById(cb.id);
        if (el) {
            el.checked = state.config[cb.key] || false;
        }
    });
}

// Settings font controls
document.getElementById('settings-font-increase')?.addEventListener('click', () => {
    applyFontSize(state.fontSize + 1);
    document.getElementById('settings-font-size').textContent = `${state.fontSize}px`;
});

document.getElementById('settings-font-decrease')?.addEventListener('click', () => {
    applyFontSize(state.fontSize - 1);
    document.getElementById('settings-font-size').textContent = `${state.fontSize}px`;
});

// ============================================
// Auto-save on Server Port/Host Changes
// ============================================
const autoSaveInputs = [
    'searxng-port', 'openwebui-port', 'llamacpp-port', 'vane-port', 'wan2gp-port',
    'searxng-host', 'openwebui-host', 'llamacpp-host', 'vane-host', 'wan2gp-host'
];

autoSaveInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        // Yalnizca 'change' (Enter/blur) uzerine kaydet — her tus vurusunda config yazma stormu olmasin
        el.addEventListener('change', () => {
            saveAllSettings();
        });
    }
});

// INI select auto-save
const iniSelectEl = document.getElementById('ini-select');
if (iniSelectEl) {
    iniSelectEl.addEventListener('change', () => {
        saveAllSettings();
    });
}

// Start with Windows auto-save
const cbStartWindows = document.getElementById('cb-start-windows');
if (cbStartWindows) {
    cbStartWindows.addEventListener('change', () => {
        saveAllSettings();
    });
}

// ============================================
// Hardware Detection
// ============================================
async function detectHardware() {
    try {
        const hw = await window.electronAPI.hardware.detect();
        state.hardware = hw;
        writeHwCache(hw);
        
        // Update UI — null kontrolleri ile
        updateHardwareDisplay(hw);
        
        // Console log
        console.log(`[Hardware] GPU: ${hw.gpuName || 'None'}, VRAM: ${hw.vramGb}GB, RAM: ${hw.ramGb}GB`);
        
        // INI eşleştirme debug
        console.log('[RENDERER] Hardware detect result:', hw);
        console.log('[RENDERER] iniMatch:', hw.iniMatch);
        
        // INI Presetleri yeniden tara ve otomatik eşleştir
        await refreshINIPresets(hw.iniMatch);
        
        // Auto-save hardware info to config
        const updatedConfig = { ...state.config };
        updatedConfig.vram_gb = hw.vramGb;
        updatedConfig.ram_gb = hw.ramGb;
        updatedConfig.gpu_name = hw.gpuName || '';
        updatedConfig.cpu_name = hw.cpuName || '';
        
        if (hw.iniMatch) {
            updatedConfig.selected_ini = hw.iniMatch;
            const iniInfo = document.getElementById('ini-info');
            if (iniInfo) {
                iniInfo.textContent = `Config: ${hw.iniMatch}`;
            }
        }
        
                // CPU Threads otomatik hesaplama: mantisal cekirdek sayisi - 2 (orn. 22 -> 20)
        const threadsField = document.getElementById('llamacpp-threads');
        if (threadsField && hw.cpuThreads) {
            const suggestedThreads = Math.max(1, hw.cpuThreads - 2);
            threadsField.value = suggestedThreads;
            updatedConfig.llamacpp_threads = suggestedThreads;
            appendToLog('system', `llama.cpp CPU Threads auto-set: ${suggestedThreads} (${hw.cpuThreads} logical cores - 2)`);
        }
        await window.electronAPI.config.write(updatedConfig);
        state.config = updatedConfig;
        
        showNotification('Detection Complete', `Found: ${hw.gpuName || 'No GPU'} (${hw.vramGb}GB VRAM)`);
    } catch (err) {
        console.error('[RENDERER] detectHardware error:', err);
        appendToLog('system', `Detection failed: ${err.message}`, true);
        showNotification('Error', `Hardware detection failed: ${err.message}`);
    }
}

// ============================================
// Server Controls
// ============================================
let wan2gpSetupInFlight = false;

/**
 * Wan2GP kurulum durumunu sorgular ve UI'ya yansitir.
 */
async function refreshWan2gpStatus() {
    try {
        const st = await window.electronAPI.wan2gp.status();
        state.servers.wan2gp.installed = !!st.installed;

        const sel = document.getElementById('wan2gp-preset');
        const startBtn = document.getElementById('btn-start-wan2gp');
        const setupBtn = document.getElementById('btn-wan2gp-setup');
        const stateSpan = document.getElementById('wan2gp-setup-state');
        if (!sel) return;

        // Preset listesini doldur
        const saved = state.config.wan2gp_preset;
        sel.innerHTML = '';
        for (const p of st.presets) {
            const opt = document.createElement('option');
            opt.value = p.path;
            opt.textContent = p.brand.toUpperCase() + ' / ' + p.gen;
            sel.appendChild(opt);
        }
        const preferred = saved || st.recommended;
        if (preferred && st.presets.some(p => p.path === preferred)) {
            sel.value = preferred;
        } else if (st.presets.length > 0) {
            sel.selectedIndex = 0;
        }

        // Start butonu ancak kurulum tamamsa aktif
        if (startBtn) startBtn.disabled = !st.installed || state.servers.wan2gp.running;

        // Setup butonu metni/durumu
        if (setupBtn) {
            setupBtn.disabled = !!st.setupRunning;
            setupBtn.textContent = st.installed ? '\ud83d\udce6 Re-setup' : '\ud83d\udce6 Setup';
        }
        
        // Update butonu: repo klonlanmis ve servis calismiyorsa aktif
        const updateBtn = document.getElementById('btn-wan2gp-update');
        if (updateBtn) updateBtn.disabled = !st.cloned || state.servers.wan2gp.running;
        if (stateSpan) {
            stateSpan.textContent = st.installed ? '\u2713 Installed' : (st.cloned ? '\u23f3 Partially set up' : 'Not installed');
        }
    } catch (err) {
        console.error('[WAN2GP] Status query failed:', err.message);
    }
}

/**
 * Wan2GP kurulumu calistirir (clone + ayri venv + pip install).
 */
async function runWan2gpSetup() {
    if (wan2gpSetupInFlight) return;
    const sel = document.getElementById('wan2gp-preset');
    const preset = sel ? sel.value : null;
    if (!preset) {
        showNotification('Warning', 'No GPU preset selected.', 'warning');
        return;
    }

    const st = await window.electronAPI.wan2gp.status().catch(() => null);
    let prereqText = '';
    if (st && Array.isArray(st.prereqs) && st.prereqs.length > 0) {
        prereqText = '\n\nPrerequisites (' + preset + '):\n' + st.prereqs.join('\n');
    }
    const diskNote = '\n\n\u26a0 This downloads several GB of packages and may take 10-30 minutes.';
    const confirmed = await window.electronAPI.notification.confirm(
        'Wan2GP Setup',
        'Install Wan2GP for "' + preset + '"?\n\nThe repository will be cloned into Wan2GP/ and a dedicated virtual environment (venvs/wan2gp) will be created.' + prereqText + diskNote
    );
    if (!confirmed) return;

    wan2gpSetupInFlight = true;
    const setupBtn = document.getElementById('btn-wan2gp-setup');
    if (setupBtn) setupBtn.disabled = true;
    appendToLog('wan2gp', '[SETUP] Starting...');

    const result = await window.electronAPI.wan2gp.setup({ preset });
    wan2gpSetupInFlight = false;
    if (result.success) {
        appendToLog('wan2gp', '[SETUP] Complete.');
        showNotification('Info', 'Wan2GP setup complete.', 'info');
    } else {
        appendToLog('wan2gp', '[SETUP] FAILED: ' + result.error, true);
        showNotification('Error', 'Wan2GP setup failed: ' + result.error, 'error');
    }
    await refreshWan2gpStatus();
}

let wan2gpUpdateInFlight = false;

/**
 * Wan2GP reposunu son surume gunceller (git pull --ff-only).
 */
async function runWan2gpUpdate() {
    if (wan2gpUpdateInFlight) return;
    const updateBtn = document.getElementById('btn-wan2gp-update');
    wan2gpUpdateInFlight = true;
    if (updateBtn) updateBtn.disabled = true;
    appendToLog('wan2gp', '[UPDATE] Starting...');

    const result = await window.electronAPI.wan2gp.update().catch(e => ({ success: false, error: e.message }));
    wan2gpUpdateInFlight = false;
    if (result.success) {
        appendToLog('wan2gp', '[UPDATE] Complete.');
        showNotification('Success', 'Wan2GP repository updated.');
    } else {
        appendToLog('wan2gp', '[UPDATE] FAILED: ' + result.error, true);
        showNotification('Error', 'Wan2GP update failed: ' + result.error, 'error');
    }
    await refreshWan2gpStatus();
}

// ============================================
// Strata (Qwen3.8-Flash-Next coklu-model gateway)
// ============================================
let strataBusyInFlight = false;

/**
 * Strata durumunu sorgular: uygunluk (RAM>=48 & VRAM>=12), kurulum, config alanlari.
 */
async function refreshStrataStatus() {
    try {
        const st = await window.electronAPI.strata.status();
        state.servers.strata.installed = !!st.installed;
        state.servers.strata.eligible = !!st.eligible;

        const installSec = document.getElementById('strata-install-section');
        if (installSec) installSec.classList.toggle('hidden', !st.eligible || st.configured);
        const serverFs = document.getElementById('strata-server-fieldset');
        if (serverFs) serverFs.classList.toggle('hidden', !(st.eligible && st.repoCloned));

        const sel = document.getElementById('strata-model-select');
        if (sel && !sel.options.length && Array.isArray(st.choices)) {
            sel.innerHTML = '';
            for (const c of st.choices) {
                const opt = document.createElement('option');
                opt.value = c.size;
                opt.textContent = c.label + ' — ~' + c.downloadGb + ' GB' + (c.fits ? '' : ' (RAM yetersiz)');
                if (!c.fits) opt.disabled = true;
                sel.appendChild(opt);
            }
            const firstFit = st.choices.find(c => c.fits);
            if (firstFit) sel.value = firstFit.size;
        }

        const installBtn = document.getElementById('btn-strata-install');
        if (installBtn) installBtn.disabled = !!st.setupRunning || !st.eligible;
        const stateSpan = document.getElementById('strata-install-state');
        if (stateSpan) stateSpan.textContent = st.configured ? '\u2713 Model kurulu' : (st.installed ? '\u23f3 Ortam hazir, model bekliyor' : 'Kurulum yapilmadi');

        const startBtn = document.getElementById('btn-start-strata');
        if (startBtn) startBtn.disabled = !st.configured || st.running;
        const stopBtn = document.getElementById('btn-stop-strata');
        if (stopBtn) stopBtn.disabled = !st.running;
        const calBtn = document.getElementById('btn-strata-calibrate');
        if (calBtn) calBtn.disabled = !st.configured || st.setupRunning;
        const updBtn = document.getElementById('btn-strata-update');
        if (updBtn) updBtn.disabled = !st.repoCloned || st.running || st.setupRunning;

        updateServerStatus('strata', !!st.running);
        const cfgR = await window.electronAPI.strata.configRead().catch(() => null);
        if (cfgR && cfgR.success) {
            const hostSel = document.getElementById('strata-host');
            if (hostSel) hostSel.value = String(cfgR.config.host) === '127.0.0.1' ? 'pc' : 'lan';
            const portEl = document.getElementById('strata-port');
            if (portEl) portEl.value = cfgR.config.port;
            const idleEl = document.getElementById('strata-idle');
            if (idleEl) idleEl.value = cfgR.config.idleUnloadS;
            const ctxSel = document.getElementById('strata-context');
            if (ctxSel && cfgR.config.maxContext) ctxSel.value = String(cfgR.config.maxContext);
            const keyInfo = document.getElementById('strata-apikey-info');
            if (keyInfo) keyInfo.textContent = cfgR.config.apiKey ? 'API key: ' + cfgR.config.apiKey : '';
        }
    } catch (err) {
        console.error('[STRATA] Status query failed:', err.message);
    }
}

/**
 * Strata model kurulumu/indirmesi (System Detection kartindan).
 */
async function runStrataSetup() {
    if (strataBusyInFlight) return;
    const sel = document.getElementById('strata-model-select');
    const size = sel ? sel.value : null;
    if (!size) { showNotification('Warning', 'Model boyutu secilmedi.', 'warning'); return; }
    const confirmed = await window.electronAPI.notification.confirm(
        'Strata Kurulumu',
        '"' + size + '" modeli indirilsin mi?\n\n~58-84 GB indirme yapilir (models\\ klasoru), kurulum 1 saati asabilir ve internet hizina baglidir. Ilerleme Sunucular > Strata > Logs altindan izlenir; kesilirse ayni buton devam eder.'
    );
    if (!confirmed) return;
    strataBusyInFlight = true;
    appendToLog('strata', '[SETUP] Basliyor (' + size + ')...');
    const result = await window.electronAPI.strata.setup({ size }).catch(e => ({ success: false, error: e.message }));
    strataBusyInFlight = false;
    if (result.success) {
        appendToLog('strata', '[SETUP] Tamamlandi.');
        showNotification('Success', 'Strata kurulumu tamamlandi. Sunucular sekmesinden baslatin.');
    } else {
        appendToLog('strata', '[SETUP] FAILED: ' + result.error, true);
        showNotification('Error', 'Strata kurulumu basarisiz: ' + result.error, 'error');
    }
    await refreshStrataStatus();
}

async function runStrataCalibrate() {
    if (strataBusyInFlight) return;
    strataBusyInFlight = true;
    appendToLog('strata', '[CALIBRATE] Basliyor (~5-10 dk)...');
    const result = await window.electronAPI.strata.calibrate().catch(e => ({ success: false, error: e.message }));
    strataBusyInFlight = false;
    if (result.success) {
        appendToLog('strata', '[CALIBRATE] Tamamlandi.');
        showNotification('Success', 'Strata kalibrasyonu tamamlandi.');
    } else {
        appendToLog('strata', '[CALIBRATE] FAILED: ' + result.error, true);
        showNotification('Error', 'Kalibrasyon basarisiz: ' + result.error, 'error');
    }
    await refreshStrataStatus();
}

async function runStrataUpdate() {
    if (strataBusyInFlight) return;
    strataBusyInFlight = true;
    appendToLog('strata', '[UPDATE] Basliyor...');
    const result = await window.electronAPI.strata.update().catch(e => ({ success: false, error: e.message }));
    strataBusyInFlight = false;
    if (result.success) {
        appendToLog('strata', '[UPDATE] Tamamlandi.');
        showNotification('Success', 'Strata guncellendi.');
    } else {
        appendToLog('strata', '[UPDATE] FAILED: ' + result.error, true);
        showNotification('Error', 'Strata guncelleme basarisiz: ' + result.error, 'error');
    }
    await refreshStrataStatus();
}

/**
 * Kapı config paneli: context / PC-YerelAg / port / idle unload. Yedekli (kural 7).
 */
async function saveStrataConfig() {
    const options = {
        context: parseInt(document.getElementById('strata-context')?.value) || null,
        hostMode: document.getElementById('strata-host')?.value || 'pc',
        port: parseInt(document.getElementById('strata-port')?.value) || null,
        idleUnloadS: document.getElementById('strata-idle')?.value
    };
    const result = await window.electronAPI.strata.configWrite(options).catch(e => ({ success: false, error: e.message }));
    if (result.success) {
        appendToLog('strata', '[CONFIG] Kaydedildi: ' + (result.changed || []).join(', ') + ' | Yedek: ' + result.backupDir);
        String(result.checkargs || '').split(/\r?\n/).forEach(l => l.trim() && appendToLog('strata', 'checkargs| ' + l));
        showNotification('Success', 'Strata config guncellendi.');
    } else {
        appendToLog('strata', '[CONFIG] FAILED: ' + result.error, true);
        showNotification('Error', 'Config kaydedilemedi: ' + result.error, 'error');
    }
    await refreshStrataStatus();
}

function setupServerControls() {
    // Prevent duplicate IPC listener registration on re-entry
    if (eventListenersSetup) return;
    eventListenersSetup = true;
    
    // Individual server start/stop buttons
    const servers = [
        { type: 'searxng', startId: 'btn-start-searxng', stopId: 'btn-stop-searxng', updateId: null, browserId: 'btn-open-searxng', portId: 'searxng-port', hostId: 'searxng-host', statusId: 'searxng-status', logId: 'searxng-log' },
        { type: 'openwebui', startId: 'btn-start-openwebui', stopId: 'btn-stop-openwebui', updateId: 'btn-update-openwebui', browserId: 'btn-open-openwebui', portId: 'openwebui-port', hostId: 'openwebui-host', statusId: 'openwebui-status', logId: 'openwebui-log' },
        { 
            type: 'llamacpp', 
            startId: 'btn-start-llamacpp', 
            stopId: 'btn-stop-llamacpp', 
            updateId: null,
            browserId: 'btn-open-llamacpp',
            portId: 'llamacpp-port', 
            hostId: 'llamacpp-host', 
            iniSelectId: 'ini-select',
            statusId: 'llamacpp-status', 
            logId: 'llamacpp-log' 
        },
        { type: 'vane', startId: 'btn-start-vane', stopId: 'btn-stop-vane', updateId: null, browserId: 'btn-open-vane', portId: 'vane-port', hostId: 'vane-host', statusId: 'vane-status', logId: 'vane-log' },
        { type: 'wan2gp', startId: 'btn-start-wan2gp', stopId: 'btn-stop-wan2gp', updateId: null, browserId: 'btn-open-wan2gp', portId: 'wan2gp-port', hostId: 'wan2gp-host', statusId: 'wan2gp-status', logId: 'wan2gp-log' },
        { type: 'strata', startId: 'btn-start-strata', stopId: 'btn-stop-strata', updateId: null, browserId: 'btn-open-strata', portId: 'strata-port', hostId: null, statusId: 'strata-status', logId: 'strata-log' }
    ];
    
    // IPC Event Listeners (Server logs)
    window.electronAPI.events.on('server-log', (data) => {
        appendToLog(data.type, data.message);
    });

    window.electronAPI.events.on('server-error', (data) => {
        // Windows'ta Python stdout/stderr aynı loglari gonderiyor.
        // Log seviyesi prefix'li satirlari atla (stdout'dan gelen duplikasyon)
        const isLogLine = /^(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)/i.test(data.message.trim());
        if (!isLogLine) {
            appendToLog(data.type, data.message);
        }
    });

    window.electronAPI.events.on('server-stopped', (data) => {
        if (!state.servers[data.type]) return;
        state.servers[data.type].running = false;
        updateServerStatus(data.type, false);
        appendToLog(data.type, 'Stopped.');
        
        // Sunucu durduysa start butonunu tekrar aktif et
        const startBtn = document.getElementById(`btn-start-${data.type}`);
        if (startBtn) startBtn.disabled = false;
    });

    // Tray'den veya main process'ten gelen running eventi
    window.electronAPI.events.on('server-running', (data) => {
        if (!state.servers[data.type]) return;
        state.servers[data.type].running = true;
        state.servers[data.type].port = data.port || state.servers[data.type].port;
        updateServerStatus(data.type, true);
        appendToLog(data.type, 'Running.');
        
        // Stop butonunu aktif et
        const stopBtn = document.getElementById(`btn-stop-${data.type}`);
        if (stopBtn) stopBtn.disabled = false;
        
        // Browser butanini guncelle
        const host = state.servers[data.type].host || '127.0.0.1';
        updateBrowserButton(`btn-open-${data.type}`, true, `http://${host}:${data.port}`);
    });
    
    servers.forEach(server => {
        const startBtn = document.getElementById(server.startId);
        const stopBtn = document.getElementById(server.stopId);
        const browserBtn = document.getElementById(server.browserId);
        
        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                const port = parseInt(document.getElementById(server.portId)?.value || server.port);
                const host = document.getElementById(server.hostId)?.value || '127.0.0.1';
                
                startBtn.disabled = true;
                appendToLog(server.type, `Starting on ${host}:${port}...`);
                
                // llama.cpp için INI preset desteği + dil parametresi
                let options = { port, host, language: state.language };
                
                // OpenWebUI için CPU threads (PyQt6 ile aynı)
                if (server.type === 'openwebui') {
                    const threadsEl = document.getElementById('openwebui-threads');
                    if (threadsEl) {
                        options.threads = parseInt(threadsEl.value) || 4;
                        appendToLog('system', `OpenWebUI using ${options.threads} CPU thread(s)`);
                    }
                }
                
                if (server.type === 'llamacpp') {
                    // INI preset
                    if (server.iniSelectId) {
                        const iniSelect = document.getElementById(server.iniSelectId);
                        if (iniSelect?.value) {
                            options.iniPreset = iniSelect.value;
                            appendToLog('system', `Using INI preset: ${options.iniPreset}`);
                        }
                    }
                    // CPU Threads
                    const threadsEl = document.getElementById('llamacpp-threads');
                    if (threadsEl) {
                        options.threads = parseInt(threadsEl.value) || 10;
                        appendToLog('system', `llama.cpp cpu-threads: ${options.threads}`);
                    }
                    
                    // Max User (parallel)
                    const parallelEl = document.getElementById('llamacpp-parallel');
                    if (parallelEl) {
                        options.parallel = parseInt(parallelEl.value) || 1;
                        appendToLog('system', `llama.cpp parallel: ${options.parallel}`);
                    }
                    
                    // Sleep Idle Seconds
                    const sleepIdleEl = document.getElementById('llamacpp-sleep-idle');
                    if (sleepIdleEl) {
                        options.sleepIdle = parseInt(sleepIdleEl.value) || 1000;
                        appendToLog('system', `llama.cpp sleep-idle: ${options.sleepIdle}s`);
                    }
                    
                    // Max Model Load
                    const maxModelEl = document.getElementById('llamacpp-max-model');
                    if (maxModelEl) {
                        options.maxModel = parseInt(maxModelEl.value) || 1;
                        appendToLog('system', `llama.cpp max-model: ${options.maxModel}`);
                    }
                }
                
                const result = await window.electronAPI.server.start(server.type, options);
                
                if (result.success) {
                    state.servers[server.type].running = true;
                    state.servers[server.type].port = port;
                    state.servers[server.type].host = host;
                    
                    updateServerStatus(server.type, true);
                    updateBrowserButton(server.browserId, true, `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
                    appendToLog(server.type, `Started successfully! PID: ${result.pid}`);
                    showNotification('Success', `${server.type} started on port ${port}`);
                } else {
                    appendToLog(server.type, `Failed to start: ${result.error}`, true);
                    showNotification('Error', `Could not start ${server.type}: ${result.error}`);
                    // Basarisizsa tekrar deneyebilsin
                    startBtn.disabled = false;
                }
            });
        }
        
        if (stopBtn) {
            stopBtn.addEventListener('click', async () => {
                startBtn.disabled = true;
                stopBtn.disabled = true;
                appendToLog(server.type, `Stopping...`);
                
                const result = await window.electronAPI.server.stop(server.type);
                
                if (result.success) {
                    state.servers[server.type].running = false;
                    updateServerStatus(server.type, false);
                    updateBrowserButton(server.browserId, false, '');
                    appendToLog(server.type, 'Stopped.');
                } else {
                    appendToLog(server.type, `Stop failed: ${result.error}`, true);
                }
                
                startBtn.disabled = false;
                stopBtn.disabled = false;
            });
        }
        
        if (browserBtn) {
            browserBtn.addEventListener('click', () => {
                const port = parseInt(document.getElementById(server.portId)?.value || server.port);
                const host = state.servers[server.type].host || '127.0.0.1';
                const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
                window.electronAPI.shell.openExternal(url);
            });
        }
        
        // Update button handler (sadece openwebui için)
        if (server.updateId) {
            const updateBtn = document.getElementById(server.updateId);
            if (updateBtn) {
                updateBtn.addEventListener('click', async () => {
                    updateBtn.disabled = true;
                    updateBtn.textContent = '⏳ Updating...';
                    appendToLog(server.type, `[UPDATE] Starting ${server.type} update...`);
                    
                    try {
                        const result = await window.electronAPI.server.update(server.type);
                        
                        if (result.success) {
                            const lang = state.languages || {};
                            showNotification(lang['update_success'] || 'Success', `${server.type} ${lang['update_success'] || 'updated successfully!'}`);
                            appendToLog(server.type, `[UPDATE] ✅ ${server.type} updated successfully!`);
                            
                            // Otomatik restart
                            appendToLog(server.type, `[UPDATE] Restarting ${server.type}...`);
                            setTimeout(async () => {
                                const port = parseInt(document.getElementById(server.portId)?.value || 3000);
                                const host = document.getElementById(server.hostId)?.value || '127.0.0.1';
                                const startResult = await window.electronAPI.server.start(server.type, { port, host });
                                if (startResult.success) {
                                    state.servers[server.type].running = true;
                                    updateServerStatus(server.type, true);
                                    updateBrowserButton(server.browserId, true, `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);
                                    appendToLog(server.type, `[UPDATE] ${server.type} restarted successfully!`);
                                } else {
                                    appendToLog(server.type, `[ERROR] Restart failed: ${startResult.error}`, true);
                                }
                            }, 2000);
                        } else if (result.needsManualUpdate) {
                            // ✨ Manuel güncelleme gerekli
                            const lang = state.languages || {};
                            showNotification(
                                'Manual Update Required', 
                                `Please update ${server.type} manually.\n\nCurrent version: ${result.currentVersion || 'unknown'}\n\nSteps:\n1. Stop the server\n2. Backup your data\n3. Download new version\n4. Extract and restore data`
                            );
                            appendToLog(server.type, `[UPDATE] ⚠️ Manual update required: ${result.message}`, true);
                            result.logs.forEach(log => appendToLog(server.type, log));
                        } else {
                            const lang = state.languages || {};
                            showNotification('Error', `${server.type} ${lang['update_error']?.replace('{error}', result.message) || 'update failed'}`);
                            appendToLog(server.type, `[UPDATE] ❌ Failed: ${result.message}`, true);
                        }
                    } catch (err) {
                        const lang = state.languages || {};
                        showNotification('Error', `${lang['update_error']?.replace('{error}', err.message) || 'Update error'}`);
                        appendToLog(server.type, `[UPDATE] ❌ Error: ${err.message}`, true);
                    }
                    
                    updateBtn.disabled = false;
                    updateBtn.textContent = '🔄 Update';
                });
            }
        }
    });
    
    // Global start/stop all
    const startAllBtn = document.getElementById('btn-start-all');
    const stopAllBtn = document.getElementById('btn-stop-all');
    
    if (startAllBtn) {
        startAllBtn.addEventListener('click', startAllServers);
    }
    
    if (stopAllBtn) {
        stopAllBtn.addEventListener('click', stopAllServers);
    }
    
    // ============================================
    // Open Function Folder — function/ dizinini ac
    // ============================================
    const openFuncFolderBtn = document.getElementById('btn-open-function-folder');
    if (openFuncFolderBtn) {
        openFuncFolderBtn.addEventListener('click', async () => {
            await window.electronAPI.shell.openPathFunctionFolder();
        });
    }
    
    // ============================================
    // Load Database (OpenWebUI chat history import)
    // PyQt6'da: _load_database()
    // ============================================
    const loadDbBtn = document.getElementById('btn-load-database');
    if (loadDbBtn) {
        loadDbBtn.addEventListener('click', async () => {
            // Dosya seç dialogu aç
            const result = await window.electronAPI.dialog.openFile({
                title: 'Select Database File',
                buttonLabel: 'Load'
            });
            
            if (result.cancelled || !result.success) {
                return; // Kullanıcı iptal etti
            }
            
            const srcDb = result.filePath;
            
            // .db uzantisi kontrolü
            if (!srcDb.toLowerCase().endsWith('.db')) {
                showNotification('Invalid File', 'Please select a .db file.');
                return;
            }
            
            appendToLog('openwebui', `[INFO] Loading database from: ${srcDb}`);
            
            // Database kopyala (eski yedeklenir)
            const copyResult = await window.electronAPI.db.load(srcDb);
            
            if (copyResult.success) {
                showNotification('Success', 'Database loaded successfully!');
                appendToLog('openwebui', '[INFO] Database loaded successfully.');
                
                // ====== IMPORT FUNCTIONS (PyQt6'da: import_functions.py çalıştırma) ======
                appendToLog('openwebui', '[INFO] Importing functions from function/ directory...');
                
                let importResult;
                try {
                    importResult = await window.electronAPI.db.importFunctions();
                } catch (impErr) {
                    appendToLog('openwebui', `[WARN] Function import unavailable/failed: ${impErr.message}`, true);
                }
                
                if (importResult && importResult.success) {
                    let msg = `[INFO] Functions imported: ${importResult.functionsAdded || 0} added, ${importResult.functionsUpdated || 0} updated`;
                    msg += `\nTools: ${importResult.toolsAdded || 0} added, ${importResult.toolsUpdated || 0} updated`;
                    appendToLog('openwebui', msg);
                } else if (importResult) {
                    appendToLog('openwebui', `[WARN] Function import failed:: ${importResult.error || importResult.message}`, true);
                }
                
                // OpenWebUI calisiyorsa yeniden baslat
                if (state.servers['openwebui'].running) {
                    appendToLog('openwebui', '[INFO] Restarting OpenWebUI to apply new database...');
                    
                    // Kisa bir timeout ile yeniden baslat
                    setTimeout(async () => {
                        // Once durdur
                        await window.electronAPI.server.stop('openwebui');
                        state.servers['openwebui'].running = false;
                        updateServerStatus('openwebui', false);
                        document.getElementById('btn-start-openwebui').disabled = false;
                        document.getElementById('btn-stop-openwebui').disabled = true;
                        document.getElementById('btn-open-openwebui').disabled = true;
                        
                        // Sonra tekrar baslat
                        setTimeout(() => {
                            const port = parseInt(document.getElementById('openwebui-port')?.value || 3000);
                            const host = document.getElementById('openwebui-host')?.value || '127.0.0.1';
                            window.electronAPI.server.start('openwebui', { port, host }).then(startResult => {
                                if (startResult.success) {
                                    state.servers['openwebui'].running = true;
                                    updateServerStatus('openwebui', true);
                                    appendToLog('openwebui', '[INFO] OpenWebUI restarted with new database.');
                                } else {
                                    appendToLog('openwebui', `[ERROR] Failed to restart: ${startResult.error}`, true);
                                }
                            });
                        }, 2000);
                    }, 1000);
                }
            } else {
                showNotification('Error', `Failed to load database: ${copyResult.error}`);
                appendToLog('openwebui', `[ERROR] Failed to load database: ${copyResult.error}`, true);
            }
        });
    }
}

async function startAllServers() {
    const types = ['searxng', 'openwebui', 'llamacpp', 'vane'];
    
    for (const type of types) {
        const portInput = document.getElementById(`${type}-port`);
        const hostInput = document.getElementById(`${type}-host`);
        const port = parseInt(portInput?.value || (type === 'searxng' ? 8080 : type === 'openwebui' ? 3000 : type === 'vane' ? 3001 : 1234));
        const host = hostInput?.value || '127.0.0.1';
        
        appendToLog(type, `Starting ${type} on ${host}:${port}...`);
        
        const startOpts = type === 'llamacpp' ? buildLlamacppOptions({ port, host }) : { port, host };
        const result = await window.electronAPI.server.start(type, startOpts);
        
        if (result.success) {
            state.servers[type].running = true;
            updateServerStatus(type, true);
            appendToLog(type, `${type} started.`);
        } else {
            appendToLog(type, `${type} failed: ${result.error}`, true);
        }
    }
}

// llama.cpp baslatma parametrelerini canli ekrandan okur (manuel, oto-baslatma ve Start All ortak kaynagi)
function buildLlamacppOptions(base) {
    const opts = { ...base };
    const iniSelect = document.getElementById('ini-select');
    if (iniSelect && iniSelect.value) opts.iniPreset = iniSelect.value;
    opts.threads = parseInt(document.getElementById('llamacpp-threads')?.value) || 10;
    opts.parallel = parseInt(document.getElementById('llamacpp-parallel')?.value) || 1;
    opts.sleepIdle = parseInt(document.getElementById('llamacpp-sleep-idle')?.value) || 1000;
    opts.maxModel = parseInt(document.getElementById('llamacpp-max-model')?.value) || 1;
    return opts;
}

async function stopAllServers() {
    const types = ['searxng', 'openwebui', 'llamacpp', 'vane', 'wan2gp'];
    
    for (const type of types) {
        appendToLog(type, `Stopping ${type}...`);
        
        const result = await window.electronAPI.server.stop(type);
        
        if (result.success) {
            state.servers[type].running = false;
            updateServerStatus(type, false);
            appendToLog(type, `${type} stopped.`);
        } else {
            appendToLog(type, `${type} stop failed: ${result.error}`, true);
        }
    }
}

function updateServerStatus(type, running) {
    const statusEl = document.getElementById(`${type}-status`);
    const startBtn = document.getElementById(`btn-start-${type}`);
    const stopBtn = document.getElementById(`btn-stop-${type}`);
    
    if (statusEl) {
        statusEl.textContent = running ? 'Running' : 'Stopped';
        statusEl.className = `status-indicator ${running ? 'running' : 'stopped'}`;
    }
    
    if (startBtn) startBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
}

function updateBrowserButton(btnId, enabled, url) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    
    // Sadece disabled durumunu guncelle — click handler setupServerControls() tarafindan zaten atanmis
    btn.disabled = !enabled;
    
    // URL'yi butonun dataset'ine kaydet (setupServerControls'da kullanilacak)
    if (enabled && url) {
        btn.dataset.url = url;
    }
}

// ============================================
// Collapsible Log Panels
// ============================================
function toggleLogPanel(logId, btn) {
    const logArea = document.getElementById(logId);
    if (!logArea) return;
    
    const isHidden = logArea.classList.contains('hidden');
    if (isHidden) {
        logArea.classList.remove('hidden');
        btn.textContent = '📋 Logs ▴';
    } else {
        logArea.classList.add('hidden');
        btn.textContent = '📋 Logs ▾';
    }
}

function toggleConfigPanel(configId, btn) {
    const configPanel = document.getElementById(configId);
    if (!configPanel) return;
    
    const isHidden = configPanel.classList.contains('hidden');
    const s = state.languages || {};
    
    if (isHidden) {
        configPanel.classList.remove('hidden');
        btn.textContent = s.hide_config_btn || '🔧 Hide Config';
    } else {
        configPanel.classList.add('hidden');
        btn.textContent = s.show_config_btn || '🔧 Show Config';
    }
}

// Config panel butonlarını i18n ile güncelle (toggle sonrası text değişir)
function updateConfigButtonsLang() {
    const s = state.languages || {};
    
    // Tüm hide_config butonları
    document.querySelectorAll('[data-i18n="hide_config_btn"]').forEach(btn => {
        btn.textContent = s.hide_config_btn;
    });
}

function appendToLog(type, message, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = isError ? `[${timestamp}] ❌ ${message}` : `[${timestamp}] ℹ️ ${message}`;
    
    // Console'a yaz
    console.log(prefix);
    
    // DOM log alanına yaz
    const logEl = document.getElementById(`${type}-log`);
    if (logEl) {
        logEl.value += prefix + '\n';
        logEl.scrollTop = logEl.scrollHeight;
    }
}

// ============================================
// Model Management Controls
// ============================================
function setupModelControls() {
    const refreshBtn = document.getElementById('btn-refresh-models');
    const deleteBtn = document.getElementById('btn-delete-selected');
    
    if (refreshBtn) {
        refreshBtn.addEventListener('click', scanModels);
    }
    
    if (deleteBtn) {
        deleteBtn.addEventListener('click', deleteSelectedModel);
    }
    
    // Model list event delegation
    setupModelListEvents();
}

async function scanModels() {
    const modelsDir = await window.electronAPI.paths.getModelsDir();
    
    try {
        const models = await window.electronAPI.model.scan(modelsDir);
        state.models = models;
        
        renderModelList(models.files);
        
        // Update count and total size (PyQt6 _update_storage() karsiligi)
        const countDisplay = document.getElementById('models-count');
        const sizeDisplay = document.getElementById('models-total-size');
        
        if (countDisplay) {
            countDisplay.textContent = `${models.files.length} model${models.files.length !== 1 ? 's' : ''}`;
        }
        
        if (sizeDisplay) {
            sizeDisplay.textContent = formatBytes(models.totalSize);
        }
    } catch (err) {
        showNotification('Error', `Failed to scan models: ${err.message}`);
    }
}

// PyQt6: _update_delete_button() — Secim yapildiginda delete butonunu aktif et
window.updateDeleteButtonState = function() {
    const checkboxes = document.querySelectorAll('#model-list input[type="checkbox"]:checked');
    const deleteBtn = document.getElementById('btn-delete-selected');
    if (deleteBtn) {
        deleteBtn.disabled = checkboxes.length === 0;
    }
}

// Event delegation — checkbox tiklamalarini yakala
function setupModelListEvents() {
    const listEl = document.getElementById('model-list');
    if (!listEl) {
        console.error('[ERROR] #model-list element not found!');
        return;
    }
    
    listEl.addEventListener('click', (e) => {
        // Checkbox tiklama
        if (e.target.type === 'checkbox') {
            updateDeleteButtonState();
            return;
        }
        
        // LI veya SPAN tiklama -> checkbox'ı toggle et
        const li = e.target.closest('li.model-item');
        if (li) {
            const index = parseInt(li.dataset.index);
            const checkbox = li.querySelector('input[type="checkbox"]');
            
            // Checkbox durumunu tersine çevir
            checkbox.checked = !checkbox.checked;
            
            // Model secimi
            selectModel(index);
            
            // Delete button guncelleme
            updateDeleteButtonState();
        }
    });
}

function renderModelList(files) {

    const listEl = document.getElementById('model-list');

    if (!listEl) return;
    
    if (files.length === 0) {
        const emptyMsg = state.languages?.label_no_models || 'No GGUF files found.';
        listEl.innerHTML = `<li class="empty-message">${emptyMsg}</li>`;
        
        // List bos ise delete butonunu devre disirakir
        updateDeleteButtonState();
        return;
    }
    
    listEl.innerHTML = files.map((model, index) => `
        <li data-index="${index}" class="model-item">
            <label class="model-checkbox-label">
                <input type="checkbox" data-model-index="${index}">
                <span class="checkmark"></span>
            </label>
            <span class="model-name">${escHtml(model.name)}</span>
            <span class="muted model-size">${formatBytes(model.size)}</span>
            <span class="muted model-path">${escHtml(model.relativePath || '')}</span>
        </li>
    `).join('');
    
    // Yeni render'da delete butonunu guncelle
    updateDeleteButtonState();
}

function selectModel(index) {
    // Remove previous selection
    document.querySelectorAll('#model-list li').forEach(li => {
        li.classList.remove('selected');
    });
    
    // Add selection to clicked item
    const items = document.querySelectorAll('#model-list li');
    if (items[index]) {
        items[index].classList.add('selected');
        state.selectedModel = index;
    }
}

async function deleteSelectedModel() {
    // PyQT6'daki gibi multi-selection destekle
    const checkboxes = document.querySelectorAll('#model-list input[type="checkbox"]:checked');
    
    if (checkboxes.length === 0) {
        showNotification('Warning', 'Please select a model first.');
        return;
    }
    
    // Onay dialogu - PyQT6'daki QMessageBox.question() karsiligi
    const names = Array.from(checkboxes).map(cb => {
        const nameEl = cb.closest('li')?.querySelector('.model-name');
        return `- ${nameEl ? nameEl.textContent : '?'}`;
    }).join('\n');
    
    const message = `Delete ${checkboxes.length} model(s)?\n\n${names}\n\nThis cannot be undone.`;
    
    const confirmed = await window.electronAPI.notification.confirm(
        'Confirm Delete',
        message
    );
    
    if (!confirmed) return;
    
    // Onaydan SONRA taze secimi oku (dialog acikken liste degismisse eski index kullanilmaz)
    const selectedModels = Array.from(document.querySelectorAll('#model-list input[type="checkbox"]:checked')).map(cb => {
        const li = cb.closest('li');
        const index = parseInt(li?.dataset.index);
        return state.models.files[index];
    }).filter(m => m !== undefined);
    
    if (selectedModels.length === 0) return;
    
    // Dosya yollarini al
    const filePaths = selectedModels.map(m => m.path);
    
    try {
        const result = await window.electronAPI.model.deleteMultiple(filePaths);
        
        if (result.success > 0) {
            // Listeyi yeniden tara
            await scanModels();
            showNotification('Success', `${result.success} model(s) deleted.`);
        }
        
        if (result.errors > 0) {
            showNotification('Warning', `${result.errors} model(s) could not be deleted.`);
        }
    } catch (err) {
        showNotification('Error', `Delete failed: ${err.message}`);
    }
}

function updateDownloadProgress(percent, downloaded, total) {
    // Her iki progress bar'ı da güncelle
    const fillSystem = document.getElementById('download-progress-fill-system');
    const percentSystem = document.getElementById('download-percent-system');
    
    if (fillSystem) {
        fillSystem.style.width = `${percent}%`;
    }
    
    if (percentSystem) {
        percentSystem.textContent = `${percent}%`;
    }
    
    // Formatlanmış bilgiyi log'a yaz
    if (total > 0 && downloaded > 0) {
        const currentFormatted = formatBytes(downloaded);
        const totalFormatted = formatBytes(total);
        appendToLog('system', `📥 ${currentFormatted} / ${totalFormatted} (${percent}%)`);
    }
}

// Per-model progress tracking
const perModelProgressData = {}; // taskId -> { status, percent, downloaded, total }
const MAX_CONCURRENT_DOWNLOADS = 3; // Es zamanli indirme limiti (bant genisligi/rate-limit koruması)
let currentDownloadTasks = []; // module-level scope for task lookup
let eventListenersSetup = false; // Prevent duplicate IPC listener registration

function updatePerModelProgress(data) {
    const { taskId, percent, downloaded, total } = data;
    
    // Track progress state
    if (!perModelProgressData[taskId]) {
        perModelProgressData[taskId] = { status: 'downloading', percent: 0, downloaded: 0, total: 0 };
        createPerModelProgressBar(taskId);
    }
    
    perModelProgressData[taskId].status = 'downloading';
    perModelProgressData[taskId].percent = percent || 0;
    perModelProgressData[taskId].downloaded = downloaded || 0;
    perModelProgressData[taskId].total = total || 0;
    
    // Update the progress bar UI
    updatePerModelProgressBar(taskId);
}

function createPerModelProgressBar(taskId) {
    const container = document.getElementById('per-model-progress-container');
    if (!container) return;
    
    const task = findTaskById(taskId);
    if (!task) return;
    
    const item = document.createElement('div');
    item.className = 'per-model-item';
    item.id = `per-model-${taskId}`;
    item.innerHTML = `
        <span class="per-model-label">${escHtml(task.name)}</span>
        <div class="per-model-bar-container">
            <div class="per-model-fill" style="width: 0%"></div>
        </div>
        <span class="per-model-percent">0%</span>
        <span class="per-model-status downloading">⏳ Downloading...</span>
    `;
    
    container.appendChild(item);
}

function updatePerModelProgressBar(taskId) {
    const item = document.getElementById(`per-model-${taskId}`);
    if (!item) return;
    
    const data = perModelProgressData[taskId];
    const fill = item.querySelector('.per-model-fill');
    const percent = item.querySelector('.per-model-percent');
    const status = item.querySelector('.per-model-status');
    
    if (fill) {
        fill.style.width = `${data.percent}%`;
    }
    if (percent) {
        percent.textContent = `${data.percent}%`;
    }
    if (status) {
        const currentFormatted = formatBytes(data.downloaded);
        const totalFormatted = formatBytes(data.total);
        status.textContent = `${currentFormatted} / ${totalFormatted}`;
        status.className = 'per-model-status downloading';
    }
}

function markPerModelComplete(taskId, success, errorMessage = '') {
    const item = document.getElementById(`per-model-${taskId}`);
    if (!item) return;
    
    const data = perModelProgressData[taskId];
    const status = item.querySelector('.per-model-status');
    
    if (status) {
        if (success) {
            status.textContent = '✅ Done';
            status.className = 'per-model-status completed';
        } else {
            status.textContent = `❌ ${errorMessage}`;
            status.className = 'per-model-status error';
        }
    }
}

function findTaskById(taskId) {
    // Find task from recently downloaded tasks (stored in a variable)
    return currentDownloadTasks?.find(t => t.id === taskId) || null;
}

// ============================================
// INI Preset Management (llama.cpp GPU configs)
// ============================================
async function loadINIPresets(autoSelect = null) {
    try {
        const presets = await window.electronAPI.model.getINIPresets();
        const select = document.getElementById('ini-select');
        
        if (!select) return;
        
        // Mevcut option'ları temizle (placeholder hariç)
        while (select.options.length > 1) {
            select.remove(1);
        }
        
        // Preset'leri ekle
        for (const preset of presets) {
            const option = document.createElement('option');
            option.value = preset;
            option.textContent = preset.replace('.ini', '');
            select.appendChild(option);
        }
        
        // Otomatik eşleştirme varsa seç
        if (autoSelect && presets.includes(autoSelect)) {
            select.value = autoSelect;
            appendToLog('system', `Auto-selected INI: ${autoSelect}`);
            showNotification('Config Auto-Selected', `Using ${autoSelect} for your GPU`);
        }
        
        // GUI model management: listeyi yenile
        refreshPresetModelList(true);
        
        console.log(`[INI] Loaded ${presets.length} presets`);
    } catch (err) {
        console.error('[INI] Failed to load presets:', err.message);
    }
}

async function refreshINIPresets(autoSelect = null) {
    await loadINIPresets(autoSelect);
}

function setupINICallbacks() {
    const iniSelect = document.getElementById('ini-select');
    const loadBtn = document.getElementById('btn-load-ini');
    
    if (loadBtn) {
        loadBtn.addEventListener('click', async () => {
            const selected = iniSelect?.value;
            if (!selected) {
                showNotification('Warning', 'Please select a GPU config file first');
                return;
            }
            
            // Config'e kaydet
            state.config.selected_ini = selected;
            await window.electronAPI.config.write(state.config);
            
            appendToLog('system', `Loaded INI preset: ${selected}`);
            showNotification('Config Loaded', `Using ${selected}`);
            
            // GUI model management: listeyi yenile
            refreshPresetModelList();
        });
    }

    const openBtn = document.getElementById('btn-open-ini');
    if (openBtn) {
        openBtn.addEventListener('click', async () => {
            const selected = iniSelect?.value;
            if (!selected) {
                showNotification('Warning', 'Please select a GPU config file first');
                return;
            }

            const res = await window.electronAPI.model.openIniFile(selected);
            if (res && res.success) {
                appendToLog('system', 'Opened INI file: ' + selected);
            } else {
                showNotification('Error', (res && res.error) || 'INI dosyasi acilamadi');
            }
        });
    }
}

// ============================================
// PiCoding Controls
// ============================================
function setupPicodingControls() {
    // Detect Project button (PyQt6 _detect_project ile birebir aynı)
    const detectBtn = document.getElementById('btn-detect-project');
    if (detectBtn) {
        detectBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.picoding.detectProject();
            if (result.success) {
                // PyQt6 gibi: path + detected markers göster
                const markerText = result.markers?.length > 0 ? `(Detected: ${result.markers.join(', ')})` : '';
                document.getElementById('picoding-path-display').textContent = `${result.path}\n${markerText}`;
                showNotification('Success', `Project detected at: ${result.path}`);
            } else if (result.needManualSelect) {
                // PyQt6'daki QFileDialog.getExistingDirectory karşılığı
                const projectRoot = await window.electronAPI.paths.getProjectRoot();
                const folderPath = await window.electronAPI.dialog.openFolder({
                    title: 'Select Working Directory',
                    defaultPath: projectRoot
                });
                if (folderPath) {
                    document.getElementById('picoding-path-display').textContent = folderPath;
                    showNotification('Success', `Working directory set to: ${folderPath}`);
                }
            }
        });
    }
    
    // Add to PATH button (kullanici + sistem PATH, cift kapsam)
    const addPathBtn = document.getElementById('btn-add-to-path');
    if (addPathBtn) {
        addPathBtn.addEventListener('click', async () => {
            const lang = state.languages || {};
            const confirmMsg = (lang['msg_confirm_add_path'] ||
                'Add {} to Windows PATH?\n\nThis will allow you to type \'pi\' in any terminal.')
                .replace('{}', 'picoding');
            const confirmed = await window.electronAPI.notification.confirm(
                lang['add_path_btn'] || 'Add to PATH',
                confirmMsg
            );
            
            if (confirmed) {
                const result = await window.electronAPI.picoding.addToPath();
                if (result.success) {
                    if (result.warning) {
                        const warnMsg = (lang['msg_add_path_partial'] || 'Added partially: {}').replace('{}', result.warning);
                        showNotification('Warning', warnMsg, 'warning');
                    } else {
                        showNotification('Success', lang['msg_add_path_success'] || 'picoding added to PATH successfully! Open a new terminal to use "pi".');
                    }
                } else {
                    let failMsg = lang['msg_add_path_failed'] ||
                        'Failed to add to PATH:\n{}\n\nYou can manually add:\n{}\n\nThen restart your terminal.';
                    failMsg = failMsg.replace('{}', result.error || 'unknown error').replace('{}', result.picodingPath || '');
                    showNotification('Error', failMsg);
                }
            }
        });
    }
    
    // Update PiCoding button (Git Pull)
    const updatePicodingBtn = document.getElementById('btn-update-picoding');
    if (updatePicodingBtn) {
        updatePicodingBtn.addEventListener('click', async () => {
            updatePicodingBtn.disabled = true;
            const lang = state.languages || {};
            updatePicodingBtn.textContent = lang['update_starting'] || '⏳ Updating...';
            appendToLog('picoding', '[UPDATE] Starting PiCoding update...');
            
            try {
                const result = await window.electronAPI.picoding.update();
                
                if (result.success) {
                    showNotification(lang['update_success'] || 'Success', `PiCoding ${lang['update_success']?.replace('!', '') || 'updated successfully!'}`);
                    appendToLog('picoding', `[UPDATE] ✅ PiCoding updated successfully!`);
                } else {
                    showNotification('Error', `${lang['update_error']?.replace('{error}', result.message) || 'Update failed'}`);
                    appendToLog('picoding', `[UPDATE] ❌ Failed: ${result.message}`, true);
                }
            } catch (err) {
                showNotification('Error', `${lang['update_error']?.replace('{error}', err.message) || 'Update error'}`);
                appendToLog('picoding', `[UPDATE] ❌ Error: ${err.message}`, true);
            }
            
            updatePicodingBtn.disabled = false;
            updatePicodingBtn.textContent = lang['btn_update_picoding'] || '🔄 Update PiCoding';
        });
    }
    
    // Instructions toggle
    const toggleInstrBtn = document.getElementById('toggle-instructions');
    const instrContent = document.getElementById('instructions-content');
    if (toggleInstrBtn && instrContent) {
        toggleInstrBtn.addEventListener('click', () => {
            instrContent.classList.toggle('hidden');
            const strings = state.languages || {};
            toggleInstrBtn.textContent = instrContent.classList.contains('hidden') 
                ? (strings.show_instructions_btn || '📖 Show Instructions') 
                : (strings.hide_instructions_btn || '📖 Hide Instructions');
        });
    }
    
    // Fetch Models from API
    const fetchModelsBtn = document.getElementById('btn-fetch-models');
    if (fetchModelsBtn) {
        fetchModelsBtn.addEventListener('click', async () => {
            const advisorUrl = document.getElementById('advisor-url')?.value;
            const apiKey = document.getElementById('advisor-key')?.value;
            const providerType = document.getElementById('provider-type')?.value || 'auto';
            
            if (!advisorUrl) {
                showNotification('Warning', 'Please enter API URL first.');
                return;
            }
            
            // Local API'ler (Ollama, LM Studio) icin API Key zorunlu degil
            if (providerType !== 'ollama' && providerType !== 'lmstudio' && !apiKey) {
                showNotification('Warning', 'Please enter API Key (or select local provider type).');
                return;
            }
            
            fetchModelsBtn.disabled = true;
            fetchModelsBtn.textContent = '⏳';
            showNotification('Info', `Fetching models (${providerType === 'auto' ? 'auto-detect' : providerType})...`);
            
            try {
                const result = await window.electronAPI.picoding.fetchModels(advisorUrl, apiKey || '', providerType);
                
                if (result.success && result.models.length > 0) {
                    const modelSelect = document.getElementById('advisor-model');
                    modelSelect.innerHTML = '<option value="">-- Select a model --</option>';
                    
                    result.models.forEach(modelId => {
                        const option = document.createElement('option');
                        option.value = modelId;
                        option.textContent = modelId;
                        modelSelect.appendChild(option);
                    });
                    
                    showNotification('Success', `Found ${result.models.length} models!`);
                    console.log(`[MCP] Loaded ${result.models.length} models from API (${providerType})`);
                } else if (result.success && result.models.length === 0) {
                    showNotification('Info', 'No models found. Try manual entry.');
                } else {
                    showNotification('Error', `Failed to fetch models: ${result.error}`);
                }
            } catch (err) {
                showNotification('Error', `Fetch error: ${err.message}`);
            } finally {
                fetchModelsBtn.disabled = false;
                fetchModelsBtn.textContent = '🔄';
            }
        });
    }
    
    // Save Advisor Settings
    const saveAdvisorBtn = document.getElementById('btn-save-advisor');
    if (saveAdvisorBtn) {
        saveAdvisorBtn.addEventListener('click', async () => {
            const advisorUrl = document.getElementById('advisor-url')?.value;
            const apiKey = document.getElementById('advisor-key')?.value;
            const providerType = document.getElementById('provider-type')?.value || 'auto';
            
            // Select'ten veya custom input'tan model al
            let modelName = document.getElementById('advisor-model-custom')?.value;
            if (!modelName) {
                modelName = document.getElementById('advisor-model')?.value;
            }
            
            if (!advisorUrl || !modelName) {
                showNotification('Warning', 'Please enter API URL and select a model.');
                return;
            }
            
            // Yerel API'ler (Ollama, LM Studio) icin API Key zorunlu degil
            if (providerType !== 'ollama' && providerType !== 'lmstudio' && !apiKey) {
                showNotification('Warning', 'Please enter API Key (or select local provider type).');
                return;
            }
            
            const result = await window.electronAPI.picoding.saveAdvisor({
                url: advisorUrl,
                key: apiKey,
                model: modelName
            });
            
            if (result.success) {
                showNotification('Success', 'MCP Advisor settings saved!');
            } else {
                showNotification('Error', `Failed to save: ${result.error}`);
            }
        });
    }
    
    // Load saved advisor settings on init
    loadAdvisorSettings();
}

async function loadAdvisorSettings() {
    try {
        const settings = await window.electronAPI.picoding.getAdvisor();
        if (settings.url) document.getElementById('advisor-url').value = settings.url;
        if (settings.key) document.getElementById('advisor-key').value = settings.key;
        if (settings.model) document.getElementById('advisor-model').value = settings.model;
    } catch (err) {
        console.error('[PiCoding] Failed to load advisor settings:', err);
    }
}

// ============================================
// System Detection Model Controls
// ============================================
// ============================================
// GUI model yonetimi: aktif INI bolumleri + model_urls.json
// ============================================
let presetListContext = { iniName: null, models: [] };

async function refreshPresetModelList(silentIfEmpty) {
    const select = document.getElementById('ini-select');
    const listEl = document.getElementById('system-model-list');
    if (!select || !listEl) return;
    const iniName = select.value;
    if (!iniName) {
        if (!silentIfEmpty) renderSystemModelList([], null);
        return;
    }
    try {
        const res = await window.electronAPI.model.getSections(iniName);
        if (!res || !res.success) {
            if (res && res.error) console.warn('[PresetStore]', res.error);
            return;
        }
        const models = (res.sections || []).filter(s => s && s.name && s.name !== '*');
        presetListContext = { iniName: iniName, models: models };
        renderSystemModelList(models, iniName);
    } catch (err) {
        console.error('[PresetStore] getSections failed:', err);
    }
}

function openModelEditor(sectionName, prefill) {
    const modal = document.getElementById('model-editor-modal');
    if (!modal) return;
    const nameInput = document.getElementById('me-name');
    const urlInput = document.getElementById('me-url');
    const mmInput = document.getElementById('me-mmproj');
    const draftInput = document.getElementById('me-draft');
    if (sectionName && prefill) {
        nameInput.value = sectionName;
        nameInput.readOnly = true;
        urlInput.value = prefill.model || '';
        mmInput.value = prefill.mmproj || '';
        draftInput.value = prefill.draft || '';
    } else {
        nameInput.readOnly = false;
        nameInput.value = '';
        urlInput.value = '';
        mmInput.value = '';
        draftInput.value = '';
    }
    updateLocalPathPreview();
    modal.classList.remove('hidden');
}

function closeModelEditor() {
    const modal = document.getElementById('model-editor-modal');
    if (modal) modal.classList.add('hidden');
}

function updateLocalPathPreview() {
    const el = document.getElementById('me-local-path');
    const nameEl = document.getElementById('me-name');
    const urlEl = document.getElementById('me-url');
    const mmEl = document.getElementById('me-mmproj');
    const draftEl = document.getElementById('me-draft');
    if (!el || !nameEl || !urlEl) return;
    const name = (nameEl.value || '').trim();
    const url = (urlEl.value || '').trim();
    const mm = mmEl ? (mmEl.value || '').trim() : '';
    const draft = draftEl ? (draftEl.value || '').trim() : '';
    if (!name || !url) {
        el.textContent = '—';
        return;
    }
    const folder = name.replace('-vision', '').replace('-Vision', '');
    const file = url.split('/').pop() || '';
    let txt = 'models/' + folder + '/' + file;
    if (mm) {
        const mmFile = mm.split('/').pop() || '';
        txt += '\nmmproj: models/' + folder + '/' + mmFile;
    }
    if (draft) {
        const dFile = draft.split('/').pop() || '';
        txt += '\ndraft: models/' + folder + '/' + dFile;
    }
    el.textContent = txt;
}

async function saveModelEditor() {
    const iniSelect = document.getElementById('ini-select');
    const iniName = iniSelect ? iniSelect.value : null;
    if (!iniName) {
        showNotification('Error', 'Please select an INI file first.');
        return;
    }
    const name = (document.getElementById('me-name').value || '').trim();
    const url = (document.getElementById('me-url').value || '').trim();
    const mm = (document.getElementById('me-mmproj').value || '').trim();
    const draft = (document.getElementById('me-draft').value || '').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        showNotification('Error', 'Invalid model name. Use letters, numbers, dot, dash, underscore.');
        return;
    }
    if (!/^https?:\/\//.test(url)) {
        showNotification('Error', 'Model URL must start with http:// or https://');
        return;
    }
    if (mm && !/^https?:\/\//.test(mm)) {
        showNotification('Error', 'MMProj URL must start with http:// or https://');
        return;
    }
    if (draft && !/^https?:\/\//.test(draft)) {
        showNotification('Error', 'Draft URL must start with http:// or https://');
        return;
    }
    try {
        const res = await window.electronAPI.model.saveSection({
            iniName: iniName,
            sectionName: name,
            modelUrl: url,
            mmprojUrl: mm || '',
            modelDraftUrl: draft || ''
        });
        if (!res || !res.success) throw new Error(res && res.error ? res.error : 'save failed');
        closeModelEditor();
        showNotification('Saved', '"' + name + '" ' + (res.mode === 'added' ? 'added' : 'updated') + ' (' + iniName + ')');
        await refreshPresetModelList();
    } catch (err) {
        showNotification('Error', 'Save failed: ' + err.message);
    }
}

async function checkUrlsForRow(index) {
    const ctx = presetListContext;
    const model = ctx.models[index];
    if (!model || !ctx.iniName) return;
    const statusEl = document.getElementById('urlstatus-' + index);
    if (statusEl) {
        statusEl.textContent = '… checking';
        statusEl.className = 'url-status';
    }
    try {
        const u = await window.electronAPI.model.getUrlsFromJSON(ctx.iniName, model.name);
        const urls = [];
        if (u && typeof u === 'object') {
            if (u.model) urls.push(u.model);
            if (u.mmproj) urls.push(u.mmproj);
            if (u.modelDraft) urls.push(u.modelDraft);
        }
        if (urls.length === 0) {
            if (statusEl) {
                statusEl.textContent = 'no URL';
                statusEl.className = 'url-status bad';
            }
            return;
        }
        const res = await window.electronAPI.model.checkUrls(urls);
        const parts = [];
        let allOk = true;
        for (const r of ((res && res.results) || [])) {
            if (r.ok) {
                parts.push(String(r.status) + (r.size ? ' · ' + formatBytes(r.size) : ''));
            } else {
                allOk = false;
                parts.push(r.error || ('HTTP ' + r.status));
            }
        }
        if (statusEl) {
            statusEl.textContent = parts.join(', ');
            statusEl.className = 'url-status ' + (allOk ? 'ok' : 'bad');
        }
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = 'error';
            statusEl.className = 'url-status bad';
        }
    }
}

async function checkAllUrls() {
    const ctx = presetListContext;
    if (!ctx.iniName || !ctx.models || ctx.models.length === 0) {
        showNotification('Info', 'No model list loaded. Select an INI file first.');
        return;
    }
    showNotification('URL Check', 'Checking ' + ctx.models.length + ' model URLs…');
    for (let i = 0; i < ctx.models.length; i++) {
        await checkUrlsForRow(i);
    }
    showNotification('URL Check', 'Done.');
}

async function handleRowAction(action, index) {
    const ctx = presetListContext;
    const model = ctx.models[index];
    if (!model || !ctx.iniName) return;
    if (action === 'delete') {
        const sure = confirm('Delete "' + model.name + '" from ' + ctx.iniName + '? Its URL record in model_urls.json will be removed too.');
        if (!sure) return;
        try {
            const res = await window.electronAPI.model.deleteSection(ctx.iniName, model.name);
            if (!res || !res.success) throw new Error(res && res.error ? res.error : 'delete failed');
            showNotification('Deleted', '"' + model.name + '" removed (INI: ' + res.iniRemoved + ', JSON: ' + res.jsonRemoved + ')');
            await refreshPresetModelList();
        } catch (err) {
            showNotification('Error', 'Delete failed: ' + err.message);
        }
    } else if (action === 'edit') {
        let prefill = { model: '', mmproj: '', draft: ''};
        try {
            const u = await window.electronAPI.model.getUrlsFromJSON(ctx.iniName, model.name);
            if (u && typeof u === 'object') prefill = { model: u.model || '', mmproj: u.mmproj || '', draft: u.modelDraft || ''};
        } catch (_) {}
        openModelEditor(model.name, prefill);
    } else if (action === 'check') {
        await checkUrlsForRow(index);
    }
}

function setupModelEditorModal() {
    const modal = document.getElementById('model-editor-modal');
    if (!modal) return;
    const overlay = modal.querySelector('.modal-overlay');
    const closeBtn = document.getElementById('close-model-editor');
    const cancelBtn = document.getElementById('me-cancel');
    const saveBtn = document.getElementById('me-save');
    const closeModal = () => modal.classList.add('hidden');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (overlay) overlay.addEventListener('click', closeModal);
    if (saveBtn) saveBtn.addEventListener('click', saveModelEditor);
    ['me-name', 'me-url', 'me-mmproj', 'me-draft'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateLocalPathPreview);
    });
}
function setupSystemModelControls() {
    // Download All Models button
    const downloadAllBtn = document.getElementById('btn-download-all');
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', async () => {
            console.log('[UI] Download All Models clicked!');
            
            try {
                const iniSelect = document.getElementById('ini-select');
                const selectedIni = iniSelect?.value;
                
                console.log('[UI] Selected INI:', selectedIni);
                
                if (!selectedIni) {
                    showNotification('Warning', 'Please select an INI file first.');
                    return;
                }
                
                // INI'dan modelleri yükle
                console.log('[UI] Calling getModelsFromINI...');
                const models = await window.electronAPI.model.getModelsFromINI(selectedIni);
                console.log('[Download] Models from INI:', JSON.stringify(models, null, 2));
                
                if (!models || models.length === 0) {
                    showNotification('Info', 'No models found in this INI file. Check console for details.');
                    console.warn('[Download] Models array is empty or undefined');
                    return;
                }
                
                // Model listesini göster
                renderSystemModelList(models, selectedIni);
                
                // İndirme işlemini başlat
                console.log('[UI] Starting downloadAllModels...');
                await downloadAllModels(models, selectedIni);
                console.log('[UI] Download complete!');
            } catch (err) {
                console.error('[UI] Error during download:', err);
                showNotification('Error', `Download failed: ${err.message}`);
            }
        });
    }
    
    // Add Model butonu
    const addModelBtn = document.getElementById('btn-add-model');
    if (addModelBtn) {
        addModelBtn.addEventListener('click', () => {
            const iniSel = document.getElementById('ini-select');
            if (!iniSel || !iniSel.value) {
                showNotification('Warning', 'Please select an INI file first.');
                return;
            }
            openModelEditor(null);
        });
    }
    
    // Check URLs butonu
    const checkAllBtn = document.getElementById('btn-check-all-urls');
    if (checkAllBtn) {
        checkAllBtn.addEventListener('click', checkAllUrls);
    }
    
    // Satir aksiyonlari (event delegation)
    const sysListEl = document.getElementById('system-model-list');
    if (sysListEl) {
        sysListEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.mini-btn');
            if (!btn) return;
            const li = btn.closest('li[data-index]');
            if (!li) return;
            const index = Number(li.getAttribute('data-index'));
            if (btn.classList.contains('act-check')) handleRowAction('check', index);
            else if (btn.classList.contains('act-edit')) handleRowAction('edit', index);
            else if (btn.classList.contains('act-del')) handleRowAction('delete', index);
        });
    }
    
    // INI secimi degisince listeyi yenile
    const iniSelChange = document.getElementById('ini-select');
    if (iniSelChange) {
        iniSelChange.addEventListener('change', () => refreshPresetModelList());
    }
}

function renderSystemModelList(models, iniName) {
    const listEl = document.getElementById('system-model-list');
    if (!listEl) return;
    presetListContext.iniName = iniName !== undefined ? iniName : presetListContext.iniName;
    presetListContext.models = models || [];
    
    if (!models || models.length === 0) {
        listEl.innerHTML = '<li class="empty-message">No models.</li>';
        return;
    }
    
    listEl.innerHTML = models.map((model, index) => {
        const k = model.keys || {};
        const ready = k.model || k.model_file || model.model_file || model.model_url;
        const draftChip = k['model-draft']
            ? `<span class="muted" id="draftstatus-${index}">📦 draft: …</span>`
            : '';
        return `
        <li data-index="${index}" data-name="${escHtml(model.name)}">
            <span>[${escHtml(model.name)}]</span>
            <span class="muted">${ready ? '✓ Ready' : '✗ No model key'}</span>
            ${draftChip}
            <span class="url-status" id="urlstatus-${index}"></span>
            <span class="model-row-actions">
                <button type="button" class="mini-btn act-check" title="Check URL">🔍</button>
                <button type="button" class="mini-btn act-edit" title="Edit">✎</button>
                <button type="button" class="mini-btn mini-danger act-del" title="Delete">🕑</button>
            </span>
        </li>`;
    }).join('');
    
    // Draft (speculative) dosya durumu — asenkron doldur (yol, indirme akisiyle birebir ayni)
    (async () => {
        let modelsDir = '';
        try { modelsDir = await window.electronAPI.paths.getModelsDir(); } catch (_) {}
        for (let i = 0; i < models.length; i++) {
            const k = models[i].keys || {};
            if (!k['model-draft']) continue;
            const el = document.getElementById('draftstatus-' + i);
            if (!el) continue;
            const fileName = String(k['model-draft']).split(/[\\/]/).pop();
            const folderName = models[i].name.replace('-vision', '').replace('-Vision', '');
            const p = `${modelsDir}/${folderName}/${fileName}`;
            try {
                const ok = await window.electronAPI.model.fileExists(p);
                el.textContent = ok ? '📦 draft: ✓ yerelde var' : '📦 draft: ✗ bekliyor';
                el.classList.add(ok ? 'ok' : 'bad');
            } catch (_) {
                el.textContent = '📦 draft: ?';
            }
        }
    })();
}

async function downloadAllModels(models, selectedIni) {
    const modelsDir = await window.electronAPI.paths.getModelsDir();
    let completedCount = 0;
    
    console.log(`[Download] Starting PARALLEL download for ${models.length} models, INI: ${selectedIni}`);
    console.log(`[Download] First model structure:`, JSON.stringify(models[0], null, 2));
    
    // Her model için model_urls.json'dan URL'leri al
    const modelUrlsMap = {};
    for (const model of models) {
        if (!model.name) continue;
        const urls = await window.electronAPI.model.getUrlsFromJSON(selectedIni, model.name);
        modelUrlsMap[model.name] = urls;
        console.log(`[Download] URLs for ${model.name}:`, urls);
    }
    
    // Tüm indirme görevlerini topla (dosya varsa atla)
    const downloadTasks = [];
    const seenDestPaths = new Set();
    let taskIndex = 0;
    let skippedCount = 0;
    
    for (const model of models) {
        if (!model.name || !modelUrlsMap[model.name]) continue;
        
        // Skip coder sections
        if (model.name.startsWith('coder-') || model.name.startsWith('codgemma-')) {
            console.log(`[Download] Skipping coder section: ${model.name}`);
            continue;
        }
        
        const folderName = model.name.replace('-vision', '').replace('-Vision', '');
        const modelFolder = `${modelsDir}/${folderName}`;
        const urls = modelUrlsMap[model.name];
        
        // Ana model görevi
        if (urls.model && urls.model.startsWith('http')) {
            const fileName = urls.model.split('/').pop();
            const destPath = `${modelFolder}/${fileName}`;
            
            // Dosya var mı kontrol et
            const fileExists = await window.electronAPI.model.fileExists(destPath);
            if (fileExists) {
                console.log(`[Download] ✅ Already exists (skip): ${fileName}`);
                skippedCount++;
                continue;
            }
            
            // Aynı dosyaya paralel ikili yazımı engelle (paylaşılan gguf)
            if (seenDestPaths.has(destPath)) {
                console.log(`[Download] ⏭️ Duplicate dest (skip): ${destPath}`);
                skippedCount++;
                continue;
            }
            seenDestPaths.add(destPath);
            
            taskIndex++;
            downloadTasks.push({
                id: taskIndex,
                name: model.name,
                type: 'model',
                url: urls.model,
                destPath: destPath
            });
        }
        
        // mmproj görevi
        if (urls.mmproj && urls.mmproj.startsWith('http')) {
            const fileName = urls.mmproj.split('/').pop();
            const destPath = `${modelFolder}/${fileName}`;
            
            // Dosya var mı kontrol et
            const fileExists = await window.electronAPI.model.fileExists(destPath);
            if (fileExists) {
                console.log(`[Download] ✅ Already exists (skip): ${fileName}`);
                skippedCount++;
                continue;
            }
            
            // Aynı dosyaya paralel ikili yazımı engelle (paylaşılan gguf)
            if (seenDestPaths.has(destPath)) {
                console.log(`[Download] ⏭️ Duplicate dest (skip): ${destPath}`);
                skippedCount++;
                continue;
            }
            seenDestPaths.add(destPath);
            
            taskIndex++;
            downloadTasks.push({
                id: taskIndex,
                name: model.name,
                type: 'mmproj',
                url: urls.mmproj,
                destPath: destPath
            });
        }
        
        // Draft (speculative decoding) model görevi
        if (urls.modelDraft && urls.modelDraft.startsWith('http')) {
            const fileName = urls.modelDraft.split('/').pop();
            const destPath = `${modelFolder}/${fileName}`;
            
            // Dosya var mı kontrol et
            const fileExists = await window.electronAPI.model.fileExists(destPath);
            if (fileExists) {
                console.log(`[Download] ✅ Already exists (skip): ${fileName}`);
                skippedCount++;
                continue;
            }
            
            // Aynı dosyaya paralel ikili yazımı engelle (paylaşılan gguf)
            if (seenDestPaths.has(destPath)) {
                console.log(`[Download] ⏭️ Duplicate dest (skip): ${destPath}`);
                skippedCount++;
                continue;
            }
            seenDestPaths.add(destPath);
            
            taskIndex++;
            downloadTasks.push({
                id: taskIndex,
                name: model.name,
                type: 'model-draft',
                url: urls.modelDraft,
                destPath: destPath
            });
        }
    }
    
    // Store tasks for progress tracking
    currentDownloadTasks = downloadTasks;
    
    // Progress bar'lari simdiden olustur (ilk event gelmeden de gorunur olsun)
    for (const task of downloadTasks) {
        perModelProgressData[task.id] = { status: 'waiting', percent: 0, downloaded: 0, total: 0 };
        createPerModelProgressBar(task.id);
    }
    
    console.log(`[Download] Total tasks: ${downloadTasks.length + skippedCount}, Skipped (exists): ${skippedCount}, To download: ${downloadTasks.length}`);
    if (skippedCount > 0) {
        appendToLog('system', `⏭️ Skipped ${skippedCount} file(s) already downloaded`);
    }
    updateDownloadStatus(`⚡ Starting ${downloadTasks.length} downloads (max ${MAX_CONCURRENT_DOWNLOADS} concurrent)...`);
    appendToLog('system', `⚡ Download started: ${downloadTasks.length} files (max ${MAX_CONCURRENT_DOWNLOADS} concurrent)`);
    
    // Tüm görevleri PARALEL çalıştır
    const results = await runWithConcurrency(downloadTasks, MAX_CONCURRENT_DOWNLOADS, async (task) => {
        const folderName = task.name.replace('-vision', '').replace('-Vision', '');
        const logLabel = task.type === 'model' ? 'Model' : task.type === 'model-draft' ? 'Draft' : 'MMProj';
        
        appendToLog('system', `▶ [${logLabel}] Starting: ${task.name}`);
        console.log(`[Download] ${logLabel}: ${task.url} → ${task.destPath}`);
        
        const result = await window.electronAPI.model.download(task.url, task.destPath, task.id);
        
        if (result.success) {
            completedCount++;
            markPerModelComplete(task.id, true);
            const doneBytes = perModelProgressData[task.id]?.downloaded || 0;
            appendToLog('system', `✅ [${logLabel}] Completed: ${task.name} (${formatBytes(doneBytes)})`);
            return { success: true, name: task.name, type: logLabel };
        } else {
            markPerModelComplete(task.id, false, result.error);
            appendToLog('system', `❌ [${logLabel}] Error: ${task.name} - ${result.error}`, true);
            return { success: false, name: task.name, error: result.error };
        }
    });
    
    // Sonuçları özetle
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;
    
    updateDownloadStatus(`✅ Complete! ${successes}/${downloadTasks.length} successful, ${failures} failed`);
    appendToLog('system', `\n🎉 Download complete: ${successes} succeeded, ${failures} failed out of ${downloadTasks.length} files`);
    
    // Auto-generated INI oluştur
    await generateLocalINI();
}

function updateDownloadStatus(text) {
    const statusEl = document.getElementById('download-status');
    if (statusEl) {
        statusEl.textContent = text;
    }
}

async function generateLocalINI() {
    const iniSelect = document.getElementById('ini-select');
    const selectedIni = iniSelect?.value;
    
    if (!selectedIni) return;
    
    try {
        const result = await window.electronAPI.model.generateLocalINI(selectedIni);
        
        if (result.success && result.log) {
            console.log(`[INI] ${result.log}`);
        }
    } catch (err) {
        console.error('[INI] Failed to generate local INI:', err);
    }
}

// ============================================
// Notification Helpers
// ========================================
async function showNotification(title, message, type = 'info') {
    try {
        if (type === 'error') {
            await window.electronAPI.notification.error(title, message);
        } else if (type === 'warning') {
            await window.electronAPI.notification.warning(title, message);
        } else {
            await window.electronAPI.notification.info(title, message);
        }
    } catch (err) {
        console.error('[NOTIFICATION] Failed:', err);
        // Fallback: alert
        alert(`${title}: ${message}`);
    }
}

// ============================================
// Utility Functions
// ============================================
window.switchTab = switchTab;
window.selectModel = selectModel;

console.log('[RENDERER] All event listeners attached');
