"""
LLM Runner AIO - Tab 2: Servers
SearXNG, OpenWebUI, llama.cpp sunucu yönetimi
"""

import subprocess
import threading
import time
import os
import psutil
import socket
import webbrowser
import configparser
from pathlib import Path
from datetime import datetime

from PyQt6.QtWidgets import (
    QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QSpinBox, QComboBox, QTextEdit, QGroupBox,
    QCheckBox, QSplitter, QWidget, QScrollArea,
    QAbstractItemView, QStyle, QMessageBox
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer
from PyQt6.QtGui import QFont

from app import ROOT, AppManager


class ServerWorker(QThread):
    """Sunucu process yönetimi"""
    log_signal = pyqtSignal(str)
    finished_signal = pyqtSignal(int)
    pid = 0

    def __init__(self):
        super().__init__()
        self._process = None
        self._running = False
        self._reader_thread = None
        self._status = "stopped"  # "running" veya "stopped"

    def get_status(self):
        """Process durumunu döndür (UI için)"""
        if self._process:
            poll_result = self._process.poll()
            if poll_result is None:
                return "running"
            else:
                return "stopped"
        return "stopped"

    def start_process(self, cmd, cwd=None, env=None):
        self._running = True
        self._status = "running"
        self.log_signal.emit(f"[START] Command: {' '.join(cmd)}")

        process_env = os.environ.copy()
        if env:
            process_env.update(env)

        try:
            flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            # npm gibi komutlar için shell=True gerekli (Windows .cmd dosyalari)
            cmd_str = str(cmd[0]).lower()
            use_shell = cmd_str.endswith('.bat') or cmd_str.endswith('.cmd') or cmd[0] == 'npm' or cmd[0] == 'npx'
            self._process = subprocess.Popen(
                cmd,
                cwd=cwd,
                env=process_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=flags,
                shell=use_shell,
            )
            self.pid = self._process.pid
            self.log_signal.emit(f"[PID] {self.pid}")

            def read_output():
                while self._running and self._process:
                    try:
                        line = self._process.stdout.readline()
                    except Exception:
                        break
                    if not line:
                        if not self._process or self._process.poll() is not None:
                            break
                        time.sleep(0.1)
                        continue
                    line = line.strip()
                    if line:
                        self.log_signal.emit(line)

                # Process bitti
                self._running = False
                self._status = "stopped"
                if self._process:
                    retcode = self._process.poll()
                else:
                    retcode = 0
                self.log_signal.emit(f"[STOP] Process exited with code {retcode}")
                self.finished_signal.emit(retcode if retcode is not None else -1)

            self._reader_thread = threading.Thread(target=read_output, daemon=True)
            self._reader_thread.start()

        except Exception as e:
            self.log_signal.emit(f"[ERROR] {str(e)}")
            self._status = "stopped"
            self.finished_signal.emit(-1)

    def stop_process(self, timeout=10):
        """
        Process'i zarifçe durdur. 10s timeout sonrası force kill.
        Bug #15: Graceful Shutdown Timeout
        """
        self._running = False
        if self._process and self._process.poll() is None:
            self.log_signal.emit(f"[STOP] Stopping process {self._process.pid} (timeout={timeout}s)...")
            try:
                # psutil ile process tree yönetimi
                parent_pid = self._process.pid
                parent_proc = None
                children_procs = []

                try:
                    parent_proc = psutil.Process(parent_pid)
                    children_procs = parent_proc.children(recursive=True)
                    self.log_signal.emit(f"[STOP] Found {len(children_procs)} child process(es)")
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

                # 1. Önce çocukları terminate et (leaf first)
                for child in reversed(children_procs):
                    try:
                        child.terminate()
                        self.log_signal.emit(f"[STOP] Terminated child PID {child.pid}")
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass

                # 2. Parent'ı terminate et
                if parent_proc:
                    try:
                        parent_proc.terminate()
                        self.log_signal.emit(f"[STOP] Terminated parent PID {parent_pid}")
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass

                # 3. Graceful shutdown için bekle
                gone, alive = psutil.wait_procs(children_procs + ([parent_proc] if parent_proc else []), timeout=timeout)

                # 4. Timeout kalanları force kill et
                if alive:
                    self.log_signal.emit(f"[STOP] {len(alive)} process(es) didn't stop. Force killing...")
                    for proc in alive:
                        try:
                            proc.kill()
                            self.log_signal.emit(f"[STOP] Killed PID {proc.pid}")
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            pass
                    psutil.wait_procs(alive, timeout=2)

                # 5. subprocess.Popen referansını temizle
                self._process = None
                self._status = "stopped"
                self.log_signal.emit("[STOP] Process stopped.")
                self.finished_signal.emit(0)

            except Exception as e:
                self.log_signal.emit(f"[ERROR] Stop error: {str(e)}")
                self._status = "stopped"
                self.finished_signal.emit(-1)
        else:
            self.log_signal.emit("[STOP] Process already stopped or not running.")
            self._status = "stopped"
            self.finished_signal.emit(0)

    def force_kill(self):
        """Process'i ACILEN öldür — graceful termination YOK, direkt kill!"""
        self._running = False
        import psutil
        
        self.log_signal.emit(f"[FORCE KILL] Aggressively killing process {self._process.pid if self._process else 'unknown'}...")
        
        try:
            # 1. Popen referansından direkt kill
            if self._process and self._process.poll() is None:
                pid = self._process.pid
                self._process.kill()  # Direkt kill, terminate DEĞİL!
                self.log_signal.emit(f"[FORCE KILL] Killed Popen PID {pid}")
                self._process = None
            
            # 2. Port bazlı fallback — eğer process hala çalışıyorsa
            #    ama _process referansı kaybolmuşsa
            time.sleep(0.5)  # Windows'un file handle'larını salması için
            
        except Exception as e:
            self.log_signal.emit(f"[FORCE KILL] Error during kill: {str(e)}")
        
        finally:
            self._process = None
            self._status = "stopped"
            self.log_signal.emit("[FORCE KILL] Process terminated.")
            self.finished_signal.emit(-1)  # -1 = zorla sonlandırıldı


class SearXNGWorker(ServerWorker):
    """SearXNG özel başlatma — app.py mantığını INLINE olarak çalıştırır"""

    def __init__(self):
        super().__init__()
        self._port = 8080
        self._start_args = {}

    def start_server(self, port=8080, host="0.0.0.0"):
        """Parametreleri kaydet ve thread'i baslat"""
        self._start_args = {"port": port, "host": host}
        self.start()  # QThread'i baslat

    def run(self):
        """Thread icinde calistir"""
        self.start_server_internal(**self._start_args)

    def start_server_internal(self, port=8080, host="0.0.0.0"):
        """SearXNG'yi dogrudan python -m ile baslat"""
        base_dir = ROOT / "searxng"
        # Global venv kullan (setup'ta kuruldu)
        venv_python = ROOT / "venv" / "Scripts" / "python.exe"
        settings_file = base_dir / "searx-data" / "settings.yml"

        # venv kontrol
        if not venv_python.exists():
            self.log_signal.emit(f"[ERROR] venv\\Scripts\\python.exe bulunamadı: {venv_python}")
            self.finished_signal.emit(-1)
            return

        # Port ve bind-address'i settings.yml'ye yaz
        try:
            import yaml
            if settings_file.exists():
                with open(str(settings_file), 'r', encoding='utf-8') as f:
                    settings = yaml.safe_load(f)
                if settings is None:
                    settings = {}
                if 'server' not in settings:
                    settings['server'] = {}
                settings['server']['port'] = port
                settings['server']['bind_address'] = host  # Bug: Bind address ekle
                # static_path ve templates_path'i boş bırak — SearXNG kendi searx_dir'ini kullanir
                if 'ui' in settings:
                    settings['ui'].setdefault('static_path', '')
                    settings['ui'].setdefault('templates_path', '')
                with open(str(settings_file), 'w', encoding='utf-8') as f:
                    yaml.dump(settings, f, default_flow_style=False, allow_unicode=True)
                self.log_signal.emit(f"[CONFIG] Port {port}, Bind: {host} written to settings.yml")
            else:
                self.log_signal.emit("[WARN] settings.yml not found")
        except Exception as e:
            self.log_signal.emit(f"[WARN] Could not update settings.yml: {e}")

        env = os.environ.copy()
        env['SEARXNG_SETTINGS_PATH'] = str(settings_file)
        # PYTHONPATH'e searxng klasorunu ekle
        existing_pythonpath = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = str(base_dir) + os.pathsep + existing_pythonpath

        cmd = [str(venv_python), "-m", "searx.webapp"]
        self.log_signal.emit(f"[START] SearXNG starting on port {port}")
        self.log_signal.emit(f"[START] Python: {venv_python}")
        self.log_signal.emit(f"[START] PYTHONPATH: {base_dir}")
        self.start_process(cmd, cwd=str(base_dir), env=env)


class OpenWebUIWorker(ServerWorker):
    """OpenWebUI özel başlatma — doğrudan python -m uvicorn komutu ile çalıştırır
    .bat dosyası KULLANILMAZ, process tree kill ile güvenli stop"""

    def __init__(self):
        super().__init__()
        self._port = 3000
        self._launcher_pid = os.getpid()
        self._start_args = {}

    def start_server(self, port=3000, threads=4, host="0.0.0.0"):
        """Parametreleri kaydet ve thread'i başlat"""
        self._start_args = {"port": port, "threads": threads, "host": host}
        self.start()  # QThread.start() -> run() metodunu çağırır

    def run(self):
        """QThread.run() — start_server_internal'ı bu thread'de çalıştır"""
        self.start_server_internal(**self._start_args)

    def start_server_internal(self, port=3000, threads=4, host="0.0.0.0"):
        """OpenWebUI'yi doğrudan uvicorn ile başlat — .bat dosyası YOK"""
        # Global venv kullan (setup'ta kuruldu)
        venv_dir = ROOT / "venv"
        project_root = ROOT
        backend_dir = project_root / "backend"
        venv_python = venv_dir / "Scripts" / "python.exe"
        self._port = port

        # venv kontrolü
        if not venv_python.exists():
            self.log_signal.emit(f"[ERROR] venv\\Scripts\\python.exe bulunamadı: {venv_python}")
            self.finished_signal.emit(-1)
            return

        # uvicorn kontrolü (global venv)
        uvicorn_path = venv_dir / "Scripts" / "uvicorn.exe"
        if not uvicorn_path.exists():
            self.log_signal.emit("[ERROR] uvicorn.exe bulunamadı! Global venv'e kurun: pip install uvicorn")
            self.finished_signal.emit(-1)
            return

        env = os.environ.copy()
        env["PORT"] = str(port)
        env["HOST"] = host
        env["UVICORN_WORKERS"] = str(threads)
        env["DATABASE_URL"] = "sqlite:///openwebui.db"
        
        # WEBUI_SECRET_KEY oluştur — authentication açıkken zorunlu
        import secrets
        secret_key_path = ROOT / ".webui_secret_key"
        if not secret_key_path.exists():
            secret_key_path.write_text(secrets.token_hex(32))
        env["WEBUI_SECRET_KEY"] = secret_key_path.read_text().strip()
        env["ENABLE_WEB_SEARCH"] = "True"
        env["WEB_SEARCH_ENGINE"] = "searxng"
        env["SEARXNG_QUERY_URL"] = "http://localhost:8080/search?q=<query>"
        env["BYPASS_WEB_SEARCH_EMBEDDING_AND_RETRIEVAL"] = "True"
        env["BYPASS_WEB_SEARCH_WEB_LOADER"] = "True"
        
        # Varsayılan API: llama.cpp (localhost:1234)
        env["OPENAI_API_BASE_URL"] = "http://localhost:1234/v1"
        env["OPENAI_API_KEY"] = "sk-no-key-required"
        
        # Ollama devre disi - kullanici kullanmiyor
        env["ENABLE_OLLAMA_API"] = "False"
        
        # Kayit acik - kullanici kendisi kaydolabilsin
        env["ENABLE_SIGNUP"] = "True"
        env["ENABLE_LOGIN_FORM"] = "True"
        
        # Build edilmiş frontend dizinini göster
        frontend_build_dir = project_root / "openwebui" / "build"
        if frontend_build_dir.exists():
            env["FRONTEND_BUILD_DIR"] = str(frontend_build_dir)
        
        # Database'i openwebui/database dizinine yaz
        data_dir = project_root / "openwebui" / "database"
        data_dir.mkdir(exist_ok=True)
        env["DATA_DIR"] = str(data_dir)

        # PYTHONPATH — open_webui paketi backend dizininde
        # backend/ yoksa pip'ten kurulu versiyon kullanilir
        if backend_dir.exists():
            env["PYTHONPATH"] = str(backend_dir) + os.pathsep + env.get("PYTHONPATH", "")
        env.pop("PYTHONHOME", None)

        # Fonksiyonları veritabanına import et (OpenWebUI başladıktan sonra)
        import_functions_script = ROOT / "import_functions.py"
        if import_functions_script.exists():
            import threading as th
            def import_funcs_delayed():
                time.sleep(15)  # OpenWebUI tamamen başlayana kadar bekle
                try:
                    import subprocess as sp
                    sp.run(
                        [str(venv_python), str(import_functions_script)],
                        cwd=str(ROOT),
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
                except Exception:
                    pass  # Fonksiyon import'u başarısız olursa OpenWebUI yine de başlar
            th.Thread(target=import_funcs_delayed, daemon=True).start()

        self.log_signal.emit(f"[START] OpenWebUI starting on {host}:{port}")
        self.log_signal.emit(f"[START] Python: {venv_python}")
        self.log_signal.emit(f"[START] Threads: {threads}")
        self.log_signal.emit(f"[START] URL: http://{host}:{port}")

        # Doğrudan uvicorn komutu — .bat dosyası YOK
        # --workers KALDIRILDI: multi-worker + socket.io = mesaj akışı kırılır
        # Tek worker'da tüm bağlantılar aynı process'te, socket.io sorunsuz çalışır
        # Windows glob expansion sorununu önlemek için python -c kullan
        backend_dir = project_root / "openwebui" / "backend"
        cmd = [
            str(venv_python),
            "-c",
            f"import sys; sys.path.insert(0, r'{backend_dir}'); import uvicorn; uvicorn.run('open_webui.main:app', host='{host}', port={port}, forwarded_allow_ips='*', ws='auto')"
        ]

        self._running = True
        self._status = "running"

        try:
            self._process = subprocess.Popen(
                cmd,
                cwd=str(project_root / "openwebui"),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            self.pid = self._process.pid
            self.log_signal.emit(f"[PID] {self.pid}")

            def read_output():
                while self._running and self._process:
                    line = self._process.stdout.readline()
                    if not line:
                        if self._process.poll() is not None:
                            break
                        time.sleep(0.1)
                        continue
                    line = line.strip()
                    if line:
                        self.log_signal.emit(line)

                self._running = False
                self._status = "stopped"
                retcode = self._process.poll()
                self.log_signal.emit(f"[STOP] Process exited with code {retcode}")
                self.finished_signal.emit(retcode if retcode is not None else -1)

            self._reader_thread = threading.Thread(target=read_output, daemon=True)
            self._reader_thread.start()

        except Exception as e:
            self.log_signal.emit(f"[ERROR] {str(e)}")
            self._status = "stopped"
            self.finished_signal.emit(-1)

    def stop_process(self, timeout=10):
        """psutil process tree kill — launcher PID'sini ASLA öldürmez"""
        self._running = False
        import psutil

        if self._process and self._process.poll() is None:
            self.log_signal.emit("[STOP] Killing OpenWebUI process tree...")
            try:
                kill_pid = self.pid if hasattr(self, 'pid') and self.pid else self._process.pid

                # 1. Önce children'ları topla
                try:
                    parent = psutil.Process(kill_pid)
                    children = parent.children(recursive=True)
                    self.log_signal.emit(f"[STOP] Process tree: 1 parent + {len(children)} children")
                except psutil.NoSuchProcess:
                    children = []
                    self.log_signal.emit("[STOP] Parent process not found, scanning by port...")
                    # Port bazlı fallback
                    children = self._find_by_port(self._port)

                # 2. Önce çocukları öldür (leaf first = ters sıra)
                for child in reversed(children):
                    if child.pid == self._launcher_pid:
                        self.log_signal.emit(f"[STOP] SKIP launcher PID {self._launcher_pid}")
                        continue
                    try:
                        child.kill()
                        self.log_signal.emit(f"[STOP] Killed child PID {child.pid}")
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass

                # 3. Parent'ı öldür
                try:
                    if parent and parent.pid != self._launcher_pid:
                        parent.kill()
                        self.log_signal.emit(f"[STOP] Killed parent PID {parent.pid}")
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

                # 4. 1 saniye bekle
                time.sleep(1)

                # 5. Hala çalışıyorsa port bazlı son kill
                remaining = self._find_by_port(self._port)
                for proc in remaining:
                    if proc.pid != self._launcher_pid:
                        try:
                            proc.kill()
                            self.log_signal.emit(f"[STOP] Emergency kill PID {proc.pid}")
                        except:
                            pass

                self._process = None
                self._status = "stopped"
                self.log_signal.emit("[STOP] OpenWebUI process killed.")

            except Exception as e:
                self.log_signal.emit(f"[ERROR] Stop error: {str(e)}")
                self._status = "stopped"

    def _find_by_port(self, port):
        """Port kullanan process'leri psutil ile bul"""
        import psutil
        result = []
        for proc in psutil.process_iter(['pid', 'connections', 'name']):
            try:
                conns = proc.info['connections']
                if conns:
                    for conn in conns:
                        if hasattr(conn, 'laddr') and conn.laddr:
                            if conn.laddr.port == port:
                                result.append(proc)
                                break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return result

    def force_kill(self):
        """OpenWebUI'yi ACILEN öldür — python process ve tüm children!"""
        import psutil
        
        self.log_signal.emit(f"[FORCE KILL] Aggressively killing OpenWebUI...")
        
        try:
            port = self._start_args.get("port", 3000)
            
            # 1. Popen referansından direkt kill
            if self._process and self._process.poll() is None:
                pid = self._process.pid
                parent = psutil.Process(pid)
                children = parent.children(recursive=True)
                
                # Önce çocukları öldür
                for child in children:
                    try:
                        child.kill()
                        self.log_signal.emit(f"[FORCE KILL] Killed child PID {child.pid}")
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                
                # Sonra ana process'i öldür
                parent.kill()
                self.log_signal.emit(f"[FORCE KILL] Killed parent PID {pid}")
                self._process = None
            
            # 2. Port bazlı fallback — tüm python process'leri bul ve öldür
            time.sleep(0.5)
            remaining = self._find_by_port(port)
            if remaining:
                self.log_signal.emit(f"[FORCE KILL] Found {len(remaining)} remaining processes by port scan")
                for proc in remaining:
                    try:
                        if proc.pid != self._launcher_pid:
                            proc.kill()
                            self.log_signal.emit(f"[FORCE KILL] Emergency kill PID {proc.pid}")
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
            
        except Exception as e:
            self.log_signal.emit(f"[FORCE KILL] Error during force kill: {str(e)}")
        
        finally:
            self._status = "stopped"
            self.log_signal.emit("[FORCE KILL] OpenWebUI terminated.")
            self.finished_signal.emit(-1)


class LlamaCppWorker(ServerWorker):
    """llama.cpp sunucu başlatma"""

    def __init__(self):
        super().__init__()
        self._port = 1234
        self._ctx_size = 8192
        self._ini_file = ""
        self._host = "0.0.0.0"

    def start_server(self, port=1234, ctx_size=8192, ini_file="", host="0.0.0.0"):
        """Parametreleri kaydet ve thread'i baslat"""
        self._port = port
        self._ctx_size = ctx_size
        self._ini_file = ini_file
        self._host = host
        self.start()  # QThread'i baslat

    def run(self):
        """Thread calisma metodunda process baslat"""
        llama_server = ROOT / "llama.cpp-cuda13+vulkan" / "llama-server.exe"

        if not llama_server.exists():
            self.log_signal.emit(f"[ERROR] llama-server.exe not found at {llama_server}")
            self.finished_signal.emit(-1)
            return

        # INI dosya yolunu belirle
        if self._ini_file:
            preset_path = str(INI_DIR / self._ini_file)
            # .bat dosyasini her baslatmada yeniden olustur (ctx_size, port ile)
            base_name = self._ini_file.replace("models.ini", "").replace(".ini", "")
            bat_name = f"start_{base_name}.bat"
            bat_path = INI_DIR / bat_name

            # .bat icerigi — dinamik parametrelerle
            bat_content = f"""@echo off
title llama.cpp ({self._ini_file})
color 0a

cd /d "%~dp0"
"llama.cpp-cuda13+vulkan\\llama-server.exe" ^
  --host {self._host} ^
  --port {self._port} ^
  --ctx-size {self._ctx_size} ^
  --models-max 1 ^
  --models-preset "{self._ini_file}" ^
  --jinja

pause
"""
            try:
                with open(bat_path, "w", encoding="utf-8") as f:
                    f.write(bat_content)
                self.log_signal.emit(f"[CONFIG] Bat file created: {bat_name}")
                self.log_signal.emit(f"[CONFIG] Port: {self._port}, Ctx-size: {self._ctx_size}")
            except IOError as e:
                self.log_signal.emit(f"[ERROR] Could not write bat: {e}")
                self.finished_signal.emit(-1)
                return

            cmd = [str(bat_path)]
        else:
            self.log_signal.emit("[ERROR] No INI file selected")
            self.finished_signal.emit(-1)
            return

        self.start_process(cmd)


class VaneWorker(ServerWorker):
    """Vane AI - Next.js tabanlı AI cevap motoru"""

    def __init__(self):
        super().__init__()
        self._port = 3001
        self._start_args = {}
        self._config = AppManager().config
        self._npm_process = None  # npm process referansı

    def start_server(self, port=3001, host="0.0.0.0"):
        """Parametreleri kaydet ve thread'i başlat"""
        self._start_args = {"port": port, "host": host}
        self.start()

    def run(self):
        """Thread içinde çalıştır"""
        self.start_server_internal(**self._start_args)

    def start_server_internal(self, port=3001, host="0.0.0.0"):
        """Vane'i npm start ile başlat"""
        vane_dir = ROOT / "Vane"
        node_exe = None

        # .next klasörünü temizle — Turbopack junction hatasını önler
        next_dir = vane_dir / ".next"
        if next_dir.exists():
            import shutil as sh
            try:
                sh.rmtree(str(next_dir))
                self.log_signal.emit("[CLEAN] .next directory cleaned (Turbopack junction fix)")
            except Exception as e:
                self.log_signal.emit(f"[WARN] Could not clean .next: {e}")

        # Node.js bul — öncelikle sistem PATH'inde ara
        try:
            import shutil
            node_exe = shutil.which("node")
            if node_exe:
                self.log_signal.emit(f"[START] Node.js found: {node_exe}")
        except Exception:
            pass

        if not node_exe:
            self.log_signal.emit("[ERROR] Node.js bulunamadı! Lütfen Node.js kurun: https://nodejs.org/")
            self.finished_signal.emit(-1)
            return

        # Port kontrolü — 3000 OpenWebUI ile çakışmasın
        if port == 3000:
            port = 3001
            self.log_signal.emit("[WARN] Port 3000 is used by OpenWebUI, switching to 3001")

        # SEARXNG_API_URL — mevcut SearXNG'yi kullan
        try:
            searxng_port = self._config.get("searxng_port", 8080)
        except Exception:
            searxng_port = 8080

        env = os.environ.copy()
        env["SEARXNG_API_URL"] = f"http://127.0.0.1:{searxng_port}"
        env["PORT"] = str(port)
        env["HOST"] = host  # Bug: Bind address ekle

        # Vane'in kendi config.json'ı varsa kullan
        vane_config = vane_dir / "config.json"
        if vane_config.exists():
            env["CONFIG_PATH"] = str(vane_config)

        # Vane'i npm run dev ile başlat — .next/standalone sorunlu, dev mode kullan
        cmd = ["npm", "run", "dev", "--", "-p", str(port)]
        self.log_signal.emit(f"[START] Vane starting (npm dev) on port {port}")
        self.log_signal.emit(f"[START] Node.js: {node_exe}")
        self.log_signal.emit(f"[START] SEARXNG_API_URL: http://127.0.0.1:{searxng_port}")
        self.log_signal.emit(f"[START] Working dir: {vane_dir}")

        self.start_process(cmd, cwd=str(vane_dir), env=env)

    def stop_process(self, timeout=10):
        """Vane'i durdur — npm ve node process'lerini öldür"""
        self._running = False
        
        # Önce kendi process'i öldür
        if self._process and self._process.poll() is None:
            try:
                subprocess.Popen(
                    ["taskkill", "/F", "/T", "/PID", str(self._process.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                self._process = None
            except Exception:
                pass
        
        # Vane process'lerinin portunu dinleyen node process'lerini de öldür
        try:
            port = self._start_args.get("port", 3001)
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                if f":{port}" in line:
                    parts = line.strip().split()
                    if parts:
                        pid = parts[-1]
                        if pid.isdigit():
                            subprocess.run(
                                ["taskkill", "/F", "/PID", pid],
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                            )
        except Exception:
            pass
        
        self._status = "stopped"

    def force_kill(self):
        """Vane'i ACILEN öldür — npm, node ve tüm ilgili process'ler!"""
        import psutil
        
        self.log_signal.emit(f"[FORCE KILL] Aggressively killing Vane...")
        
        try:
            port = self._start_args.get("port", 3001)
            
            # 1. Popen referansından direkt kill
            if self._process and self._process.poll() is None:
                pid = self._process.pid
                subprocess.Popen(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                self.log_signal.emit(f"[FORCE KILL] Killed Vane Popen PID {pid}")
                self._process = None
            
            # 2. Port bazlı fallback — tüm node/python process'lerini bul ve öldür
            time.sleep(0.5)
            try:
                result = subprocess.run(
                    ["netstat", "-ano"],
                    capture_output=True, text=True, timeout=5
                )
                for line in result.stdout.splitlines():
                    if f":{port}" in line:
                        parts = line.strip().split()
                        if parts:
                            pid = parts[-1]
                            if pid.isdigit() and pid != "0":
                                subprocess.run(
                                    ["taskkill", "/F", "/PID", pid],
                                    stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL,
                                )
                                self.log_signal.emit(f"[FORCE KILL] Emergency kill PID {pid} by port scan")
            except Exception:
                pass
            
        except Exception as e:
            self.log_signal.emit(f"[FORCE KILL] Error during force kill: {str(e)}")
        
        finally:
            self._status = "stopped"
            self.log_signal.emit("[FORCE KILL] Vane terminated.")
            self.finished_signal.emit(-1)


INI_DIR = ROOT
BAT_DIR = ROOT


class ServerSection(QWidget):
    """Tekrar kullanılabilir sunucu bölümü widget'ı"""

    def __init__(self, title, start_callback, stop_callback, force_kill_callback, get_status_callback,
                 open_browser_callback, parent=None):
        super().__init__(parent)
        self._lang = AppManager().lang
        self._manager = AppManager()
        self._title = title
        self._start_cb = start_callback
        self._stop_cb = stop_callback
        self._force_kill_cb = force_kill_callback
        self._status_cb = get_status_callback
        self._browser_cb = open_browser_callback
        self._is_running = False

        self._build_ui()
        # Dil degisikligi sinyali bagla
        self._manager.lang.lang_changed.connect(self._update_lang)

    def _build_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        # Başlık satırı
        title_layout = QHBoxLayout()
        
        # Durum noktası
        self.status_dot = QLabel("●")
        self.status_dot.setFixedWidth(12)
        self.status_dot.setStyleSheet(
            "color: #ef4444; font-size: 22px; font-family: Arial;"
        )
        title_layout.addWidget(self.status_dot)

        # Başlık
        self.title_label = QLabel(self._title)
        self.title_label.setStyleSheet("font-size: 14px; font-weight: bold; padding: 2px;")
        title_layout.addWidget(self.title_label)

        # Durum etiketi
        self.status_label = QLabel(self._lang.get("label_status_stopped", "Stopped"))
        self.status_label.setStyleSheet("font-size: 12px; color: #ef4444; font-weight: bold;")
        title_layout.addWidget(self.status_label)

        # Geri sayım etiketi
        self.countdown_label = QLabel("")
        self.countdown_label.setStyleSheet("color: #f59e0b; font-size: 11px;")
        title_layout.addWidget(self.countdown_label)
        title_layout.addStretch()

        # Açıklama toggle
        self.toggle_desc_btn = QPushButton("ℹ")
        self.toggle_desc_btn.setFixedSize(24, 24)
        self.toggle_desc_btn.setCheckable(True)
        self.toggle_desc_btn.clicked.connect(lambda checked: self.desc_text.setVisible(checked))
        title_layout.addWidget(self.toggle_desc_btn)

        layout.addLayout(title_layout)

        # Açıklama (gizlenebilir)
        self.desc_text = QLabel("")
        self.desc_text.setWordWrap(True)
        self.desc_text.setStyleSheet(
            "color: #9ca3af; font-size: 11px; padding: 6px; "
            "background-color: #1f2937; border-radius: 4px;"
        )
        self.desc_text.setVisible(False)
        layout.addWidget(self.desc_text)

        # Butonlar
        btn_layout = QHBoxLayout()
        
        self.start_btn = QPushButton(self._lang.get("btn_start", "Start"))
        self.start_btn.setMinimumHeight(32)
        self.start_btn.setStyleSheet(
            "QPushButton { background-color: #10b981; color: white; "
            "border-radius: 4px; font-weight: bold; } "
            "QPushButton:hover { background-color: #059669; } "
            "QPushButton:disabled { background-color: #374151; color: #6b7280; }"
        )
        self.start_btn.clicked.connect(self._start_cb)
        btn_layout.addWidget(self.start_btn)

        self.stop_btn = QPushButton(self._lang.get("btn_stop", "Stop"))
        self.stop_btn.setMinimumHeight(32)
        self.stop_btn.setEnabled(False)
        self.stop_btn.setStyleSheet(
            "QPushButton { background-color: #ef4444; color: white; "
            "border-radius: 4px; font-weight: bold; } "
            "QPushButton:hover { background-color: #dc2626; } "
            "QPushButton:disabled { background-color: #374151; color: #6b7280; }"
        )
        self.stop_btn.clicked.connect(self._stop_cb)
        btn_layout.addWidget(self.stop_btn)

        # Force Kill butonu — kırmızı-siyah, ⚡ ikon
        self.force_kill_btn = QPushButton("⚡ " + self._lang.get("btn_force_kill", "Force Kill"))
        self.force_kill_btn.setMinimumHeight(32)
        self.force_kill_btn.setEnabled(False)
        self.force_kill_btn.setStyleSheet(
            "QPushButton { background-color: #7f1d1d; color: yellow; "
            "border-radius: 4px; font-weight: bold; } "
            "QPushButton:hover { background-color: #991b1b; } "
            "QPushButton:disabled { background-color: #374151; color: #6b7280; }"
        )
        self.force_kill_btn.clicked.connect(self._force_kill_cb)
        btn_layout.addWidget(self.force_kill_btn)

        self.browser_btn = QPushButton(self._lang.get("btn_open_browser", "Open Browser"))
        self.browser_btn.setMinimumHeight(32)
        self.browser_btn.setEnabled(False)
        self.browser_btn.setStyleSheet(
            "QPushButton { background-color: #3b82f6; color: white; "
            "border-radius: 4px; } "
            "QPushButton:hover { background-color: #2563eb; } "
            "QPushButton:disabled { background-color: #374151; color: #6b7280; }"
        )
        self.browser_btn.clicked.connect(self._browser_cb)
        btn_layout.addWidget(self.browser_btn)

        # Log toggle
        self.toggle_log_btn = QPushButton("📋 Log")
        self.toggle_log_btn.setCheckable(True)
        self.toggle_log_btn.setMinimumHeight(28)
        btn_layout.addWidget(self.toggle_log_btn)

        btn_layout.addStretch()
        layout.addLayout(btn_layout)

        # Log (gizlenebilir)
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setMaximumHeight(150)
        self.log_text.setVisible(False)
        self.log_text.setStyleSheet(
            "QTextEdit { background-color: #111827; color: #10b981; "
            "font-family: Consolas, monospace; font-size: 11px; "
            "border: 1px solid #374151; border-radius: 4px; }"
        )
        layout.addWidget(self.log_text)

        self.toggle_log_btn.clicked.connect(lambda checked: self.log_text.setVisible(checked))

        self.setLayout(layout)

    def _update_lang(self):
        """Dil degisikliginde UI metinlerini güncelle"""
        lang = self._manager.lang
        self.status_label.setText(
            lang.get("label_status_running", "Running") if self._is_running
            else lang.get("label_status_stopped", "Stopped")
        )
        self.start_btn.setText(lang.get("btn_start", "Start"))
        self.stop_btn.setText(lang.get("btn_stop", "Stop"))
        self.force_kill_btn.setText("⚡ " + lang.get("btn_force_kill", "Force Kill"))
        self.browser_btn.setText(lang.get("btn_open_browser", "Open Browser"))

    def set_status(self, running):
        """Durumu güncelle"""
        self._is_running = running
        if running:
            self.status_dot.setStyleSheet(
                "color: #10b981; font-size: 22px; font-family: Arial;"
            )
            self.status_label.setText(
                self._manager.lang.get("label_status_running", "Running")
            )
            self.status_label.setStyleSheet(
                "font-size: 12px; color: #10b981; font-weight: bold;"
            )
            self.start_btn.setEnabled(False)
            self.stop_btn.setEnabled(True)
            self.force_kill_btn.setEnabled(True)  # Force Kill aktif
            self.browser_btn.setEnabled(True)
        else:
            self.status_dot.setStyleSheet(
                "color: #ef4444; font-size: 22px; font-family: Arial;"
            )
            self.status_label.setText(
                self._manager.lang.get("label_status_stopped", "Stopped")
            )
            self.status_label.setStyleSheet(
                "font-size: 12px; color: #ef4444; font-weight: bold;"
            )
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)
            self.force_kill_btn.setEnabled(False)  # Force Kill pasif
            self.browser_btn.setEnabled(False)

    def add_log(self, message):
        """Log ekle"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.append(f"[{timestamp}] {message}")
        scrollbar = self.log_text.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def start_countdown(self, seconds=30):
        """Geri sayım başlat"""
        self._countdown = seconds
        self._update_countdown_label()
        if hasattr(self, '_countdown_timer') and self._countdown_timer:
            self._countdown_timer.stop()
        self._countdown_timer = QTimer()
        self._countdown_timer.timeout.connect(self._tick_countdown)
        self._countdown_timer.start(1000)

    def _tick_countdown(self):
        self._countdown -= 1
        self._update_countdown_label()
        if self._countdown <= 0:
            self._countdown_timer.stop()
            self.countdown_label.setText("")

    def _update_countdown_label(self):
        self.countdown_label.setText(
            self._lang.get("label_countdown", "Ready in {n}s...").format(n=self._countdown)
        )


class ServersTab(QWidget):
    """Tab 2: Sunucu yönetimi"""

    def __init__(self):
        super().__init__()
        self._manager = AppManager()
        self._lang = self._manager.lang
        self._config = self._manager.config
        self._searxng_worker = None
        self._openwebui_worker = None
        self._llamacpp_worker = None
        self._vane_worker = None
        self._sections = {}  # ServerSection'ları sakla

        # Dil değiştiğinde bind combobox'larını güncelle
        self._lang.lang_changed.connect(self._refresh_bind_labels)

        self._init_ui()

    def _refresh_bind_labels(self):
        """Dil değiştiğinde tüm bind label ve combobox'larını güncelle"""
        # Tüm label'leri güncelle
        if hasattr(self, 'searxng_bind_label'):
            self.searxng_bind_label.setText(self._lang.get("label_bind", "Bind to") + ":")
        if hasattr(self, 'lc_bind_label'):
            self.lc_bind_label.setText(self._lang.get("label_bind", "Bind to") + ":")
        if hasattr(self, 'ow_bind_label'):
            self.ow_bind_label.setText(self._lang.get("label_bind", "Bind to") + ":")
        if hasattr(self, 'vane_bind_label'):
            self.vane_bind_label.setText(self._lang.get("label_bind", "Bind to") + ":")

        # SearXNG combobox
        if hasattr(self, 'searxng_bind'):
            self.searxng_bind.blockSignals(True)
            self.searxng_bind.clear()
            self.searxng_bind.addItem(self._lang.get("lbl_local_network", "Local Network"), "0.0.0.0")
            self.searxng_bind.addItem(self._lang.get("lbl_this_pc_only", "This PC Only"), "127.0.0.1")
            saved = self._config.get("searxng_bind", "0.0.0.0")
            idx = 0 if saved == "0.0.0.0" else 1
            self.searxng_bind.setCurrentIndex(idx)
            self.searxng_bind.blockSignals(False)

        # llama.cpp combobox
        if hasattr(self, 'lc_bind'):
            self.lc_bind.blockSignals(True)
            self.lc_bind.clear()
            self.lc_bind.addItem(self._lang.get("lbl_local_network", "Local Network"), "0.0.0.0")
            self.lc_bind.addItem(self._lang.get("lbl_this_pc_only", "This PC Only"), "127.0.0.1")
            saved = self._config.get("llamacpp_bind", "0.0.0.0")
            idx = 0 if saved == "0.0.0.0" else 1
            self.lc_bind.setCurrentIndex(idx)
            self.lc_bind.blockSignals(False)

        # OpenWebUI combobox
        if hasattr(self, 'ow_bind'):
            self.ow_bind.blockSignals(True)
            self.ow_bind.clear()
            self.ow_bind.addItem(self._lang.get("lbl_local_network", "Local Network"), "0.0.0.0")
            self.ow_bind.addItem(self._lang.get("lbl_this_pc_only", "This PC Only"), "127.0.0.1")
            saved = self._config.get("openwebui_bind", "0.0.0.0")
            idx = 0 if saved == "0.0.0.0" else 1
            self.ow_bind.setCurrentIndex(idx)
            self.ow_bind.blockSignals(False)

        # Vane combobox
        if hasattr(self, 'vane_bind'):
            self.vane_bind.blockSignals(True)
            self.vane_bind.clear()
            self.vane_bind.addItem(self._lang.get("lbl_local_network", "Local Network"), "0.0.0.0")
            self.vane_bind.addItem(self._lang.get("lbl_this_pc_only", "This PC Only"), "127.0.0.1")
            saved = self._config.get("vane_bind", "0.0.0.0")
            idx = 0 if saved == "0.0.0.0" else 1
            self.vane_bind.setCurrentIndex(idx)
            self.vane_bind.blockSignals(False)

    def _init_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(15)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll_content = QWidget()
        scroll_layout = QVBoxLayout(scroll_content)
        scroll_layout.setSpacing(15)

        # === ÜST SATIR: SearXNG + llama.cpp ===
        top_row = QHBoxLayout()
        top_row.setSpacing(15)

        # --- SearXNG (sol) ---
        searxng_group = QGroupBox(self._lang.get("section_searxng", "SearXNG - Private Search"))
        searxng_layout = QVBoxLayout()
        searxng_layout.setContentsMargins(8, 8, 8, 8)
        searxng_layout.setSpacing(8)

        port_layout = QHBoxLayout()
        port_layout.addWidget(QLabel(self._lang.get("label_port", "Port") + ":"))
        self.searxng_port = QSpinBox()
        self.searxng_port.setRange(1, 65535)
        self.searxng_port.setValue(self._config.get("searxng_port", 8080))
        self.searxng_port.valueChanged.connect(self._on_searxng_port_changed)
        port_layout.addWidget(self.searxng_port)
        port_layout.addStretch()
        searxng_layout.addLayout(port_layout)

        # Bind address secimi (Yerel ag / Sadece PC) — PORTUN ALTI
        bind_layout = QHBoxLayout()
        self.searxng_bind_label = QLabel(self._lang.get("label_bind", "Bind to") + ":")
        bind_layout.addWidget(self.searxng_bind_label)
        self.searxng_bind = QComboBox()
        self.searxng_bind.addItem(self._lang.get("lbl_local_network", "Local Network"), "0.0.0.0")
        self.searxng_bind.addItem(self._lang.get("lbl_this_pc_only", "This PC Only"), "127.0.0.1")
        saved_bind = self._config.get("searxng_bind", "0.0.0.0")
        idx = 0 if saved_bind == "0.0.0.0" else 1
        self.searxng_bind.setCurrentIndex(idx)
        self.searxng_bind.currentIndexChanged.connect(lambda i: self._config.set("searxng_bind", str(self.searxng_bind.itemData(i))))
        bind_layout.addWidget(self.searxng_bind)
        bind_layout.addStretch()
        searxng_layout.addLayout(bind_layout)

        searxng_desc = QLabel(self._lang.get("desc_searxng", "SearXNG is a privacy-focused metasearch engine that aggregates results from multiple search engines without tracking you."))
        searxng_desc.setWordWrap(True)
        searxng_desc.setStyleSheet("color: #9ca3af; font-size: 11px; padding: 6px; background-color: #1f2937; border-radius: 4px;")
        searxng_desc.setVisible(False)
        searxng_layout.addWidget(searxng_desc)

        toggle_desc_btn = QPushButton("ℹ Description")
        toggle_desc_btn.setCheckable(True)
        toggle_desc_btn.clicked.connect(lambda checked: searxng_desc.setVisible(checked))
        port_layout.addWidget(toggle_desc_btn)

        searxng_section = ServerSection(
            "SearXNG",
            self._start_searxng,
            self._stop_searxng,
            lambda: self._force_kill_searxng(),
            lambda: self._searxng_worker.get_status() if self._searxng_worker and self._searxng_worker.isRunning() else "stopped",
            lambda: self._open_browser(f"http://127.0.0.1:{self.searxng_port.value()}")
        )
        self._sections["searxng"] = searxng_section
        searxng_section.desc_text = searxng_desc
        searxng_layout.addWidget(searxng_section)
        searxng_group.setLayout(searxng_layout)
        top_row.addWidget(searxng_group, 1)

        # --- llama.cpp (sağ) ---
        llamacpp_group = QGroupBox(self._lang.get("section_llamacpp", "llama.cpp - AI Engine"))
        llamacpp_layout = QVBoxLayout()
        llamacpp_layout.setContentsMargins(8, 8, 8, 8)
        llamacpp_layout.setSpacing(8)

        lc_settings = QHBoxLayout()
        lc_settings.addWidget(QLabel(self._lang.get("label_port", "Port") + ":"))
        self.lc_port = QSpinBox()
        self.lc_port.valueChanged.connect(self._on_llamacpp_port_changed)
        self.lc_port.setRange(1, 65535)
        self.lc_port.setValue(self._config.get("llamacpp_port", 1234))
        lc_settings.addWidget(self.lc_port)

        lc_settings.addWidget(QLabel(self._lang.get("label_context_size", "Context Size") + ":"))
        self.lc_ctx = QComboBox()
        for val in [4096, 8192, 16384, 32768, 49152, 65536, 98304, 131072, 196608, 262144]:
            self.lc_ctx.addItem(str(val))
        self.lc_ctx.setCurrentText(str(self._config.get("llamacpp_ctx", 8192)))
        lc_settings.addWidget(self.lc_ctx)
        lc_settings.addStretch()
        llamacpp_layout.addLayout(lc_settings)

        # Bug: Bind address secimi — PORTUN ALTI
        bind_lc = QHBoxLayout()
        self.lc_bind_label = QLabel(self._lang.get("label_bind", "Bind to") + ":"); bind_lc.addWidget(self.lc_bind_label)
        self.lc_bind = QComboBox()
        self.lc_bind.addItem(self._lang.get("lbl_local_network", "Local Network"), "0.0.0.0")
        self.lc_bind.addItem(self._lang.get("lbl_this_pc_only", "This PC Only"), "127.0.0.1")
        saved_bind = self._config.get("llamacpp_bind", "0.0.0.0")
        idx = 0 if saved_bind == "0.0.0.0" else 1
        self.lc_bind.setCurrentIndex(idx)
        self.lc_bind.currentIndexChanged.connect(lambda i: self._config.set("llamacpp_bind", str(self.lc_bind.itemData(i))))
        bind_lc.addWidget(self.lc_bind)
        bind_lc.addStretch()
        llamacpp_layout.addLayout(bind_lc)

        llamacpp_section = ServerSection(
            "llama.cpp",
            self._start_llamacpp,
            self._stop_llamacpp,
            lambda: self._force_kill_llamacpp(),
            lambda: self._llamacpp_worker.get_status() if self._llamacpp_worker and self._llamacpp_worker.isRunning() else "stopped",
            lambda: self._open_browser(f"http://127.0.0.1:{self.lc_port.value()}")
        )
        self._sections["llamacpp"] = llamacpp_section
        llamacpp_layout.addWidget(llamacpp_section)
        llamacpp_group.setLayout(llamacpp_layout)
        top_row.addWidget(llamacpp_group, 1)

        scroll_layout.addLayout(top_row)

        # === ALT SATIR: OpenWebUI + Vane ===
        bottom_row = QHBoxLayout()
        bottom_row.setSpacing(15)

        # --- OpenWebUI (sol) ---
        openwebui_group = QGroupBox(self._lang.get("section_openwebui", "Open WebUI - Chat Interface"))
        openwebui_layout = QVBoxLayout()
        openwebui_layout.setContentsMargins(8, 8, 8, 8)
        openwebui_layout.setSpacing(8)

        ow_settings = QHBoxLayout()
        ow_settings.addWidget(QLabel(self._lang.get("label_port", "Port") + ":"))
        self.ow_port = QSpinBox()
        self.ow_port.setRange(1, 65535)
        self.ow_port.setValue(self._config.get("openwebui_port", 3000))
        self.ow_port.valueChanged.connect(self._on_openwebui_port_changed)
        ow_settings.addWidget(self.ow_port)

        ow_settings.addWidget(QLabel(self._lang.get("label_cpu_threads", "CPU Threads") + ":"))
        self.ow_threads = QSpinBox()
        self.ow_threads.setRange(1, 32)
        self.ow_threads.setValue(4)
        ow_settings.addWidget(self.ow_threads)
        ow_settings.addStretch()
        openwebui_layout.addLayout(ow_settings)

        # Bug: Bind address secimi — PORTUN ALTI
        bind_ow = QHBoxLayout()
        self.ow_bind_label = QLabel(self._lang.get("label_bind", "Bind to") + ":")
        bind_ow.addWidget(self.ow_bind_label)
        self.ow_bind = QComboBox()
        self.ow_bind.addItem(self._lang.get("lbl_local_network", "Local Network"), "0.0.0.0")
        self.ow_bind.addItem(self._lang.get("lbl_this_pc_only", "This PC Only"), "127.0.0.1")
        saved_bind = self._config.get("openwebui_bind", "0.0.0.0")
        idx = 0 if saved_bind == "0.0.0.0" else 1
        self.ow_bind.setCurrentIndex(idx)
        self.ow_bind.currentIndexChanged.connect(lambda i: self._config.set("openwebui_bind", str(self.ow_bind.itemData(i))))
        bind_ow.addWidget(self.ow_bind)
        bind_ow.addStretch()
        openwebui_layout.addLayout(bind_ow)

        ow_desc = QLabel(self._lang.get("desc_openwebui", "Open WebUI is a user-friendly interface for interacting with local LLM models through your browser."))
        ow_desc.setWordWrap(True)
        ow_desc.setStyleSheet("color: #9ca3af; font-size: 11px; padding: 6px; background-color: #1f2937; border-radius: 4px;")
        ow_desc.setVisible(False)
        openwebui_layout.addWidget(ow_desc)

        ow_toggle = QPushButton("ℹ Description")
        ow_toggle.setCheckable(True)
        ow_toggle.clicked.connect(lambda checked: ow_desc.setVisible(checked))
        ow_settings.addWidget(ow_toggle)

        db_load_layout = QHBoxLayout()
        db_load_layout.addStretch()
        self.db_load_btn = QPushButton("📁 " + self._lang.get("btn_load_database", "Load Database"))
        self.db_load_btn.setStyleSheet("""
            QPushButton {
                background-color: #2563eb;
                color: white;
                padding: 6px 12px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #1d4ed8;
            }
            QPushButton:pressed {
                background-color: #1e40af;
            }
        """)
        self.db_load_btn.clicked.connect(self._load_database)
        db_load_layout.addWidget(self.db_load_btn)
        db_load_layout.addStretch()
        openwebui_layout.addLayout(db_load_layout)

        openwebui_section = ServerSection(
            "OpenWebUI",
            self._start_openwebui,
            self._stop_openwebui,
            lambda: self._force_kill_openwebui(),
            lambda: self._openwebui_worker.get_status() if self._openwebui_worker and self._openwebui_worker.isRunning() else "stopped",
            lambda: self._open_browser(f"http://127.0.0.1:{self.ow_port.value()}")
        )
        self._sections["openwebui"] = openwebui_section
        openwebui_section.desc_text = ow_desc
        openwebui_layout.addWidget(openwebui_section)
        openwebui_group.setLayout(openwebui_layout)
        bottom_row.addWidget(openwebui_group, 1)

        # --- Vane (sağ) ---
        vane_group = QGroupBox(self._lang.get("section_vane", "Vane - AI Answer Engine"))
        vane_layout = QVBoxLayout()
        vane_layout.setContentsMargins(8, 8, 8, 8)
        vane_layout.setSpacing(8)

        vane_port_layout = QHBoxLayout()
        vane_port_layout.addWidget(QLabel(self._lang.get("label_port", "Port") + ":"))
        self.vane_port = QSpinBox()
        self.vane_port.setRange(1, 65535)
        self.vane_port.setValue(self._config.get("vane_port", 3001))
        self.vane_port.valueChanged.connect(self._on_vane_port_changed)
        vane_port_layout.addWidget(self.vane_port)
        vane_port_layout.addStretch()
        vane_layout.addLayout(vane_port_layout)

        # Bug: Bind address secimi — PORTUN ALTI
        bind_vane = QHBoxLayout()
        self.vane_bind_label = QLabel(self._lang.get("label_bind", "Bind to") + ":")
        bind_vane.addWidget(self.vane_bind_label)
        self.vane_bind = QComboBox()
        self.vane_bind.addItem(self._lang.get("lbl_local_network", "Local Network"), "0.0.0.0")
        self.vane_bind.addItem(self._lang.get("lbl_this_pc_only", "This PC Only"), "127.0.0.1")
        saved_bind = self._config.get("vane_bind", "0.0.0.0")
        idx = 0 if saved_bind == "0.0.0.0" else 1
        self.vane_bind.setCurrentIndex(idx)
        self.vane_bind.currentIndexChanged.connect(lambda i: self._config.set("vane_bind", str(self.vane_bind.itemData(i))))
        bind_vane.addWidget(self.vane_bind)
        bind_vane.addStretch()
        vane_layout.addLayout(bind_vane)

        vane_desc = QLabel(self._lang.get("desc_vane", "Vane is a privacy-focused AI answering engine that combines web search with local and cloud LLMs to deliver accurate answers with cited sources."))
        vane_desc.setWordWrap(True)
        vane_desc.setStyleSheet("color: #9ca3af; font-size: 11px; padding: 6px; background-color: #1f2937; border-radius: 4px;")
        vane_desc.setVisible(False)
        vane_layout.addWidget(vane_desc)

        vane_toggle = QPushButton("ℹ Description")
        vane_toggle.setCheckable(True)
        vane_toggle.clicked.connect(lambda checked: vane_desc.setVisible(checked))
        vane_port_layout.addWidget(vane_toggle)

        vane_section = ServerSection(
            "Vane",
            self._start_vane,
            self._stop_vane,
            lambda: self._force_kill_vane(),
            lambda: self._vane_worker.get_status() if self._vane_worker and self._vane_worker.isRunning() else "stopped",
            lambda: self._open_browser(f"http://127.0.0.1:{self.vane_port.value()}")
        )
        self._sections["vane"] = vane_section
        vane_section.desc_text = vane_desc
        vane_layout.addWidget(vane_section)
        vane_group.setLayout(vane_layout)
        bottom_row.addWidget(vane_group, 1)

        scroll_layout.addLayout(bottom_row)

        scroll_layout.addStretch()
        scroll.setWidget(scroll_content)
        layout.addWidget(scroll)

        self.setLayout(layout)

        # ============================================
        # Bug #10: Uyku Modu Recovery — QTimer Health Check
        # ============================================
        self.health_check_timer = QTimer(self)
        self.health_check_timer.timeout.connect(self._check_servers_health)
        self.health_check_timer.start(60000)  # Her 60 saniyede bir kontrol

        # ============================================
        # Bug #8: SearXNG Internet Connection Check
        # ============================================
        self._internet_available = True

    # ============================================
    # Utility Functions (Bug #4 + Bug #8)
    # ============================================

    @staticmethod
    def is_port_in_use(port: int) -> bool:
        """
        Bug #4: Port çakışma kontrolü.
        Belirtilen port kullanımda mı? (socket.bind denemesi)
        """
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return False
            except OSError:
                return True

    def check_internet_connection(self, timeout: int = 3) -> bool:
        """
        Bug #8: İnternet bağlantısı kontrolü (ping).  
        Windows'ta ping -n 1 1.1.1.1 yapar.
        """
        try:
            param = '-n' if os.name == 'nt' else '-c'
            result = subprocess.run(
                ["ping", param, "1", "1.1.1.1"],
                timeout=timeout,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            return result.returncode == 0
        except Exception:
            return False

    def _check_servers_health(self):
        """
        Bug #10: Server sağlık kontrolü (uyku modu sonrası donmuş servisleri tespit et).
        Her 60 saniyede bir çalışır.
        """
        import urllib.request

        workers_ports = [
            ("SearXNG", self._searxng_worker, self.searxng_port.value()),
            ("OpenWebUI", self._openwebui_worker, self.ow_port.value()),
            ("llama.cpp", self._llamacpp_worker, self.lc_port.value()),
            ("Vane", self._vane_worker, self.vane_port.value()),
        ]

        for name, worker, port in workers_ports:
            if not worker or worker.get_status() != "running":
                continue

            # HTTP ping ile sağlığı kontrol et
            healthy = False
            try:
                url = f"http://127.0.0.1:{port}/"
                req = urllib.request.Request(url, method='HEAD')
                urllib.request.urlopen(req, timeout=3)
                healthy = True
            except Exception:
                pass

            if not healthy:
                # Sunucu yanıt vermiyor — durdur ve yeniden başlat
                log_msg = self._lang.get("msg_server_unresponsive", f"[{name}] is not responding (possible sleep mode issue). Restarting...").format(server=name)
                self.log(name, log_msg)

                # Durdur
                try:
                    worker.stop_process(timeout=5)
                except Exception:
                    pass

                # Kısa bekle sonra yeniden başlat
                time.sleep(2)

                # Yeniden başlat
                try:
                    if name == "SearXNG":
                        self._start_searxng()
                    elif name == "OpenWebUI":
                        self._start_openwebui()
                    elif name == "llama.cpp":
                        self._start_llamacpp()
                    elif name == "Vane":
                        self._start_vane()
                except Exception as e:
                    self.log(name, f"[HEALTH] Restart failed: {e}")

    def _open_browser(self, url):
        try:
            webbrowser.open(url)
        except Exception as e:
            pass

    def _get_section(self, key):
        """Anahtar ile section al"""
        return self._sections.get(key)

    def _start_searxng(self):
        port = self.searxng_port.value()
        host = str(self.searxng_bind.currentData())  # Bug: Bind address al
        self._config.set("searxng_host", host)

        if self._searxng_worker and self._searxng_worker.get_status() == "running":
            section = self._get_section("searxng")
            if section:
                QMessageBox.information(
                    self,
                    self._lang.get("info_already_running", "Already Running"),
                    self._lang.get("msg_server_already_running", "SearXNG is already running on port {port}.").format(port=port)
                )
            return
        else:
            # Worker None/Done — port meşgul mü kontrol et (cleanup sonrası)
            if self.is_port_in_use(port):
                section = self._get_section("searxng")
                if section:
                    QMessageBox.warning(
                        self,
                        self._lang.get("warning_port_in_use", "Port In Use"),
                        self._lang.get("error_port_busy_msg", f"Port {port} is already in use! Please choose another port.")
                    )
                self.log("searxng", f"[ERROR] Port {port} in use after cleanup")
                return
        self._config.set("searxng_port", port)

        section = self._get_section("searxng")
        if section:
            section.start_btn.setEnabled(False)
            section.start_countdown(90)

        self._searxng_worker = SearXNGWorker()
        self._searxng_worker.log_signal.connect(lambda msg: self._update_log("searxng", msg))
        self._searxng_worker.finished_signal.connect(
            lambda code: self._server_finished("searxng", code)
        )
        self._searxng_worker.start_server(port=port, host=host)  # Bug: Host parametresi ekle
        # start_server artik self.start() cagiriyor, ayrica cagirmaya gerek yok

        # Başlatıldı — durumu hemen güncelle
        if section:
            section.set_status(True)
        
        # Kaydedilen sunucular listesine ekle
        started = self._config.get("started_servers", [])
        if "searxng" not in started:
            started.append("searxng")
            self._config.set("started_servers", started)

    def _stop_searxng(self):
        section = self._get_section("searxng")
        if self._searxng_worker and self._searxng_worker.get_status() == "running":
            self._searxng_worker.stop_process()
            # UI'yi hemen güncelle
            if section:
                section.set_status(False)
        else:
            if section:
                section.set_status(False)

    def _force_kill_searxng(self):
        """SearXNG process'ini ACILEN öldür — zorla sonlandırma!"""
        import psutil
        section = self._get_section("searxng")
        
        if not self._searxng_worker:
            # Worker yoksa port bazlı scan yap
            port = self.searxng_port.value()
            try:
                for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                    try:
                        if 'python' in proc.info['name'].lower() and proc.info['cmdline']:
                            cmdline_str = ' '.join(proc.info['cmdline'])
                            if f':{port}' in cmdline_str or 'searxng' in cmdline_str.lower():
                                pid = proc.info['pid']
                                psutil.Process(pid).kill()
                                self.log("searxng", f"[FORCE KILL] Killed python PID {pid} by port scan")
                    except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                        pass
            except Exception as e:
                self.log("searxng", f"[ERROR] Force kill error: {str(e)}")
            
            if section:
                section.set_status(False)
            return
        
        # Worker varsa force_kill metodunu çağır
        self._searxng_worker.force_kill()
        if section:
            section.set_status(False)

    def _server_finished(self, name, code):
        """Server process bittiğinde çağrılır"""
        section = self._get_section(name)
        if section:
            section.add_log(f"[INFO] {name} server finished with code {code}")
            section.set_status(False)
            if hasattr(section, '_countdown_timer') and section._countdown_timer:
                section._countdown_timer.stop()
                section.countdown_label.setText("")

        # Worker referansını temizle
        if name == "searxng":
            self._searxng_worker = None
        elif name == "openwebui":
            self._openwebui_worker = None
        elif name == "llamacpp":
            self._llamacpp_worker = None
        elif name == "vane":
            self._vane_worker = None
        
        # Kaydedilen sunucu listesinden çıkar
        started = self._config.get("started_servers", [])
        if name in started:
            started.remove(name)
            self._config.set("started_servers", started)

    def _start_openwebui(self):
        port = self.ow_port.value()
        host = str(self.ow_bind.currentData())  # Bug: Bind address al
        self._config.set("openwebui_host", host)

        if self._openwebui_worker and self._openwebui_worker.get_status() == "running":
            section = self._get_section("openwebui")
            if section:
                QMessageBox.information(
                    self,
                    self._lang.get("info_already_running", "Already Running"),
                    self._lang.get("msg_server_already_running", "Open WebUI is already running on port {port}.").format(port=port)
                )
            return
        else:
            # Worker None/Done — port meşgul mü kontrol et (cleanup sonrası)
            if self.is_port_in_use(port):
                section = self._get_section("openwebui")
                if section:
                    QMessageBox.warning(
                        self,
                        self._lang.get("warning_port_in_use", "Port In Use"),
                        self._lang.get("error_port_busy_msg", f"Port {port} is already in use! Please choose another port.")
                    )
                self.log("openwebui", f"[ERROR] Port {port} in use after cleanup")
                return
        threads = self.ow_threads.value()
        self._config.set("openwebui_port", port)

        section = self._get_section("openwebui")
        if section:
            section.start_btn.setEnabled(False)
            section.start_countdown(90)

        self._openwebui_worker = OpenWebUIWorker()
        self._openwebui_worker.log_signal.connect(lambda msg: self._update_log("openwebui", msg))
        self._openwebui_worker.finished_signal.connect(
            lambda code: self._server_finished("openwebui", code)
        )
        self._openwebui_worker.start_server(port=port, threads=threads, host=host)  # Bug: Host parametresi ekle
        
        # Başlatıldı — durumu hemen güncelle
        if section:
            section.set_status(True)
        
        # Kaydedilen sunucular listesine ekle
        started = self._config.get("started_servers", [])
        if "openwebui" not in started:
            started.append("openwebui")
            self._config.set("started_servers", started)

    def _stop_openwebui(self):
        section = self._get_section("openwebui")
        if self._openwebui_worker and self._openwebui_worker.get_status() == "running":
            self._openwebui_worker.stop_process()
            if section:
                section.set_status(False)
        else:
            if section:
                section.set_status(False)

    def _force_kill_openwebui(self):
        """OpenWebUI process'ini ACILEN öldür — python ve tüm children!"""
        import psutil
        section = self._get_section("openwebui")
        
        if not self._openwebui_worker:
            # Worker yoksa port bazlı scan yap
            port = self.ow_port.value()
            try:
                for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                    try:
                        if 'python' in proc.info['name'].lower() and proc.info['cmdline']:
                            cmdline_str = ' '.join(proc.info['cmdline'])
                            if f':{port}' in cmdline_str or 'openwebui' in cmdline_str.lower():
                                pid = proc.info['pid']
                                psutil.Process(pid).kill()
                                self.log("openwebui", f"[FORCE KILL] Killed python PID {pid} by port scan")
                    except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                        pass
            except Exception as e:
                self.log("openwebui", f"[ERROR] Force kill error: {str(e)}")
            
            if section:
                section.set_status(False)
            return
        
        # Worker varsa force_kill metodunu çağır
        self._openwebui_worker.force_kill()
        if section:
            section.set_status(False)

    def _start_llamacpp(self):
        port = self.lc_port.value()
        host = str(self.lc_bind.currentData())  # Bug: Bind address al
        self._config.set("llamacpp_host", host)

        # Eğer worker None ise (cleanup sonrası), port kontrolü yap
        if not self._llamacpp_worker or self._llamacpp_worker.get_status() != "running":
            # Worker yoksa veya durdurulmuşsa — port meşgul mü kontrol et
            if self.is_port_in_use(port):
                section = self._get_section("llamacpp")
                if section:
                    QMessageBox.warning(
                        self,
                        self._lang.get("warning_port_in_use", "Port In Use"),
                        self._lang.get("error_port_busy_msg", f"Port {port} is already in use! Please choose another port.")
                    )
                self.log("llamacpp", f"[ERROR] Port {port} is already in use!")
                return

        ctx = int(self.lc_ctx.currentText())
        self._config.set("llamacpp_port", port)
        self._config.set("llamacpp_ctx", ctx)

        section = self._get_section("llamacpp")
        if section:
            section.start_btn.setEnabled(False)
            section.start_countdown(90)

        # Secili INI al
        main_win = self.window()
        ini_file = ""
        if main_win and hasattr(main_win, 'tab_system'):
            tab = main_win.tab_system
            if hasattr(tab, '_selected_ini') and tab._selected_ini:
                ini_file = tab._selected_ini
            else:
                # INI secili degilse ilk INI dosyasini kullan
                ini_files = sorted(ROOT.glob("vram*.ini"))
                if ini_files:
                    ini_file = ini_files[0].name
                    if hasattr(tab, '_selected_ini'):
                        tab._selected_ini = ini_file

        self._llamacpp_worker = LlamaCppWorker()
        self._llamacpp_worker.log_signal.connect(lambda msg: self._update_log("llamacpp", msg))
        self._llamacpp_worker.finished_signal.connect(
            lambda code: self._server_finished("llamacpp", code)
        )
        self._llamacpp_worker.start_server(
            port=port,
            ctx_size=ctx,
            ini_file=ini_file,
            host=host  # Bug: Host parametresi ekle
        )
        
        # Başlatıldı — durumu hemen güncelle
        if section:
            section.set_status(True)
        
        # Kaydedilen sunucular listesine ekle
        started = self._config.get("started_servers", [])
        if "llamacpp" not in started:
            started.append("llamacpp")
            self._config.set("started_servers", started)

    def _stop_llamacpp(self):
        section = self._get_section("llamacpp")
        if self._llamacpp_worker and self._llamacpp_worker.get_status() == "running":
            self._llamacpp_worker.stop_process()
            if section:
                section.set_status(False)
        else:
            if section:
                section.set_status(False)

    def _force_kill_llamacpp(self):
        """llama.cpp process'ini ACILEN öldür — direkt taskkill!"""
        import subprocess
        section = self._get_section("llamacpp")
        
        if not self._llamacpp_worker:
            # Worker yoksa port bazlı scan yap
            port = self.lc_port.value()
            try:
                result = subprocess.run(
                    ["netstat", "-ano"],
                    capture_output=True, text=True, timeout=5
                )
                for line in result.stdout.splitlines():
                    if f":{port}" in line:
                        parts = line.strip().split()
                        if parts:
                            pid = parts[-1]
                            if pid.isdigit() and pid != "0":
                                subprocess.run(
                                    ["taskkill", "/F", "/PID", pid],
                                    stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL,
                                )
                                self.log("llamacpp", f"[FORCE KILL] Killed PID {pid} by netstat scan")
            except Exception as e:
                self.log("llamacpp", f"[ERROR] Force kill error: {str(e)}")
            
            if section:
                section.set_status(False)
            return
        
        # Worker varsa force_kill metodunu çağır
        self._llamacpp_worker.force_kill()
        if section:
            section.set_status(False)

    def _update_log(self, server, message):
        """Log mesajını ilgili section'a ekle"""
        section = self._get_section(server)
        if section:
            section.add_log(message)

    def _find_section_by_title(self, title):
        """Başlığa göre ServerSection bul (yedek yöntem)"""
        for key, section in self._sections.items():
            if section._title == title:
                return section
        return None

    def stop_all_servers(self):
        """
        Tüm çalışan sunucuları durdur (kapatma sırasında çağrılır).
        Bug #2 + Bug #15: Tüm servisler düzgün durdurulur, 10s timeout ile.
        """
        print("[SHUTDOWN] === Stop ALL servers (graceful 10s timeout) ===")

        # --- Tüm aktif process'leri topla ---
        all_procs = []
        active_workers = []

        workers_map = {
            "searxng": self._searxng_worker,
            "openwebui": self._openwebui_worker,
            "llamacpp": self._llamacpp_worker,
            "vane": self._vane_worker,
        }

        for name, worker in workers_map.items():
            if not worker:
                print(f"[SHUTDOWN] {name}: worker is None — skip")
                continue

            status = worker.get_status()
            print(f"[SHUTDOWN] {name}: status={status}")

            if status == "running" and hasattr(worker, '_process') and worker._process:
                # psutil.Process objesi oluştur
                try:
                    proc = psutil.Process(worker._process.pid)
                    all_procs.append(proc)
                    active_workers.append((name, worker))
                except (psutil.NoSuchProcess, AttributeError):
                    pass

        if not all_procs:
            print("[SHUTDOWN] No active processes to stop.")
        else:
            print(f"[SHUTDOWN] Found {len(all_procs)} active process(es). Sending terminate...")

            # 1. Tüm child process tree'leri topla
            all_children = []
            for proc in all_procs:
                try:
                    children = proc.children(recursive=True)
                    all_children.extend(children)
                    print(f"[SHUTDOWN]   PID {proc.pid} has {len(children)} children")
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

            # Bireysel stop_process çağrıları (log sinyalleri için)
            for name, worker in active_workers:
                self.log(name, f"[SHUTDOWN] Stopping {name}...")
                worker.stop_process(timeout=10)

            # 2. Tüm process'leri (parent + children) birleştir
            all_to_wait = list(set(all_procs + all_children))

            # 3. 10 saniye graceful shutdown bekle
            gone, alive = psutil.wait_procs(all_to_wait, timeout=10)

            # 4. Timeout kalanları force kill
            if alive:
                print(f"[SHUTDOWN] TIMEOUT! {len(alive)} process(es) still alive. Force killing...")
                for proc in alive:
                    try:
                        proc.kill()
                        print(f"[SHUTDOWN]   Killed PID {proc.pid} ({proc.name()})")
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass

                # Son temizlik
                psutil.wait_procs(alive, timeout=2)

        # 5. Worker thread'lerini temizle
        for name, worker in active_workers:
            self.log(name, f"[SHUTDOWN] {name} shutdown complete.")
            worker._running = False
            worker._process = None
            worker._status = "stopped"

        # Tüm worker referanslarını sıfırla
        self._searxng_worker = None
        self._openwebui_worker = None
        self._llamacpp_worker = None
        self._vane_worker = None

        print("[SHUTDOWN] === All servers stopped ===")

    def log(self, server, message):
        """Log mesajı gönder (yardimci)"""
        self._update_log(server, message)

    def _start_vane(self):
        port = self.vane_port.value()
        host = str(self.vane_bind.currentData())  # Bug: Bind address al
        self._config.set("vane_host", host)

        if self._vane_worker and self._vane_worker.get_status() == "running":
            section = self._get_section("vane")
            if section:
                QMessageBox.information(
                    self,
                    self._lang.get("info_already_running", "Already Running"),
                    self._lang.get("msg_server_already_running", "Vane is already running on port {port}.").format(port=port)
                )
            return
        elif not self.is_port_in_use(port):
            # Port boş — başlatabiliriz
            pass
        else:
            # Port meşgul — uyarı ver ve çık
            section = self._get_section("vane")
            if section:
                QMessageBox.warning(
                    self,
                    self._lang.get("warning_port_in_use", "Port In Use"),
                    self._lang.get("error_port_busy_msg", f"Port {port} is already in use! Please choose another port.")
                )
            self.log("vane", f"[ERROR] Port {port} is already in use!")
            return

        section = self._get_section("vane")
        if section:
            section.start_btn.setEnabled(False)
            section.start_countdown(90)

        self._vane_worker = VaneWorker()
        self._vane_worker.log_signal.connect(lambda msg: self._update_log("vane", msg))
        self._vane_worker.finished_signal.connect(
            lambda code: self._server_finished("vane", code)
        )
        self._vane_worker.start_server(port=port, host=host)  # Bug: Host parametresi ekle

        if section:
            section.set_status(True)
        
        # Kaydedilen sunucular listesine ekle
        started = self._config.get("started_servers", [])
        if "vane" not in started:
            started.append("vane")
            self._config.set("started_servers", started)

    def _stop_vane(self):
        section = self._get_section("vane")
        if self._vane_worker and self._vane_worker.get_status() == "running":
            self._vane_worker.stop_process()
            if section:
                section.set_status(False)
        else:
            if section:
                section.set_status(False)

    def _force_kill_vane(self):
        """Vane process'ini ACILEN öldür — npm, node ve tüm ilgili process'ler!"""
        import subprocess
        section = self._get_section("vane")
        
        if not self._vane_worker:
            # Worker yoksa port bazlı scan yap
            port = self.vane_port.value()
            try:
                result = subprocess.run(
                    ["netstat", "-ano"],
                    capture_output=True, text=True, timeout=5
                )
                for line in result.stdout.splitlines():
                    if f":{port}" in line:
                        parts = line.strip().split()
                        if parts:
                            pid = parts[-1]
                            if pid.isdigit() and pid != "0":
                                subprocess.run(
                                    ["taskkill", "/F", "/PID", pid],
                                    stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL,
                                )
                                self.log("vane", f"[FORCE KILL] Killed PID {pid} by netstat scan")
            except Exception as e:
                self.log("vane", f"[ERROR] Force kill error: {str(e)}")
            
            if section:
                section.set_status(False)
            return
        
        # Worker varsa force_kill metodunu çağır
        self._vane_worker.force_kill()
        if section:
            section.set_status(False)

    def _on_searxng_port_changed(self, port):
        """SearXNG port degistiginde OpenWebUI env guncelle"""
        if port < 1024:
            self.searxng_port.setValue(8080)
            return
        self._config.set("searxng_port", port)
        self._update_openwebui_searxng_url(port)

    def _on_vane_port_changed(self, port):
        """Vane port degistiginde kaydet"""
        if port < 1024:
            self.vane_port.setValue(3001)
            return
        self._config.set("vane_port", port)

    def _on_openwebui_port_changed(self, port):
        """OpenWebUI port degistiginde kaydet"""
        if port < 1024:
            self.ow_port.setValue(3000)
            return
        self._config.set("openwebui_port", port)

    def _load_database(self):
        """Kullanıcıdan .db dosyası seç ve openwebui/database/ dizinine kopyala"""
        from PyQt6.QtWidgets import QFileDialog
        
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            self._lang.get("dialog_select_database", "Select Database File"),
            "",
            self._lang.get("dialog_db_filter", "Database Files (*.db)")
        )
        
        if not file_path:
            return  # Kullanıcı iptal etti
        
        # Dosya kontrolü
        if not file_path.lower().endswith('.db'):
            QMessageBox.warning(
                self,
                self._lang.get("warning_invalid_file", "Invalid File"),
                self._lang.get("error_not_db_file", "Please select a .db file.")
            )
            return
        
        # OpenWebUI database dizini — openwebui/ klasörünün içine
        project_root = ROOT
        db_dir = project_root / "openwebui"
        
        # Eski database'i yedekle (varsa)
        old_db = db_dir / "openwebui.db"
        if old_db.exists():
            backup_path = db_dir / "openwebui.db.backup"
            if backup_path.exists():
                backup_path.unlink()
            old_db.rename(backup_path)
            self.log("openwebui", f"[INFO] Old database backed up to: {backup_path}")
        
        # Yeni database'i kopyala — openwebui/ klasörüne
        import shutil
        dest_db = db_dir / "openwebui.db"
        shutil.copy2(file_path, str(dest_db))
        
        self.log("openwebui", f"[INFO] Database loaded from: {file_path}")
        self.log("openwebui", f"[INFO] Database saved to: {dest_db}")
        
        # OpenWebUI'yi yeniden başlat
        if self._openwebui_worker and self._openwebui_worker.get_status() == "running":
            self.log("openwebui", "[INFO] Restarting OpenWebUI to apply new database...")
            self._stop_openwebui()
            from PyQt6.QtCore import QTimer
            QTimer.singleShot(2000, self._start_openwebui)
        else:
            QMessageBox.information(
                self,
                self._lang.get("info_database_loaded", "Database Loaded"),
                self._lang.get("info_db_restart_msg", "Database loaded successfully.\nStart OpenWebUI to use it.")
            )

    def _on_llamacpp_port_changed(self, port):
        """llama.cpp port degistiginde kaydet"""
        # Minimum port 1024 (unprivileged ports)
        if port < 1024:
            self.lc_port.setValue(1234)
            return
        self._config.set("llamacpp_port", port)

    def _update_openwebui_searxng_url(self, searxng_port):
        """OpenWebUI env dosyasinda SEARXNG URL'sini guncelle"""
        # OpenWebUI calisirken degistirilemez, sadece uyari ver
        # Kullanici OpenWebUI'yi yeniden baslatmali
        url = f"http://localhost:{searxng_port}/search?q=<query>"
        if hasattr(self, 'log'):
            self.log("openwebui", f"[INFO] SearXNG port changed to {searxng_port}")
            self.log("openwebui", f"[INFO] Restart OpenWebUI to apply: {url}")
        # Not: OpenWebUI env variable'lari baslatirken okunur,
        # bu yuzden calisirken degistirilemez. Sadece config'e yazildi.
