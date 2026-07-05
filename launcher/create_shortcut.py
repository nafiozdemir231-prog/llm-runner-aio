"""
LLM Runner AIO - Masaüstü Kısayol Oluşturucu
Terminal gizli, arka planda çalışır, ikonlu
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
    """Masaüstüne kısayol oluşturur"""
    
    import os
    
    # ROOT dizini = launcher/'in bir üstü
    ROOT = Path(__file__).parent.parent
    launcher_dir = Path(__file__).parent
    
    # Hedef: pythonw.exe ile main.py çalıştır (terminal gizli)
    target_exe = str(launcher_dir.parent / "venv" / "Scripts" / "pythonw.exe")
    target_script = str(launcher_dir / "main.py")
    
    # Kısayol yolu = masaüstü (OneDrive destekli)
    desktop = Path.home() / "Desktop"
    if not desktop.exists():
        # OneDrive Desktop dene
        desktop = Path.home() / "OneDrive" / "Desktop"
    
    shortcut_path = desktop / "LLM Runner AIO.lnk"
    
    # DEBUG: Yolları kontrol et
    print(f"[DEBUG] Desktop: {desktop}")
    print(f"[DEBUG] Desktop var mı: {desktop.exists()}")
    print(f"[DEBUG] Hedef exe: {target_exe}")
    print(f"[DEBUG] Hedef exe var mı: {os.path.exists(target_exe)}")
    print(f"[DEBUG] Hedef script: {target_script}")
    print(f"[DEBUG] Kısayol yolu: {shortcut_path}")
    
    # Desktop yoksa oluştur
    if not desktop.exists():
        print(f"[UYARI] Desktop klasörü yok, olusturuluyor: {desktop}")
        try:
            desktop.mkdir(parents=True, exist_ok=True)
            print(f"[OK] Desktop olusturuldu")
        except Exception as e:
            print(f"[HATA] Desktop olusturulamadı: {e}")
            return False
    
    # Eski kısayol varsa sil (aynı isimde dosya varsa hata verir)
    if shortcut_path.exists():
        try:
            shortcut_path.unlink()
        except Exception as e:
            print(f"[UYARI] Eski kısayol silinemedi: {e}")
    
    # Windows Shell nesnesi
    shell = win32com.client.Dispatch("WScript.Shell")
    
    # Yeni bir kısayol nesnesi oluştur (tmp isimle, sonra taşı)
    tmp_path = desktop / "LLM Runner AIO_tmp.lnk"
    if tmp_path.exists():
        try:
            tmp_path.unlink()
        except Exception:
            pass
    
    print(f"[DEBUG] tmp_path: {tmp_path}")
    
    shortcut = shell.CreateShortCut(str(tmp_path))
    
    # Hedef dosya
    shortcut.TargetPath = target_exe
    shortcut.Arguments = f'"{target_script}"'
    
    # Çalışma dizini
    shortcut.WorkingDirectory = str(launcher_dir)
    
    # İkon - assets/icon.ico
    icon_path = ROOT / "assets" / "icon.ico"
    if icon_path.exists():
        shortcut.IconLocation = str(icon_path)
    else:
        # pythonw.exe ikonunu kullan
        shortcut.IconLocation = target_exe + ",0"
    
    # Terminal gizle (SW_HIDE = 0)
    shortcut.WindowStyle = 0
    
    # Açıklama
    shortcut.Description = "LLM Runner AIO - Local AI Launcher"
    
    # Kısayolu kaydet
    shortcut.Save()
    
    #_tmp dosyasını gerçek isimle değiştir
    if tmp_path.exists():
        import shutil
        shutil.move(str(tmp_path), str(shortcut_path))
    
    print(f"✅ Kısayol oluşturuldu: {shortcut_path}")
    print(f"   Hedef: {target_exe} {target_script}")
    print(f"   İkon: {icon_path if icon_path.exists() else 'pythonw.exe'}")
    print(f"   Pencere stili: Gizli (arka plan)")
    
    return True


if __name__ == "__main__":
    create_shortcut()
