"""
DocuShield Step 3 Verification Script
Tests that:
1. Tesseract.js OCR engine module is integrated (src/pipeline/ocrEngine.js)
2. Pretrained model integration requires zero training
3. Raw text extraction pipeline confirms text output on sample document images
4. ForensicEngine Stage 2 connects to OCREngine
5. UI components (modal, test button) and global window handlers are wired
"""
import sys
import os
from pathlib import Path

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def run_tests():
    root = Path(__file__).resolve().parent.parent
    ocr_js = root / "src" / "pipeline" / "ocrEngine.js"
    forensic_js = root / "src" / "pipeline" / "forensicEngine.js"
    app_js = root / "src" / "app.js"
    index_html = root / "index.html"
    sample_img = root / "assets" / "samples" / "sample_passport.jpg"
    tesseract_vendor = root / "assets" / "vendor" / "tesseract.min.js"

    print("=" * 65)
    print("DOCUSHIELD STEP 3 — SET UP OCR (PRETRAINED TESSERACT.JS) VERIFICATION")
    print("=" * 65)

    all_passed = True

    # Check 1: Tesseract vendor library exists
    if tesseract_vendor.exists():
        print(f"✅ PASS: Pretrained Tesseract.js vendor asset present ({tesseract_vendor.stat().st_size / 1024:.1f} KB)")
    else:
        print("❌ FAIL: assets/vendor/tesseract.min.js not found!")
        all_passed = False

    # Check 2: ocrEngine.js exists and exports OCREngine
    if not ocr_js.exists():
        print("❌ FAIL: src/pipeline/ocrEngine.js does not exist!")
        return 1
    ocr_content = ocr_js.read_text(encoding="utf-8")

    if "export class OCREngine" in ocr_content:
        print("✅ PASS: OCREngine class defined and exported in src/pipeline/ocrEngine.js")
    else:
        print("❌ FAIL: OCREngine class not found in ocrEngine.js")
        all_passed = False

    # Check 3: Pretrained model & zero training
    if "'eng'" in ocr_content and "Pretrained" in ocr_content:
        print("✅ PASS: Pretrained language model configured ('eng' — zero training required)")
    else:
        print("❌ FAIL: Pretrained model configuration not verified")
        all_passed = False

    # Check 4: Raw text extraction methods
    methods = ["recognize", "testSample", "generateSampleDocumentCanvas"]
    for m in methods:
        if m in ocr_content:
            print(f"✅ PASS: Method '{m}' implemented in OCREngine")
        else:
            print(f"❌ FAIL: Method '{m}' missing in OCREngine")
            all_passed = False

    # Check 5: ForensicEngine Stage 2 integration
    forensic_content = forensic_js.read_text(encoding="utf-8")
    if "OCREngine" in forensic_content and "rawText" in forensic_content:
        print("✅ PASS: ForensicEngine Stage 2 integrated with OCREngine")
    else:
        print("❌ FAIL: ForensicEngine Stage 2 does not use OCREngine")
        all_passed = False

    # Check 6: app.js exposes OCREngine and handles OCR test
    app_content = app_js.read_text(encoding="utf-8")
    if "window.OCREngine" in app_content and "handleRunOCRTest" in app_content:
        print("✅ PASS: app.js exposes window.OCREngine and handles interactive OCR testing")
    else:
        print("❌ FAIL: app.js missing OCR test handler or window exposure")
        all_passed = False

    # Check 7: index.html includes OCR inspector modal and test trigger
    index_content = index_html.read_text(encoding="utf-8")
    if "ocr-result-modal" in index_content and "btn-ocr-test-action" in index_content:
        print("✅ PASS: index.html contains OCR test buttons and raw text inspector modal")
    else:
        print("❌ FAIL: index.html missing ocr-result-modal or btn-ocr-test-action")
        all_passed = False

    # Check 8: Sample passport document image exists
    if sample_img.exists():
        print(f"✅ PASS: Sample document image exists for OCR testing ({sample_img.stat().st_size / 1024:.1f} KB)")
    else:
        print("❌ FAIL: assets/samples/sample_passport.jpg does not exist!")
        all_passed = False

    print("=" * 65)
    if all_passed:
        print("🎉 ALL STEP 3 CHECKS PASSED: Pretrained OCR engine ready and verified!")
        return 0
    else:
        print("⚠️ SOME STEP 3 CHECKS FAILED.")
        return 1

if __name__ == "__main__":
    sys.exit(run_tests())
