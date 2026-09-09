"""
Generate a crisp, high-resolution sample passport image for OCR testing.
Creates assets/samples/sample_passport.jpg with clear OCR-readable text.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def generate_sample_passport():
    os.makedirs("assets/samples", exist_ok=True)
    out_path = "assets/samples/sample_passport.jpg"

    width, height = 900, 600
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Document border
    draw.rectangle([(10, 10), (width - 10, height - 10)], outline=(30, 41, 59), width=3)

    # Header
    draw.rectangle([(10, 10), (width - 10, 75)], fill=(30, 58, 138))
    draw.text((35, 28), "PASSPORT / PASSEPORT — REPUBLIC OF INDIA", fill=(255, 255, 255))

    # Basic text fields
    y = 110
    draw.text((40, y), "TYPE: P       COUNTRY CODE: IND       PASSPORT NO: Z3918204", fill=(15, 23, 42))
    
    y += 45
    draw.text((40, y), "SURNAME / NOM:", fill=(71, 85, 105))
    draw.text((40, y + 20), "SHARMA", fill=(15, 23, 42))

    y += 55
    draw.text((40, y), "GIVEN NAMES / PRENOMS:", fill=(71, 85, 105))
    draw.text((40, y + 20), "RAHUL", fill=(15, 23, 42))

    y += 55
    draw.text((40, y), "NATIONALITY / NATIONALITE:", fill=(71, 85, 105))
    draw.text((40, y + 20), "INDIAN", fill=(15, 23, 42))

    draw.text((360, y), "DATE OF BIRTH:", fill=(71, 85, 105))
    draw.text((360, y + 20), "14 JUL 1992", fill=(15, 23, 42))

    draw.text((620, y), "SEX:", fill=(71, 85, 105))
    draw.text((620, y + 20), "M", fill=(15, 23, 42))

    y += 55
    draw.text((40, y), "DATE OF ISSUE:", fill=(71, 85, 105))
    draw.text((40, y + 20), "12 APR 2020", fill=(15, 23, 42))

    draw.text((360, y), "DATE OF EXPIRY:", fill=(71, 85, 105))
    draw.text((360, y + 20), "11 APR 2030", fill=(15, 23, 42))

    # MRZ Area
    mrz_y = 440
    draw.rectangle([(25, mrz_y), (width - 25, height - 30)], fill=(241, 245, 249), outline=(148, 163, 184), width=2)
    
    # MRZ Line 1 and 2
    draw.text((45, mrz_y + 25), "P<INDSHARMA<<RAHUL<<<<<<<<<<<<<<<<<<<<<<<<<<", fill=(0, 0, 0))
    draw.text((45, mrz_y + 65), "Z3918204<8IND9207145M3004113<<<<<<<<<<<<<<<8", fill=(0, 0, 0))

    img.save(out_path, quality=95)
    print(f"✅ Generated sample passport image at: {out_path} ({os.path.getsize(out_path)} bytes)")

if __name__ == "__main__":
    generate_sample_passport()
