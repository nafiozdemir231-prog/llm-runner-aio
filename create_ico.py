"""
PNG'den proper .ico oluştur — manuel ICO binary formatı
"""

import struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent
INPUT = ROOT / "assets" / "icon.png"
OUTPUT = ROOT / "assets" / "icon.ico"


def png_to_ico():
    """PNG'den multiple-size .ico oluştur"""
    base = Image.open(INPUT).convert("RGBA")
    
    sizes = [16, 32, 48, 256]
    images = []
    
    for size in sizes:
        resized = base.resize((size, size), Image.LANCZOS)
        images.append(resized)
    
    # ICO binary oluştur
    with open(OUTPUT, "wb") as f:
        # ICO header
        f.write(struct.pack("<HHH", 0, 1, 4))  # reserved, type=icon, count
        
        for img in images:
            data = img.tobytes("raw", "RGBA")
            width, height = img.size
            
            # ICO formatında 255+ boyutlar 0 olarak işaretlenir (256 = 0)
            w_byte = width if width < 256 else 0
            h_byte = height if height < 256 else 0
            
            # Her entry
            f.write(struct.pack("BBBB", w_byte, h_byte, 0, 0))  # w, h, color_count, reserved
            f.write(struct.pack("<HH", 32, 4))  # planes, bits_per_pixel
            f.write(struct.pack("<I", len(data)))  # size_of_image
            # offset — entries'den sonra
            offset = 22 + (4 * 16)  # header + 4 entries * 16 bytes each (we'll fix this)
            f.write(struct.pack("<I", offset))
        
        # Şimdi image data'yı yaz (entries'ler zaten offset tutuyor)
        for img in images:
            data = img.tobytes("raw", "RGBA")
            # BGRA formatına çevir (Windows ICO BGRA bekler)
            bgra = []
            for i in range(0, len(data), 4):
                bgra.extend([data[i+2], data[i+1], data[i], data[i+3]])
            f.write(bytes(bgra))
    
    print(f"[OK] {OUTPUT} oluşturuldu!")
    print(f"     Boyutlar: {sizes}")


if __name__ == "__main__":
    png_to_ico()
