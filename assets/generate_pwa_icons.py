"""Generate all PWA PNG icons using PIL for DocuShield."""
from PIL import Image, ImageDraw
import math
import os

ASSETS_DIR = r"c:\jyotirmaya\Docushield\assets"
os.makedirs(ASSETS_DIR, exist_ok=True)

def draw_shield_icon(size, is_maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background
    if is_maskable:
        # Full solid background for maskable icons (Android adapts shape)
        draw.rectangle([0, 0, size, size], fill=(17, 20, 21, 255))
        padding = size * 0.22  # Safe zone is center 60-70%
    else:
        # Rounded squircle background
        r = size * 0.22
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(17, 20, 21, 255), outline=(90, 122, 153, 100), width=max(1, int(size * 0.015)))
        padding = size * 0.16

    # Coordinate mapping inside [padding, size - padding]
    w = size - 2 * padding
    h = size - 2 * padding
    ox = padding
    oy = padding

    # Shield polygon coordinates normalized to (0..1, 0..1)
    # SVG path: M14 2L25 6.5V15.5C25 21.8 19.8 26.8 14 28.5C8.2 26.8 3 21.8 3 15.5V6.5L14 2Z (bounds roughly 3..25 x, 2..28.5 y, width 22, height 26.5)
    pts_norm = [
        (0.50, 0.05),  # top point
        (0.92, 0.20),  # top right
        (0.92, 0.52),  # right curve start
        (0.85, 0.72),
        (0.70, 0.88),
        (0.50, 0.98),  # bottom point
        (0.30, 0.88),
        (0.15, 0.72),
        (0.08, 0.52),  # left curve start
        (0.08, 0.20),  # top left
    ]

    shield_pts = [(ox + px * w, oy + py * h) for px, py in pts_norm]

    # Draw shield body
    draw.polygon(shield_pts, fill=(26, 28, 30, 255))
    
    stroke_w = max(2, int(size * 0.035))
    # Draw shield border
    draw.polygon(shield_pts, outline=(90, 122, 153, 255), width=stroke_w)

    # Circuit / Biometric lines inside shield
    line_w = max(1, int(size * 0.025))
    green = (63, 169, 138, 255)

    # Vertical center lines
    cx = ox + 0.50 * w
    draw.line([(cx, oy + 0.25 * h), (cx, oy + 0.40 * h)], fill=green, width=line_w)
    draw.line([(cx, oy + 0.50 * h), (cx, oy + 0.76 * h)], fill=green, width=line_w)

    # Cyan/green dot at top
    dot_r = max(2, int(size * 0.035))
    draw.ellipse([cx - dot_r, oy + 0.20 * h - dot_r, cx + dot_r, oy + 0.20 * h + dot_r], fill=green)

    # Arching biometric line
    arc_box = [ox + 0.32 * w, oy + 0.38 * h, ox + 0.68 * w, oy + 0.68 * h]
    draw.arc(arc_box, start=180, end=0, fill=green, width=line_w)

    return img

sizes = [72, 96, 128, 144, 152, 192, 384, 512]
for s in sizes:
    img = draw_shield_icon(s, is_maskable=False)
    img.save(os.path.join(ASSETS_DIR, f"icon-{s}.png"), "PNG")
    print(f"Generated icon-{s}.png")

# Maskable icons
for s in [192, 512]:
    img = draw_shield_icon(s, is_maskable=True)
    img.save(os.path.join(ASSETS_DIR, f"icon-maskable-{s}.png"), "PNG")
    print(f"Generated icon-maskable-{s}.png")

# Apple touch icon (180x180)
draw_shield_icon(180).save(os.path.join(ASSETS_DIR, "apple-touch-icon.png"), "PNG")
print("Generated apple-touch-icon.png")

# Favicons
draw_shield_icon(32).save(os.path.join(ASSETS_DIR, "favicon-32x32.png"), "PNG")
draw_shield_icon(16).save(os.path.join(ASSETS_DIR, "favicon-16x16.png"), "PNG")
print("All PWA icons generated successfully!")
