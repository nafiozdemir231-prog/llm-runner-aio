"""
LLM Runner AIO - Electron Masaüstü Kısayol Oluşturucu
Terminal gizli, doğrudan Electron'u başlatır (run.bat YOK)
"""

import sys
from pathlib import Path

# pywin32 import
try:
    import win32com.client
except ImportError:
    print("pywin32 kütüphanesi gerekli! pip install pywin32")
    sys.exit(1)


def create_shortcut():
    """Masaüstüne doğrudan Electron kısayolu oluşturur"""
    
    import os
    
    # LLM-Runner-AIO dizini (electron/'in bir üstü)
    ROOT = Path(__file__).parent.parent
    electron_dir = Path(__file__).parent
    
    # Desktop yolu (OneDrive destekli)
    desktop = Path.home() / "Desktop"
    if not desktop.exists():
        od = Path.home() / "OneDrive" / "Desktop"
        if od.exists():
            desktop = od
    
    shortcut_path = desktop / "LLM Runner AIO.lnk"
    
    # Desktop yoksa oluştur
    if not desktop.exists():
        try:
            desktop.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"[HATA] Desktop oluşturulamadı: {e}")
            return False
    
    # Eski kısyol varsa sil
    if shortcut_path.exists():
        try:
            shortcut_path.unlink()
        except Exception as e:
            print(f"[UYARI] Eski kısyol silinemedi: {e}")
    
    # Windows Shell nesnesi
    shell = win32com.client.Dispatch("WScript.Shell")
    
    # Yeni bir kısyol nesnesi oluştur
    tmp_path = desktop / "LLM Runner AIO_tmp.lnk"
    if tmp_path.exists():
        try:
            tmp_path.unlink()
        except Exception:
            pass
    
    shortcut = shell.CreateShortCut(str(tmp_path))
    
    # Hedef: launch_app.vbs ile DOĞRUDAN Electron'u baslat (terminal GIZLI)
    shortcut.TargetPath = str(ROOT / "electron" / "launch_app.vbs")
    shortcut.Arguments = ""
    
    # Çalışma dizini = LLM-Runner-AIO (electron'un bir üstü)
    shortcut.WorkingDirectory = str(ROOT)
    
    # Terminal gizle (SW_HIDE = 0)
    shortcut.WindowStyle = 0
    
    # Açıklama
    shortcut.Description = "LLM Runner AIO - Local AI Platform"
    
    # İkon - assets/icon.ico
    icon_path = ROOT / "assets" / "icon.ico"
    if icon_path.exists():
        shortcut.IconLocation = str(icon_path)
    else:
        png_path = ROOT / "assets" / "icon.png"
        if png_path.exists():
            shortcut.IconLocation = str(png_path)
        else:
            shortcut.IconLocation = "shell32.dll,0"
    
    # Kısyolu kaydet
    shortcut.Save()
    
    # _tmp dosyasını gerçek isimle değiştir
    if tmp_path.exists():
        import shutil
        shutil.move(str(tmp_path), str(shortcut_path))
    
    print(f"✅ Kısyol oluşturuldu: {shortcut_path}")
    print(f"   Hedef: launch_app.vbs → npx electron . (terminal GIZLI)")
    print(f"   Çalışma dizini: {ROOT}")
    print(f"   İkon: {icon_path if icon_path.exists() else 'shell32.dll,0'}")
    print(f"   Pencere stili: Gizli (arka plan)")
    
    return True


if __name__ == "__main__":
    create_shortcut()
