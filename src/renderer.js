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
        searxng: { running: false, port: 8080, host: '0.0.0.0' },
        openwebui: { running: false, port: 3000, host: '127.0.0.1' },
        llamacpp: { running: false, port: 1234, host: '0.0.0.0' },
        vane: { running: false, port: 3001, host: '0.0.0.0' }
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
 * Notification toast gosterir
 * PyQt6'da: QMessageBox veya custom toast widget
 */
function showNotification(title, message, level = 'info') {
    // Mevcut notification sistemi varsa kullan, yoksa console.log
    if (window.electronAPI && window.electronAPI.notification) {
        window.electronAPI.notification.show(title, message);
    }
    console.log(`[NOTIFICATION ${level.toUpperCase()}]: ${title} - ${message}`);
}

// ============================================
// Initialization
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
    
    // Auto-start individual servers if enabled
    if (state.config.auto_start_servers) {
        console.log('[AUTO] Checking auto-start for individual servers...');
        const serverMap = [
            { key: 'auto_start_searxng', type: 'searxng' },
            { key: 'auto_start_openwebui', type: 'openwebui' },
            { key: 'auto_start_vane', type: 'vane' },
            { key: 'auto_start_llamacpp', type: 'llamacpp' }
        ];
        
        for (const srv of serverMap) {
            if (state.config[srv.key]) {
                console.log(`[AUTO] Starting ${srv.type}...`);
                const portInput = document.getElementById(`${srv.type}-port`);
                const hostInput = document.getElementById(`${srv.type}-host`);
                const port = parseInt(portInput?.value || (srv.type === 'searxng' ? 8080 : srv.type === 'openwebui' ? 3000 : srv.type === 'vane' ? 3001 : 1234));
                const host = hostInput?.value || '0.0.0.0';
                
                // llama.cpp için INI preset'i de gönder
                const startOptions = { port, host };
                if (srv.type === 'llamacpp' && state.config.selected_ini) {
                    startOptions.iniPreset = state.config.selected_ini;
                    const ctxEl = document.getElementById('llamacpp-ctx');
                    if (ctxEl) {
                        startOptions.ctxSize = parseInt(ctxEl.value) || 8192;
                    }
                    console.log(`[AUTO] llama.cpp INI: ${startOptions.iniPreset}, Ctx: ${startOptions.ctxSize}`);
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
async function autoDetectAndSaveHardware() {
    try {
        console.log('[HARDWARE] Auto-detecting hardware on startup...');
        const hw = await window.electronAPI.hardware.detect();
        
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
            { key: 'vane_port', id: 'vane-port', defaultVal: 3001 }
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
            { key: 'openwebui_host', id: 'openwebui-host', defaultVal: '0.0.0.0' },
            { key: 'llamacpp_host', id: 'llamacpp-host', defaultVal: '0.0.0.0' },
            { key: 'vane_host', id: 'vane-host', defaultVal: '0.0.0.0' }
        ];
        
        for (const field of hostFields) {
            const el = document.getElementById(field.id);
            if (el) {
                el.value = state.config[field.key] ?? field.defaultVal;
            }
        }
        
        // Restore llama.cpp settings
        const llamacppCtx = document.getElementById('llamacpp-ctx');
        if (llamacppCtx) {
            llamacppCtx.value = state.config.llamacpp_ctx || 65536;
        }
        
        // Restore auto-start checkboxes
        const autoStartChecks = [
            { key: 'auto_start_servers', id: 'cb-auto-server-autostart' },
            { key: 'auto_start_searxng', id: 'cb-auto-searxng' },
            { key: 'auto_start_openwebui', id: 'cb-auto-openwebui' },
            { key: 'auto_start_vane', id: 'cb-auto-vane' },
            { key: 'auto_start_llamacpp', id: 'cb-auto-llamacpp' }
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
            searxng_host: document.getElementById('searxng-host')?.value || '127.0.0.1',
            openwebui_host: document.getElementById('openwebui-host')?.value || '0.0.0.0',
            llamacpp_host: document.getElementById('llamacpp-host')?.value || '0.0.0.0',
            vane_host: document.getElementById('vane-host')?.value || '0.0.0.0',
            llamacpp_ctx: parseInt(document.getElementById('llamacpp-ctx')?.value) || 65536,
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
    
    // 1) Tab buttons
    const tabs = document.querySelectorAll('.tab-btn');
    const tabKeys = ['tab_system', 'tab_servers', 'tab_picoding', 'tab_models'];
    tabs.forEach((btn, i) => {
        if (s[tabKeys[i]]) btn.textContent = s[tabKeys[i]];
    });
    
    // 2) App title
    const appTitle = document.getElementById('app-title');
    if (appTitle && s.app_title) appTitle.textContent = s.app_title;
    
    // 3) Panel headers (h2)
    const panelHeaders = document.querySelectorAll('.panel-header h2');
    const panelKeys = ['panel_system_detection', 'panel_server_management', 'panel_picoding_ide', 'panel_model_management', 'panel_settings'];
    panelHeaders.forEach((header, i) => {
        if (s[panelKeys[i]]) header.textContent = s[panelKeys[i]];
    });
    
    // 4) Fieldset legends (only those with data-i18n)
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
    const closeSettings = document.getElementById('btn-close-settings');
    if (closeSettings && s.btn_close_settings) closeSettings.textContent = s.btn_close_settings;
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
    const piReady = document.getElementById('pi-ready-status');
    if (piReady && s.label_pi_ready) piReady.textContent = s.label_pi_ready;
    
    // 13) Models tab
    const refreshModels = document.getElementById('btn-refresh-models');
    if (refreshModels && s.refresh_models_btn) refreshModels.textContent = s.refresh_models_btn;
    const deleteSelected = document.getElementById('btn-delete-selected');
    if (deleteSelected && s.delete_selected_btn) deleteSelected.textContent = s.delete_selected_btn;
    const browseModels = document.getElementById('btn-browse-models');
    if (browseModels && s.browse_models_btn) browseModels.textContent = s.browse_models_btn;
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
        { id: 'section_llamacpp', key: 'section_llamacpp' }
    ];
    document.querySelectorAll('.server-checkboxes label span').forEach((label, i) => {
        if (s[serverLabels[i].key]) label.textContent = s[serverLabels[i].key];
    });
    
    // 16) Theme buttons
    const themeLight = document.getElementById('theme-light');
    if (themeLight && s.theme_light) themeLight.textContent = s.theme_light;
    const themeDark = document.getElementById('theme-dark');
    if (themeDark && s.theme_dark) themeDark.textContent = s.theme_dark;
    
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
    
    // Update theme toggle button icon
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
    
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
        document.getElementById('font-size-display'),
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
    
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const newTheme = state.theme === 'dark' ? 'light' : 'dark';
            applyTheme(newTheme);
        });
    }
    
    // Font size controls
    const fontIncrease = document.getElementById('font-increase');
    const fontDecrease = document.getElementById('font-decrease');
    
    if (fontIncrease) {
        fontIncrease.addEventListener('click', () => {
            applyFontSize(state.fontSize + 1);
        });
    }
    
    if (fontDecrease) {
        fontDecrease.addEventListener('click', () => {
            applyFontSize(state.fontSize - 1);
        });
    }
    
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
        { id: 'cb-auto-llamacpp', key: 'auto_start_llamacpp' }
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
    'searxng-port', 'openwebui-port', 'llamacpp-port', 'vane-port',
    'searxng-host', 'openwebui-host', 'llamacpp-host', 'vane-host',
    'llamacpp-ctx'
];

autoSaveInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('change', () => {
            saveAllSettings();
        });
        // Also save on input for real-time updates
        el.addEventListener('input', () => {
            clearTimeout(el._saveTimeout);
            el._saveTimeout = setTimeout(() => {
                saveAllSettings();
            }, 500); // Debounce 500ms
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
function setupServerControls() {
    // Prevent duplicate IPC listener registration on re-entry
    if (eventListenersSetup) return;
    eventListenersSetup = true;
    
    // Individual server start/stop buttons
    const servers = [
        { type: 'searxng', startId: 'btn-start-searxng', stopId: 'btn-stop-searxng', browserId: 'btn-open-searxng', portId: 'searxng-port', hostId: 'searxng-host', statusId: 'searxng-status', logId: 'searxng-log' },
        { type: 'openwebui', startId: 'btn-start-openwebui', stopId: 'btn-stop-openwebui', browserId: 'btn-open-openwebui', portId: 'openwebui-port', hostId: 'openwebui-host', statusId: 'openwebui-status', logId: 'openwebui-log' },
        { 
            type: 'llamacpp', 
            startId: 'btn-start-llamacpp', 
            stopId: 'btn-stop-llamacpp', 
            browserId: 'btn-open-llamacpp',
            portId: 'llamacpp-port', 
            hostId: 'llamacpp-host', 
            iniSelectId: 'ini-select',
            statusId: 'llamacpp-status', 
            logId: 'llamacpp-log' 
        },
        { type: 'vane', startId: 'btn-start-vane', stopId: 'btn-stop-vane', browserId: 'btn-open-vane', portId: 'vane-port', hostId: 'vane-host', statusId: 'vane-status', logId: 'vane-log' }
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
        state.servers[data.type].running = false;
        updateServerStatus(data.type, false);
        appendToLog(data.type, 'Stopped.');
        
        // Sunucu durduysa start butonunu tekrar aktif et
        const startBtn = document.getElementById(`btn-start-${data.type}`);
        if (startBtn) startBtn.disabled = false;
    });
    
    servers.forEach(server => {
        const startBtn = document.getElementById(server.startId);
        const stopBtn = document.getElementById(server.stopId);
        const browserBtn = document.getElementById(server.browserId);
        
        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                const port = parseInt(document.getElementById(server.portId)?.value || server.port);
                const host = document.getElementById(server.hostId)?.value || '0.0.0.0';
                
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
                    // Context size — PyQt6'daki lc_ctx ile ayni
                    const ctxEl = document.getElementById('llamacpp-ctx');
                    if (ctxEl) {
                        options.ctxSize = parseInt(ctxEl.value) || 8192;
                        appendToLog('system', `llama.cpp ctx-size: ${options.ctxSize}`);
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
                
                const importResult = await window.electronAPI.db.importFunctions();
                
                if (importResult.success) {
                    let msg = `[INFO] Functions imported: ${importResult.functionsAdded || 0} added, ${importResult.functionsUpdated || 0} updated`;
                    msg += `\nTools: ${importResult.toolsAdded || 0} added, ${importResult.toolsUpdated || 0} updated`;
                    appendToLog('openwebui', msg);
                } else {
                    appendToLog('openwebui', `[WARN] Function import failed: ${importResult.error || importResult.message}`, true);
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
        const port = parseInt(portInput?.value || 8080);
        const host = hostInput?.value || '0.0.0.0';
        
        appendToLog(type, `Starting ${type} on ${host}:${port}...`);
        
        const result = await window.electronAPI.server.start(type, { port, host });
        
        if (result.success) {
            state.servers[type].running = true;
            updateServerStatus(type, true);
            appendToLog(type, `${type} started.`);
        } else {
            appendToLog(type, `${type} failed: ${result.error}`, true);
        }
    }
}

async function stopAllServers() {
    const types = ['searxng', 'openwebui', 'llamacpp', 'vane'];
    
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
    console.log('[DEBUG] updateDeleteButtonState called, checked:', checkboxes.length, 'deleteBtn:', !!deleteBtn);
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
    
    console.log('[DEBUG] Setting up model list event delegation');
    
    listEl.addEventListener('click', (e) => {
        // Checkbox tiklama
        if (e.target.type === 'checkbox') {
            console.log('[DEBUG] checkbox CLICKED! checked:', e.target.checked);
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
            console.log('[DEBUG] li clicked, checkbox toggled to:', checkbox.checked);
            
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
            <span class="model-name">${model.name}</span>
            <span class="muted model-size">${formatBytes(model.size)}</span>
            <span class="muted model-path">${model.relativePath || ''}</span>
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
    
    // Secilen modelleri topla
    const selectedModels = Array.from(checkboxes).map(cb => {
        const li = cb.closest('li');
        const index = parseInt(li?.dataset.index);
        return state.models.files[index];
    }).filter(m => m !== undefined);
    
    // Onay dialogu - PyQT6'daki QMessageBox.question() karsiligi
    const names = selectedModels.map(m => `- ${m.name}`).join('\n');
    const message = `Delete ${selectedModels.length} model(s)?\n\n${names}\n\nThis cannot be undone.`;
    
    const confirmed = await window.electronAPI.notification.confirm(
        'Confirm Delete',
        message
    );
    
    if (!confirmed) return;
    
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

async function downloadModel() {
    const urlInput = document.getElementById('download-url');
    const url = urlInput?.value;
    
    if (!url) {
        showNotification('Warning', 'Please enter a HuggingFace URL.');
        return;
    }
    
    const modelsDir = window.electronAPI.paths.getModelsDir();
    const fileName = url.split('/').pop();
    const destPath = `${modelsDir}/${fileName}`;
    
    try {
        const result = await window.electronAPI.model.download(url, destPath);
        
        if (result.success) {
            showNotification('Success', `Downloaded to: ${destPath}`);
            // Re-scan models
            await scanModels();
        } else {
            showNotification('Error', `Download failed: ${result.error}`);
        }
    } catch (err) {
        showNotification('Error', `Download failed: ${err.message}`);
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
        <span class="per-model-label">${task.name}</span>
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
                document.getElementById('picoding-path-display').textContent = 
                    `${result.path}\n${markerText}`.replace(/\s*\n\s*/g, '\n');
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
    
    // Add to PATH button
    const addPathBtn = document.getElementById('btn-add-to-path');
    if (addPathBtn) {
        addPathBtn.addEventListener('click', async () => {
            const confirmed = await window.electronAPI.notification.confirm(
                'Add to PATH',
                'Add picoding folder to Windows PATH? This allows you to type "pi" in any terminal.'
            );
            
            if (confirmed) {
                const result = await window.electronAPI.picoding.addToPath();
                if (result.success) {
                    showNotification('Success', 'picoding added to PATH successfully!');
                } else {
                    showNotification('Error', `Failed to add to PATH: ${result.error}`);
                }
            }
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
            
            // Select'ten veya custom input'tan model al
            let modelName = document.getElementById('advisor-model-custom')?.value;
            if (!modelName) {
                modelName = document.getElementById('advisor-model')?.value;
            }
            
            if (!advisorUrl || !apiKey || !modelName) {
                showNotification('Warning', 'Please fill in all MCP Advisor fields.');
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
                renderSystemModelList(models);
                
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
}

function renderSystemModelList(models) {
    const listEl = document.getElementById('system-model-list');
    if (!listEl) return;
    
    listEl.innerHTML = models.map((model, index) => `
        <li data-index="${index}">
            <span>[${model.name}]</span>
            <span class="muted">${model.model_url ? '✓ Ready' : '✗ No URL'}</span>
        </li>
    `).join('');
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
    let taskIndex = 0;
    let skippedCount = 0;
    
    for (const model of models) {
        if (!model.name || !modelUrlsMap[model.name]) continue;
        
        // Sadece -vision ile bitenleri indir
        if (!model.name.endsWith('-vision')) {
            console.log(`[Download] Skipping non-vision section: ${model.name}`);
            continue;
        }
        
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
            
            taskIndex++;
            downloadTasks.push({
                id: taskIndex,
                name: model.name,
                type: 'mmproj',
                url: urls.mmproj,
                destPath: destPath
            });
        }
    }
    
    // Store tasks for progress tracking
    currentDownloadTasks = downloadTasks;
    
    console.log(`[Download] Total tasks: ${downloadTasks.length + skippedCount}, Skipped (exists): ${skippedCount}, To download: ${downloadTasks.length}`);
    if (skippedCount > 0) {
        appendToLog('system', `⏭️ Skipped ${skippedCount} file(s) already downloaded`);
    }
    updateDownloadStatus(`⚡ Starting ${downloadTasks.length} downloads in parallel...`);
    appendToLog('system', `⚡ Parallel download started: ${downloadTasks.length} files`);
    
    // Tüm görevleri PARALEL çalıştır
    const results = await Promise.allSettled(downloadTasks.map(async (task) => {
        const folderName = task.name.replace('-vision', '').replace('-Vision', '');
        const logLabel = task.type === 'model' ? 'Model' : 'MMProj';
        
        appendToLog('system', `▶ [${logLabel}] Starting: ${task.name}`);
        console.log(`[Download] ${logLabel}: ${task.url} → ${task.destPath}`);
        
        const result = await window.electronAPI.model.download(task.url, task.destPath, task.id);
        
        if (result.success) {
            completedCount++;
            markPerModelComplete(task.id, true);
            appendToLog('system', `✅ [${logLabel}] Completed: ${task.name} (${formatBytes(downloaded || 0)})`);
            return { success: true, name: task.name, type: logLabel };
        } else {
            markPerModelComplete(task.id, false, result.error);
            appendToLog('system', `❌ [${logLabel}] Error: ${task.name} - ${result.error}`, true);
            return { success: false, name: task.name, error: result.error };
        }
    }));
    
    // Sonuçları özetle
    const successes = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
    const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.success)).length;
    
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
