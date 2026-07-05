"""
icon.png -> proper icon.ico
"""

import struct
from pathlib import Path
from PIL import Image

ROOT = Path("D:/OpenCode/LLM-Runner-AIO")
INPUT = ROOT / "assets" / "icon.png"
OUTPUT = ROOT / "assets" / "icon.ico"

def create_proper_ico():
    base = Image.open(INPUT).convert("RGBA")
    sizes = [256, 48, 32, 16]
    images = []
    
    for size in sizes:
        resized = base.resize((size, size), Image.LANCZOS)
        images.append(resized)
        print(f"  OK {size}x{size}")
    
    entries = []
    for img in images:
        w, h = img.size
        w_byte = 0 if w > 255 else w
        h_byte = 0 if h > 255 else h
        
        raw = img.tobytes("raw", "RGBA")
        bgra = bytearray()
        for i in range(0, len(raw), 4):
            bgra.extend([raw[i+2], raw[i+1], raw[i], raw[i+3]])
        
        data = bytes(bgra)
        entries.append({
            'width': w_byte,
            'height': h_byte,
            'size': len(data),
            'data': data,
        })
    
    # Header: 6 bytes
    # Entries: 16 bytes each
    # Then image data
    
    with open(OUTPUT, "wb") as f:
        # Header
        f.write(struct.pack("<HHH", 0, 1, len(entries)))
        
        # Calculate offsets
        header_size = 6
        entry_size = 16
        data_start = header_size + len(entries) * entry_size
        
        for i, e in enumerate(entries):
            offset = data_start + sum(en['size'] for en in entries[:i])
            f.write(struct.pack("BBBBHHII",
                e['width'], e['height'], 0, 0, 1, 32, e['size'], offset
            ))
        
        # Image data
        for e in entries:
            f.write(e['data'])
    
    print(f"\nOK: {OUTPUT}")
    
    # Test
    try:
        from PyQt6.QtGui import QIcon
        test = QIcon(str(OUTPUT))
        print(f"  PyQt6 valid: {not test.isNull()}")
        print(f"  PyQt6 sizes: {test.availableSizes()}")
    except Exception as ex:
        print(f"  PyQt6 error: {ex}")

if __name__ == "__main__":
    create_proper_ico()
