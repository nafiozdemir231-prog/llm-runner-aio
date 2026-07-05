"""
icon.ico dosyasını oluştur — multiple boyutlar ile
planet_system2.png → proper .ico formatı
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent
INPUT = ROOT / "assets" / "planet_system2.png"
OUTPUT = ROOT / "assets" / "icon.ico"


def create_ico():
    """PNG'den proper .ico oluştur (16, 32, 48, 256 boyutları)"""
    if not INPUT.exists():
        print(f"[HATA] {INPUT} bulunamadı!")
        return

    base = Image.open(INPUT).convert("RGBA")
    
    # İstenen boyutlar
    sizes = [16, 32, 48, 256]
    frames = []
    
    for size in sizes:
        resized = base.resize((size, size), Image.LANCZOS)
        frames.append(resized)
        print(f"  ✓ {size}x{size} hazır")
    
    # .ico olarak kaydet
    frames[0].save(
        str(OUTPUT),
        format="ICO",
        append_images=frames[1:],
        save_all=True
    )
    
    print(f"\n[OK] {OUTPUT} oluşturuldu!")
    print(f"     Boyutlar: {sizes}")
    print(f"     Format: Windows ICO (multiple sizes)")


if __name__ == "__main__":
    create_ico()
