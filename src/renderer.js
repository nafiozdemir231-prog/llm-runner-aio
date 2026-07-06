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
        vane: { running: false, port: 8090, host: '0.0.0.0' }
    },
    models: [],
    selectedModel: null
};

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[RENDERER] LLM Runner AIO initialized');
    
    // Load config
    await loadConfig();
    
    // Load language
    await loadLanguage(state.language);
    
    // Apply theme
    applyTheme(state.theme);
    
    // Apply font size
    applyFontSize(state.fontSize);
    
    // Load INI presets for llama.cpp
    await loadINIPresets();
    
    // Setup event listeners
    setupEventListeners();
    
    // Auto-start servers if enabled
    if (state.config.auto_start_servers) {
        console.log('[AUTO] Starting servers on launch...');
        startAllServers();
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

async function loadLanguage(langCode) {
    try {
        state.languages = await window.electronAPI.lang.read(langCode);
        state.language = langCode;
        
        // Update all translatable elements
        updateUIText();
        
        console.log('[LANG] Loaded:', langCode);
    } catch (err) {
        console.error('[LANG] Failed to load:', err);
    }
}

function updateUIText() {
    const strings = state.languages;
    
    // Toolbar buttons
    const tabs = document.querySelectorAll('.tab-btn');
    const tabKeys = ['tab_system', 'tab_servers', 'tab_picoding', 'tab_models'];
    tabs.forEach((btn, i) => {
        if (strings[tabKeys[i]]) {
            btn.textContent = strings[tabKeys[i]];
        }
    });
    
    // App title
    const appTitle = document.getElementById('app-title');
    if (appTitle && strings.app_title) {
        appTitle.textContent = strings.app_title;
    }
    
    // Panel headers
    const panelHeaders = document.querySelectorAll('.panel-header h2');
    const panelKeys = ['panel_system_detection', 'panel_server_management', 'panel_picoding_ide', 'panel_model_management'];
    panelHeaders.forEach((header, i) => {
        if (strings[panelKeys[i]]) {
            header.textContent = strings[panelKeys[i]];
        }
    });
    
    // All labels and buttons with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (strings[key]) {
            el.textContent = strings[key];
        }
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
            window.electronAPI.shell.openExternal('https://buymeacoffee.com');
        });
    }
    
    // INI preset callbacks
    setupINICallbacks();
    
    // System Detection model controls
    setupSystemModelControls();
    
    // Listen for server logs from main process
    window.electronAPI.server.onLog((data) => {
        appendToLog(data.type, data.message);
    });
    
    window.electronAPI.server.onError((data) => {
        appendToLog(data.type, `[ERROR] ${data.message}`, true);
    });
    
    window.electronAPI.server.onStop((data) => {
        updateServerStatus(data.type, false);
    });
    
    window.electronAPI.model.onProgress((data) => {
        updateDownloadProgress(data.percent, data.downloaded, data.total);
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
    
    // Apply settings
    if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
            const newTheme = document.querySelector('input[name="theme"]:checked')?.value;
            const newLang = document.getElementById('language-select')?.value;
            const startWithWindows = document.getElementById('start-with-windows')?.checked;
            const autoStart = document.getElementById('auto-start-servers')?.checked;
            
            if (newTheme) {
                applyTheme(newTheme);
            }
            
            if (newLang && newLang !== state.language) {
                await loadLanguage(newLang);
            }
            
            const updatedConfig = {
                ...state.config,
                theme: state.theme,
                font_size: state.fontSize,
                language: state.language,
                start_with_windows: startWithWindows,
                auto_start_servers: autoStart
            };
            
            await window.electronAPI.config.write(updatedConfig);
            
            closeModal();
            showNotification('Success', 'Settings applied successfully.');
        });
    }
}

function populateSettingsForm() {
    // Set theme radio
    const themeRadios = document.querySelectorAll('input[name="theme"]');
    themeRadios.forEach(radio => {
        radio.checked = radio.value === state.theme;
    });
    
    // Set font size
    document.getElementById('settings-font-size').textContent = `${state.fontSize}px`;
    
    // Set language
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.value = state.language;
    }
    
    // Set checkboxes
    const startWithWindows = document.getElementById('start-with-windows');
    if (startWithWindows) {
        startWithWindows.checked = state.config.start_with_windows || false;
    }
    
    const autoStart = document.getElementById('auto-start-servers');
    if (autoStart) {
        autoStart.checked = state.config.auto_start_servers || false;
    }
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
// Hardware Detection
// ============================================
async function detectHardware() {
    try {
        const hw = await window.electronAPI.hardware.detect();
        state.hardware = hw;
        
        // Update UI — null kontrolleri ile
        const gpuEl = document.getElementById('gpu-name');
        if (gpuEl) gpuEl.textContent = hw.gpuName || 'Not Detected';
        
        const vramEl = document.getElementById('vram-info');
        if (vramEl) vramEl.textContent = hw.vramGb > 0 ? `${hw.vramGb.toFixed(1)} GB` : '--';
        
        const ramEl = document.getElementById('ram-info');
        if (ramEl) ramEl.textContent = hw.ramGb > 0 ? `${hw.ramGb.toFixed(1)} GB` : '--';
        
        const cpuEl = document.getElementById('cpu-info');
        if (cpuEl) cpuEl.textContent = hw.cpuName || '--';
        
        // Log cikti
        const logOutput = document.getElementById('log-output');
        if (logOutput) {
            appendToLog('system', `GPU: ${hw.gpuName || 'None'}, VRAM: ${hw.vramGb}GB, RAM: ${hw.ramGb}GB`);
        }
        
        // INI eşleştirme debug
        console.log('[RENDERER] Hardware detect result:', hw);
        console.log('[RENDERER] iniMatch:', hw.iniMatch);
        
        // INI Presetleri yeniden tara ve otomatik eşleştir
        await refreshINIPresets(hw.iniMatch);
        
        // VRAM'e göre model önerileri göster
        renderModelRecommendations(hw.vramGb);
        
        // INI bilgisi güncelle
        if (hw.iniMatch) {
            const iniInfo = document.getElementById('ini-info');
            if (iniInfo) {
                iniInfo.textContent = `Config: ${hw.iniMatch}`;
            }
        }
        
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
                
                // llama.cpp için INI preset desteği
                let options = { port, host };
                if (server.type === 'llamacpp' && server.iniSelectId) {
                    const iniSelect = document.getElementById(server.iniSelectId);
                    if (iniSelect?.value) {
                        options.iniPreset = iniSelect.value;
                        appendToLog('system', `Using INI preset: ${options.iniPreset}`);
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
                }
                
                startBtn.disabled = false;
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
    
    btn.disabled = !enabled;
    if (enabled && url) {
        btn.onclick = () => {
            window.electronAPI.shell.openExternal(url);
        };
    }
}

function appendToLog(type, message, isError = false) {
    const logId = `${type === 'system' ? 'log-output' : type}-log`;
    const logArea = document.getElementById(logId);
    
    if (!logArea) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const prefix = isError ? `[${timestamp}] ❌ ${message}` : `[${timestamp}] ℹ️ ${message}`;
    
    // Append to textarea
    logArea.value += prefix + '\n';
    logArea.scrollTop = logArea.scrollHeight;
    
    // Max lines limit
    const lines = logArea.value.split('\n');
    if (lines.length > 500) {
        logArea.value = lines.slice(-300).join('\n');
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
}

async function scanModels() {
    const modelsDir = window.electronAPI.paths.getModelsDir();
    
    try {
        const models = await window.electronAPI.model.scan(modelsDir);
        state.models = models;
        
        renderModelList(models.files);
        
        // Update count and total size
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

function renderModelList(files) {
    const listEl = document.getElementById('model-list');
    if (!listEl) return;
    
    if (files.length === 0) {
        listEl.innerHTML = '<li class="empty-message">No GGUF files found.</li>';
        return;
    }
    
    listEl.innerHTML = files.map((model, index) => `
        <li data-index="${index}" onclick="selectModel(${index})">
            <input type="checkbox" onclick="event.stopPropagation()">
            <span>${model.name}</span>
            <span class="muted">${formatBytes(model.size)}</span>
            <span class="muted">${model.relativePath || ''}</span>
        </li>
    `).join('');
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
    const fill = document.getElementById('download-progress-fill');
    const percentText = document.getElementById('download-percent');
    
    if (fill) {
        fill.style.width = `${percent}%`;
    }
    
    if (percentText) {
        percentText.textContent = `${percent}%`;
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================
// Model Recommendations (VRAM'e göre)
// ============================================
function renderModelRecommendations(vramGb) {
    const container = document.getElementById('model-recommendations');
    
    if (!container) {
        console.warn('[RENDERER] #model-recommendations element not found in DOM');
        return;
    }
    
    if (vramGb <= 0) {
        container.innerHTML = '<p class="help-text">Run "Detect Hardware" first to see recommendations.</p>';
        return;
    }
    
    // VRAM'e göre model önerileri — GGUF Q4_K_M quantization
    const models = [
        { minVram: 4, maxVram: 8, name: 'llama-3.2-1b-instruct-q4_k_m.gguf', size: '~1GB', desc: 'Hızlı, düşük VRAM' },
        { minVram: 6, maxVram: 10, name: 'llama-3.2-3b-instruct-q4_k_m.gguf', size: '~2GB', desc: 'Dengeli performans' },
        { minVram: 8, maxVram: 12, name: 'mistral-7b-v2-q4_k_m.gguf', size: '~4.5GB', desc: 'Genel amaçlı' },
        { minVram: 10, maxVram: 16, name: 'llama-3-8b-instruct-q4_k_m.gguf', size: '~5.5GB', desc: 'En popüler 7B-8B sınıfı' },
        { minVram: 12, maxVram: 20, name: 'mixtral-8x7b-instruct-q4_k_m.gguf', size: '~9GB', desc: 'MoE mimarisi, yüksek kalite' },
        { minVram: 16, maxVram: 24, name: 'llama-3-70b-instruct-q4_k_m.gguf', size: '~38GB', desc: 'Yüksek kapasite GPU için' },
        { minVram: 24, maxVram: Infinity, name: 'llama-3-70b-instruct-q3_k_s.gguf', size: '~25GB', desc: 'Ultra büyük modeller' }
    ];
    
    // Kullanıcının VRAM aralığına uygun modelleri filtrele
    const recommended = models.filter(m => vramGb >= m.minVram && vramGb <= m.maxVram);
    
    if (recommended.length === 0) {
        container.innerHTML = '<p class="help-text">No specific recommendations for your GPU. Try custom download.</p>';
        return;
    }
    
    // HTML oluştur
    container.innerHTML = recommended.map(model => `
        <div class="model-rec-item">
            <div class="model-rec-info">
                <div class="model-rec-name">${model.name}</div>
                <div class="model-rec-details">${model.size} — ${model.desc}</div>
            </div>
            <button class="secondary-btn model-rec-btn" onclick="startModelDownload('${model.name}')">
                ⬇ Download
            </button>
        </div>
    `).join('');
    
    appendToLog('system', `Recommended ${recommended.length} model(s) for ${vramGb}GB VRAM`);
}

function startModelDownload(filename) {
    const urlInput = document.getElementById('download-url');
    // HuggingFace pattern: https://huggingface.co/TheBloke/{name}/resolve/main/{filename}
    const url = `https://huggingface.co/TheBloke/${filename.replace('.gguf', '')}/resolve/main/${filename}`;
    urlInput.value = url;
    
    // Models tab'ına scroll
    switchTab('models');
    showNotification('URL Ready', `${filename} URL added. Click Download.`);
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
    // Detect Project button
    const detectBtn = document.getElementById('btn-detect-project');
    if (detectBtn) {
        detectBtn.addEventListener('click', async () => {
            const result = await window.electronAPI.picoding.detectProject();
            if (result.success) {
                document.getElementById('picoding-path-display').textContent = result.path || 'Detected project found';
                showNotification('Success', `Project detected at: ${result.path}`);
            } else {
                showNotification('Warning', 'No project detected. Please select a folder manually.');
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
            toggleInstrBtn.textContent = instrContent.classList.contains('hidden') 
                ? '📖 Show Instructions' 
                : '📖 Hide Instructions';
        });
    }
    
    // Save Advisor Settings
    const saveAdvisorBtn = document.getElementById('btn-save-advisor');
    if (saveAdvisorBtn) {
        saveAdvisorBtn.addEventListener('click', async () => {
            const advisorUrl = document.getElementById('advisor-url')?.value;
            const apiKey = document.getElementById('advisor-key')?.value;
            const modelName = document.getElementById('advisor-model')?.value;
            
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
            const iniSelect = document.getElementById('ini-select');
            const selectedIni = iniSelect?.value;
            
            if (!selectedIni) {
                showNotification('Warning', 'Please select an INI file first.');
                return;
            }
            
            // INI'dan modelleri yükle
            const models = await window.electronAPI.model.getModelsFromINI(selectedIni);
            
            if (!models || models.length === 0) {
                showNotification('Info', 'No models found in this INI file.');
                return;
            }
            
            // Model listesini göster
            renderSystemModelList(models);
            
            // İndirme işlemini başlat
            await downloadAllModels(models);
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

async function downloadAllModels(models) {
    const modelsDir = window.electronAPI.paths.getModelsDir();
    let completed = 0;
    let total = models.length;
    
    for (const model of models) {
        if (!model.model_url && !model.mmproj_url) continue;
        
        const folderName = model.name.replace('-vision', '').replace('-Vision', '');
        const modelFolder = `${modelsDir}/${folderName}`;
        
        // Ana model
        if (model.model_url) {
            const fileName = model.model_url.split('/').pop();
            const destPath = `${modelFolder}/${fileName}`;
            
            updateDownloadStatus(`Downloading ${model.name}...`);
            
            const result = await window.electronAPI.model.download(model.model_url, destPath);
            
            if (result.success) {
                completed++;
                updateDownloadProgress(result.percent || 100, result.downloaded, result.total);
                appendToLog('system', `Completed: ${model.name}`);
            } else {
                appendToLog('system', `Error downloading ${model.name}: ${result.error}`, true);
            }
        }
        
        // mmproj
        if (model.mmproj_url) {
            const fileName = model.mmproj_url.split('/').pop();
            const destPath = `${modelFolder}/${fileName}`;
            
            const result = await window.electronAPI.model.download(model.mmproj_url, destPath);
            
            if (result.success) {
                completed++;
                appendToLog('system', `Completed: ${model.name} mmproj`);
            }
        }
    }
    
    updateDownloadStatus(`All downloads complete! (${completed}/${total} models)`);
    
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
            const autoLog = document.getElementById('auto-log');
            if (autoLog) {
                autoLog.value += `[OK] ${result.log}\n`;
                autoLog.scrollTop = autoLog.scrollHeight;
            }
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
