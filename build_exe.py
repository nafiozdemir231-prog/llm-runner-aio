"""
LLM Runner AIO - PyInstaller build script
Launcher'i tek bir .exe dosyasina cevirir.

Kullanim: python build_exe.py
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def install_pyinstaller():
    """PyInstaller kur"""
    print("PyInstaller kuruluyor...")
    subprocess.run([
        sys.executable, "-m", "pip", "install",
        "--trusted-host", "pypi.org", "--trusted-host", "files.pythonhosted.org",
        "pyinstaller"
    ])


def build_exe():
    """EXE olustur"""
    # Once PyInstaller kur
    try:
        import PyInstaller
        print(f"PyInstaller {PyInstaller.__version__} hazir")
    except ImportError:
        install_pyinstaller()

    # PyInstaller komutu
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",                    # Tek dosya
        "--windowed",                   # Konsol penceresi acma
        "--name=LLM Runner AIO",        # EXE adi
        "--icon=assets/icon.ico",       # Ikon (varsa)
        "--add-data=launcher;launcher", # Launcher klasoru
        "--add-data=lang;launcher/lang", # Dil dosyasi
        "--add-data=*.ini;.",            # INI dosyalari
        "--add-data=model_urls.json;.",  # Model URL'leri
        "--add-data=llama.cpp-cuda13+vulkan;llama.cpp-cuda13+vulkan",  # llama.cpp
        "--hidden-import=PyQt6.QtCore",
        "--hidden-import=PyQt6.QtGui",
        "--hidden-import=PyQt6.QtWidgets",
        "--collect-all=huggingface_hub",
        "launcher/main.py"
    ]

    # Ikon yoksa kaldir
    icon_path = ROOT / "assets" / "icon.ico"
    if not icon_path.exists():
        cmd = [c for c in cmd if not c.startswith("--icon=")]

    # llama.cpp yoksa kaldir
    llama_dir = ROOT / "llama.cpp-cuda13+vulkan"
    if not llama_dir.exists():
        cmd = [c for c in cmd if "llama.cpp" not in c]

    print(f"\nPyInstaller calistiriliyor...")
    print(f"Komut: {' '.join(cmd[:5])}...\n")

    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode == 0:
        exe_path = ROOT / "dist" / "LLM Runner AIO.exe"
        if exe_path.exists():
            print(f"\n[OK] EXE olusturuldu: {exe_path}")
            print(f"     Boyut: {exe_path.stat().st_size / (1024*1024):.1f} MB")
            return True
    print("\n[HATA] EXE olusturulamadi")
    return False


if __name__ == "__main__":
    build_exe()
