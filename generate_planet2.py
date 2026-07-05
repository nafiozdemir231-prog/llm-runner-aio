"""
planet_system2.png oluştur — 3 güneş sistemi + halkalı mor gezegen
"""

from PIL import Image, ImageDraw, ImageFilter
import math

W, H = 512, 512
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Arka plan — derin uzay
for y in range(H):
    for x in range(W):
        r = math.sqrt((x - W/2)**2 + (y - H/2)**2)
        brightness = max(0, int(15 - r / 40))
        img.putpixel((x, y), (brightness, brightness, brightness + 5, 255))

# Yıldız alanı
import random
random.seed(42)
for _ in range(200):
    x, y = random.randint(0, W), random.randint(0, H)
    size = random.randint(1, 2)
    alpha = random.randint(100, 255)
    draw.ellipse([x, y, x+size, y+size], fill=(255, 255, 255, alpha))

# 3 güneş — üçgen konumda
sun_positions = [(150, 150), (360, 130), (255, 350)]
sun_colors = [(255, 200, 50), (255, 180, 30), (255, 220, 80)]

for i, (sx, sy) in enumerate(sun_positions):
    # Glow efekti
    for r in range(80, 0, -1):
        alpha = int(40 * (1 - r/80))
        color = (255, 200, 50, alpha)
        draw.ellipse([sx-r, sy-r, sx+r, sy+r], fill=color)
    
    # Güneş çekirdeği
    draw.ellipse([sx-20, sy-20, sx+20, sy+20], fill=sun_colors[i])
    draw.ellipse([sx-15, sy-15, sx+15, sy+15], fill=(255, 240, 150))

# Mor gezegen — merkezde
cx, cy = 256, 256
planet_r = 80

# Gezegen gölgesi
for r in range(planet_r + 30, 0, -1):
    alpha = max(0, 60 - r)
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(80, 40, 120, alpha))

# Gezegen ana gövde
draw.ellipse([cx-planet_r, cy-planet_r, cx+planet_r, cy+planet_r], fill=(100, 50, 160))

# Gezegen detayları — bands
for i in range(-3, 4):
    y_offset = cy + i * 18
    if abs(i) < 3:
        draw.line([(cx - int(math.sqrt(planet_r**2 - (i*18)**2)), y_offset),
                    (cx + int(math.sqrt(planet_r**2 - (i*18)**2)), y_offset)],
                   fill=(140, 80, 180, 120) if i % 2 == 0 else (80, 40, 130, 100), width=4)

# Halka — eğik
draw.ellipse([cx-160, cy-20, cx+160, cy+20], outline=(180, 140, 220, 180), width=8)
draw.ellipse([cx-150, cy-15, cx+150, cy+15], outline=(200, 160, 240, 120), width=4)

# Parlaklık efekti — sol üst
gradient = Image.new("RGBA", (W, H), (0, 0, 0, 0))
grad_draw = ImageDraw.Draw(gradient)
for i in range(100):
    alpha = int(40 * (1 - i/100))
    grad_draw.ellipse([cx-planet_r+i, cy-planet_r+i, cx-planet_r+i*2, cy-planet_r+i*2],
                      fill=(255, 255, 255, alpha))
img = Image.alpha_composite(img, gradient)

# Kaydet
img.save("D:/OpenCode/LLM-Runner-AIO/assets/planet_system2.png", "PNG")
print("[OK] planet_system2.png oluşturuldu (512x512)")
