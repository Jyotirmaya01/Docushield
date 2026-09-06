"""Generate placeholder preview screenshots for PWA manifest."""
from PIL import Image, ImageDraw, ImageFont
import os

ASSETS_DIR = r"c:\jyotirmaya\Docushield\assets"

def make_screenshot(width, height, title, subtitle, filename):
    img = Image.new("RGB", (width, height), (17, 20, 21))
    draw = ImageDraw.Draw(img)

    # Top header bar
    header_h = int(height * 0.08)
    draw.rectangle([0, 0, width, header_h], fill=(26, 28, 30))
    draw.line([0, header_h, width, header_h], fill=(40, 42, 44), width=2)

    # Accent shield in center
    cx, cy = width // 2, height // 2 - int(height * 0.05)
    sw = int(min(width, height) * 0.25)
    sh = int(sw * 1.2)
    
    pts = [
        (cx, cy - sh // 2),
        (cx + sw // 2, cy - sh // 3),
        (cx + sw // 2, cy + sh // 8),
        (cx, cy + sh // 2),
        (cx - sw // 2, cy + sh // 8),
        (cx - sw // 2, cy - sh // 3)
    ]
    draw.polygon(pts, fill=(30, 32, 34), outline=(90, 122, 153), width=max(2, width // 300))

    # Center label text
    draw.rectangle([cx - sw, cy + sh // 2 + 20, cx + sw, cy + sh // 2 + 80], fill=(26, 28, 30), outline=(63, 169, 138), width=2)

    img.save(os.path.join(ASSETS_DIR, filename), "PNG")
    print(f"Generated {filename}")

make_screenshot(390, 844, "DocuShield Mobile", "AI Border Document Screening", "screenshot-mobile.png")
make_screenshot(1920, 1080, "DocuShield Desktop", "Border Command Tactical Console", "screenshot-desktop.png")
print("Screenshots created!")
