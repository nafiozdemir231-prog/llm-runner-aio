/**
 * LLM Runner AIO - Process Manager
 * 
 * PyQt6'daki stdout/stderr stream parser'ın Electron karşılığı
 * - Process log stream'lerini yakalama
 * - Console UI'ya feed etme
 * - Log buffer yönetimi
 * - Orphan process detection
 */

const { execSync } = require('child_process');
const EventEmitter = require('events');

class ProcessManager extends EventEmitter {
    constructor(maxLogs = 1000) {
        super();
        this.maxLogs = maxLogs;
        this.logs = [];
        this.processes = new Map(); // pid → process info
    }
    
    // ============================================
    // Log Buffer Management
    // ============================================
    
    /**
     * Log ekle
     * @param {string} type - Log tipi (info, error, warn, server)
     * @param {string} source - Kaynak (server name, system, vb.)
     * @param {string} message - Log mesajı
     */
    addLog(type, source, message) {
        const log = {
            timestamp: new Date().toISOString(),
            type,
            source,
            message: message.trim()
        };
        
        this.logs.push(log);
        
        // Max limit kontrolü
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs / 2);
        }
        
        // Event emit (UI güncellemesi için)
        this.emit('log-added', log);
    }
    
    /**
     * Tüm logları döndür
     * @param {number} count - Son N log (varsayılan: tümü)
     * @returns {Array} Log array'i
     */
    getLogs(count = null) {
        if (count === null) {
            return [...this.logs];
        }
        return this.logs.slice(-count);
    }
    
    /**
     * Logları temizle
     */
    clearLogs() {
        this.logs = [];
        this.emit('logs-cleared');
    }
    
    /**
     * Logları filtrele
     * @param {Object} filters - Filtre objesi ({type, source, keyword})
     * @returns {Array} Filtrelenmiş loglar
     */
    filterLogs(filters = {}) {
        return this.logs.filter(log => {
            if (filters.type && log.type !== filters.type) return false;
            if (filters.source && log.source !== filters.source) return false;
            if (filters.keyword && !log.message.toLowerCase().includes(filters.keyword.toLowerCase())) return false;
            return true;
        });
    }
    
    // ============================================
    // Process Stream Handling
    // ============================================
    
    /**
     * Process stdout stream'ini bağla
     * @param {import('child_process').ChildProcess} child - Child process
     * @param {string} source - Process adı
     */
    attachStdout(child, source) {
        if (!child?.stdout) return;
        
        child.stdout.on('data', (data) => {
            const message = data.toString();
            this.addLog('info', source, message);
        });
    }
    
    /**
     * Process stderr stream'ini bağla
     * @param {import('child_process').ChildProcess} child - Child process
     * @param {string} source - Process adı
     */
    attachStderr(child, source) {
        if (!child?.stderr) return;
        
        child.stderr.on('data', (data) => {
            const message = data.toString();
            this.addLog('error', source, message);
        });
    }
    
    /**
     * Process'i izle ve kaydet
     * @param {string} name - Process adı
     * @param {import('child_process').ChildProcess} child - Child process
     */
    trackProcess(name, child) {
        if (!child?.pid) return;
        
        this.processes.set(child.pid, {
            name,
            pid: child.pid,
            startTime: new Date(),
            child
        });
        
        // stdout/stderr bağla
        this.attachStdout(child, name);
        this.attachStderr(child, name);
        
        // Exit event
        child.on('exit', (code, signal) => {
            this.addLog('info', name, `Exited (code: ${code}, signal: ${signal})`);
            this.processes.delete(child.pid);
            this.emit('process-exited', { name, pid: child.pid, code, signal });
        });
    }
    
    /**
     * Process'i izlemekten çıkar
     * @param {number} pid - PID
     */
    untrackProcess(pid) {
        this.processes.delete(pid);
    }
    
    // ============================================
    // Orphan Process Detection
    // ============================================
    
    /**
     * Geride kalan process'leri tespit et
     * PyQt6'daki cleanup_orphan_processes() eşdeğeri
     * @returns {Array} Orphan process listesi
     */
    detectOrphans() {
        const orphans = [];
        
        try {
            // Windows: tasklist komutu
            const output = execSync('tasklist /FO CSV /NH', {
                encoding: 'utf8',
                timeout: 5000
            });
            
            const knownPids = new Set();
            for (const [, info] of this.processes.entries()) {
                knownPids.add(info.pid);
            }
            knownPids.add(process.pid);
            knownPids.add(process.ppid);
            
            const lines = output.trim().split('\n');
            
            for (const line of lines) {
                const match = line.match(/"([^"]+)".*"(\d+)"/);
                if (!match) continue;
                
                const pid = parseInt(match[2], 10);
                
                if (knownPids.has(pid)) continue;
                
                orphans.push({
                    name: match[1],
                    pid
                });
            }
        } catch (err) {
            console.error('[PROCESS] Orphan detection failed:', err.message);
        }
        
        return orphans;
    }
    
    /**
     * Orphan process'leri temizle
     * @returns {number} Temizlenen process sayısı
     */
    async cleanupOrphans() {
        const orphans = this.detectOrphans();
        let cleaned = 0;
        
        for (const orphan of orphans) {
            try {
                execSync(`taskkill /PID ${orphan.pid} /T /F`, {
                    timeout: 3000
                });
                cleaned++;
                this.addLog('warn', 'system', `Killed orphan process: ${orphan.name} (PID: ${orphan.pid})`);
            } catch (err) {
                // Zaten bitmiş olabilir
            }
        }
        
        return cleaned;
    }
    
    // ============================================
    // Process Status
    // ============================================
    
    /**
     * Tüm tracked process'lerin durumunu döndür
     * @returns {Object} Durum map'i
     */
    getStatus() {
        const status = {};
        
        for (const [pid, info] of this.processes.entries()) {
            status[pid] = {
                name: info.name,
                pid: info.pid,
                running: !info.child?.killed,
                startTime: info.startTime
            };
        }
        
        return status;
    }
    
    /**
     * Process sayısını döndür
     * @returns {number} Aktif process sayısı
     */
    getProcessCount() {
        let count = 0;
        for (const [, info] of this.processes.entries()) {
            if (!info.child?.killed) count++;
        }
        return count;
    }
    
    // ============================================
    // Utility
    // ============================================
    
    /**
     * Log istatistikleri
     * @returns {Object} İstatistikler
     */
    getStats() {
        const stats = {
            total: this.logs.length,
            byType: { info: 0, error: 0, warn: 0 },
            bySource: {}
        };
        
        for (const log of this.logs) {
            if (stats.byType[log.type] !== undefined) {
                stats.byType[log.type]++;
            }
            
            if (!stats.bySource[log.source]) {
                stats.bySource[log.source] = 0;
            }
            stats.bySource[log.source]++;
        }
        
        return stats;
    }
}

// ============================================
// Module Export
// ============================================
module.exports = ProcessManager;
