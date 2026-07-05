"""
Windows ikon cache'ini temizle
Explorer'ı yeniden başlatır, ikon cache dosyalarını siler
"""

import os
import subprocess
import time
from pathlib import Path


def clear_icon_cache():
    """İkon cache dosyalarını sil ve Explorer'ı yeniden başlat"""
    
    # 1. Explorer'ı durdur
    print("[1/4] Explorer durduruluyor...")
    try:
        subprocess.run(["taskkill", "/F", "/IM", "explorer.exe"], 
                      capture_output=True, timeout=5)
        time.sleep(1)
        print("  ✓ Explorer durdu")
    except Exception as e:
        print(f"  ⚠ Explorer durdurulamadı: {e}")
    
    # 2. Icon cache dosyalarını sil
    print("[2/4] İkon cache temizleniyor...")
    cache_paths = [
        Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Explorer" / "iconcache_16.db",
        Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Explorer" / "iconcache_32.db",
        Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Explorer" / "iconcache_48.db",
        Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Explorer" / "iconcache_96.db",
        Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Explorer" / "iconcache_256.db",
        Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Explorer" / "iconcache_large.db",
        Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Explorer" / "iconcache.db",
    ]
    
    deleted = 0
    for cache_file in cache_paths:
        try:
            if cache_file.exists():
                cache_file.unlink()
                deleted += 1
        except Exception:
            pass
    
    print(f"  ✓ {deleted} cache dosyası silindi")
    
    # 3. Explorer'ı yeniden başlat
    print("[3/4] Explorer yeniden başlatılıyor...")
    try:
        subprocess.run(["start", "explorer.exe"], shell=True)
        time.sleep(2)
        print("  ✓ Explorer yeniden başladı")
    except Exception as e:
        print(f"  ⚠ Explorer başlatılamadı: {e}")
    
    # 4. Bitti
    print("[4/4] Tamamlandı!")
    print("\n📌 Şimdi masaüstüne git ve kısayolun ikonunu kontrol et.")
    print("   F5 ile masaüstünü yenilemeyi dene.")


if __name__ == "__main__":
    clear_icon_cache()
