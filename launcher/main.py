"""
LLM Runner AIO - Ana Giriş Noktası
"""

import sys
import os
import ctypes
import psutil
from pathlib import Path
from PyQt6.QtGui import QIcon

# .exe içinde import problemi olmaması için
try:
    from app import run as app_run
except ImportError:
    import importlib.util
    app_path = Path(__file__).parent / "app.py"
    if app_path.exists():
        spec = importlib.util.spec_from_file_location("app", app_path)
        app_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(app_mod)
        app_run = app_mod.run
    else:
        app_run = None

try:
    from ui.main_window import MainWindow
except ImportError:
    import importlib.util
    mw_path = Path(__file__).parent / "ui" / "main_window.py"
    if mw_path.exists():
        spec = importlib.util.spec_from_file_location("main_window", mw_path)
        mw_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mw_mod)
        MainWindow = mw_mod.MainWindow
    else:
        MainWindow = None

# Windows Taskbar düzeltme — Python process ismini gizle
# Bu, görev çubuğunda ayrı uygulama grubu oluşturmamı saglar
try:
    if sys.platform == "win32":
        myappid = "llmrunneraio.app.1.0"  # benzersiz AppUserModelID
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
except Exception:
    pass


# ============================================
# Bug #13: Orphan Process Temizliği (Startup)
# ============================================
TARGET_PROCESS_NAMES = [
    "llama-server.exe",
    "node.exe",      # Vane process'leri (güvenli filtrasyon ile)
    "uvicorn.exe",   # OpenWebUI process'leri
    "pythonw.exe",   # SearXNG process'leri
]

PROJECT_DIR = Path(__file__).parent.parent  # D:/OpenCode/LLM-Runner-AIO


def cleanup_orphan_processes():
    """
    Uygulama açılışında geride kalan orphan process'leri temizler.
    psutil kullanarak güvenli şekilde terminate → wait → kill döngüsü uygular.
    """
    print("[CLEANUP] Scanning for orphaned processes...")
    current_pid = os.getpid()

    processes_to_kill = []

    for proc in psutil.process_iter(['pid', 'name', 'create_time', 'cmdline', 'cwd']):
        try:
            # Kendi process'imizi atla
            if proc.pid == current_pid:
                continue
            if proc.pid == os.getppid():
                continue

            proc_name = proc.info['name'].lower() if proc.info['name'] else None

            if not proc_name or proc_name.lower() not in [n.lower() for n in TARGET_PROCESS_NAMES]:
                continue

            # node.exe için ekstra güvenlik: sadece bizim projemizle ilişkili olanları öldür
            if proc_name == "node.exe":
                try:
                    cmdline = proc.cmdline()
                    cwd = proc.cwd()
                    # Projemizin Vane dizininde mi veya Vane'i başlatan biz miyiz?
                    project_vane = PROJECT_DIR / "Vane"
                    if not (project_vane.exists() and (str(project_vane) in str(cwd) or any("Vane" in c for c in cmdline))):
                        # Bizim Vane process'imiz değilse skip
                        continue
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    # Bilgi alamıyorsak güvenli taraf: skip
                    continue

            processes_to_kill.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    if not processes_to_kill:
        print("[CLEANUP] No orphaned processes found.")
        return

    print(f"[CLEANUP] Found {len(processes_to_kill)} orphaned process(es). Terminating...")

    # 1. Graceful terminate
    for proc in processes_to_kill:
        try:
            print(f"[CLEANUP] Terminating: {proc.name()} (PID: {proc.pid})")
            proc.terminate()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    # 2. 3 saniye bekle
    gone, alive = psutil.wait_procs(processes_to_kill, timeout=3)

    # 3. Hayatta kalanları force kill
    if alive:
        print(f"[CLEANUP] {len(alive)} process(es) didn't stop gracefully. Force killing...")
        for proc in alive:
            try:
                print(f"[CLEANUP] Force killing: {proc.name()} (PID: {proc.pid})")
                proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        # Son bir kontrol
        psutil.wait_procs(alive, timeout=2)

    print("[CLEANUP] Orphan cleanup complete.")


def main():
    """Uygulamayı başlat"""
    # Bug #14: Log rotasyonu kurulumu (her zaman önce)
    from app import setup_logging
    setup_logging()

    # Bug #13: Orphan process temizliği — QApplication başlamadan ÖNCE
    cleanup_orphan_processes()

    if app_run is None:
        print("[ERROR] app.py bulunamadı!")
        sys.exit(1)
    manager = app_run()
    qapp = manager.get_app()
    
    # Icon yolu — .exe içinde veya normal modda
    if getattr(sys, 'frozen', False):
        icon_path = Path(sys._MEIPASS) / "assets" / "icon.ico"
    else:
        icon_path = Path(__file__).parent / "assets" / "icon.ico"
    
    # Icon'u hem QApplication hem MainWindow'a ayarla
    if icon_path.exists():
        icon = QIcon(str(icon_path))
        qapp.setWindowIcon(icon)  # Gorev çubuğu için
    
    if MainWindow is None:
        print("[ERROR] main_window.py bulunamadı!")
        sys.exit(1)
    window = MainWindow()
    window.show()
    sys.exit(qapp.exec())


if __name__ == "__main__":
    main()
