"""
LLM Runner AIO - Masaustu kisayol olusturucu
pythonw.exe ile terminal gizleyerek calistirir.
Icon'lu kisayol olusturur.
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path
import platform

ROOT = Path(__file__).parent
MAIN_PY = ROOT / "launcher" / "main.py"


def get_pythonw_path():
    """pythonw.exe tam yolunu bul (penceresi gizli Python)"""
    # Oncelikle venv icindeki pythonw
    venv_pythonw = ROOT / "venv" / "Scripts" / "pythonw.exe"
    if venv_pythonw.exists():
        return str(venv_pythonw)

    # Sistem pythonw
    system_pythonw = shutil.which("pythonw.exe")
    if system_pythonw:
        return system_pythonw

    # Ayni dizinde python
    current_python = Path(sys.executable)
    pythonw = current_python.parent / "pythonw.exe"
    if pythonw.exists():
        return str(pythonw)

    return None


def get_icon_path():
    """Kullanilacak icon dosyasi"""
    # assets klasorunde icon varsa kullan
    icon_ico = ROOT / "assets" / "icon.ico"
    if icon_ico.exists():
        return str(icon_ico)
    return None


def create_windows_shortcut():
    """Windows .lnk kisayolu olustur"""
    if platform.system() != "Windows":
        print("Bu script sadece Windows'ta calisir")
        return False

    import ctypes
    from ctypes import wintypes

    pythonw = get_pythonw_path()
    if not pythonw:
        print("[HATA] pythonw.exe bulunamadi!")
        return False

    icon = get_icon_path()

    desktop = Path.home() / "Desktop"
    shortcut_path = desktop / "LLM Runner AIO.lnk"

    try:
        # PowerShell ile kisayol olustur
        ps_script = f'''
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("{shortcut_path}")
$Shortcut.TargetPath = "{pythonw}"
$Shortcut.Arguments = '"{MAIN_PY}"'
$Shortcut.WorkingDirectory = "{ROOT}"
$Shortcut.WindowStyle = 7  # 7 = minimized
'''

        if icon:
            ps_script += f'$Shortcut.IconLocation = "{icon}"\n'
        else:
            # pythonw.exe simgesini kullan
            ps_script += f'$Shortcut.IconLocation = "{pythonw},0"\n'

        ps_script += '$Shortcut.Description = "LLM Runner AIO Launcher"\n'
        ps_script += '$Shortcut.Save()\n'

        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_script],
            capture_output=True, text=True
        )

        if result.returncode == 0 and shortcut_path.exists():
            print(f"[OK] Kisayol olusturuldu: {shortcut_path}")
            print(f"     Hedef: {pythonw}")
            print(f"     Arg: {MAIN_PY}")
            if icon:
                print(f"     Icon: {icon}")
            return True
        else:
            print(f"[HATA] {result.stderr}")
            return False
    except Exception as e:
        print(f"[HATA] {e}")
        return False


def create_vbs_launcher():
    """VBS ile terminal gizleme launcher"""
    vbs_path = ROOT / "launch_silent.vbs"
    pythonw = get_pythonw_path()

    vbs_content = f'''Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """{pythonw}"" """"{MAIN_PY}"" """, 0, False
Set WshShell = Nothing
'''

    try:
        with open(vbs_path, "w", encoding="utf-8") as f:
            f.write(vbs_content)
        print(f"[OK] VBS launcher: {vbs_path}")
        return True
    except Exception as e:
        print(f"[HATA] {e}")
        return False


def main():
    print("=" * 50)
    print("  LLM Runner AIO - Kisayol Olusturucu")
    print("=" * 50)
    print()

    # 1. VBS launcher (terminal gizli)
    print("1. VBS launcher olusturuluyor (terminal gizli)...")
    create_vbs_launcher()
    print()

    # 2. Masaustu kisayolu
    print("2. Masaustu kisayolu olusturuluyor...")
    if create_windows_shortcut():
        print()
        print("=" * 50)
        print("  TAMAMLANDI!")
        print("=" * 50)
        print()
        print("  Masaustunde 'LLM Runner AIO' kisayoluna tiklayarak")
        print("  terminal penceresi AÇILMADAN calistirabilirsiniz.")
    else:
        print()
        print("VBS launcher'i manuel olarak calistirabilirsiniz:")
        print(f"  {ROOT / 'launch_silent.vbs'}")


if __name__ == "__main__":
    main()
