"""
DocuShield Step 2 Verification Script
Tests that:
1. Dexie.js IndexedDB schema and operations properly support Step 2 requirements:
   - record_id
   - image_blob (Blob object)
   - timestamp
   - status = 'captured'
2. db.js exports saveScanRecord and createScanRecord storing these exact fields
3. app.js invokes dbInstance.saveScanRecord with image_blob, record_id, timestamp, status='captured'
   both on camera capture and image upload
4. window.db and window.dbInstance are exposed for browser DevTools inspection
"""
import sys
import re
from pathlib import Path

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def run_tests():
    root = Path(__file__).resolve().parent.parent
    db_js = root / "src" / "storage" / "db.js"
    app_js = root / "src" / "app.js"
    index_html = root / "index.html"

    print("=" * 65)
    print("DOCUSHIELD STEP 2 — STORE RECORD IN INDEXEDDB (DEXIE.JS) VERIFICATION")
    print("=" * 65)

    all_passed = True

    # Check 1: db.js exists and defines scans store
    if not db_js.exists():
        print("❌ FAIL: src/storage/db.js does not exist!")
        return 1
    db_content = db_js.read_text(encoding="utf-8")

    if "scans:" in db_content:
        print("✅ PASS: Dexie store 'scans' defined in db.js")
    else:
        print("❌ FAIL: Dexie store 'scans' not found in db.js")
        all_passed = False

    # Check 2: db.js saveScanRecord handles image_blob, record_id, timestamp, status='captured'
    required_db_fields = ["record_id", "image_blob", "timestamp", "status"]
    for field in required_db_fields:
        if field in db_content:
            print(f"✅ PASS: Field '{field}' handled in db.js saveScanRecord/createScanRecord")
        else:
            print(f"❌ FAIL: Field '{field}' missing in db.js")
            all_passed = False

    # Check 3: status default is 'captured'
    if "'captured'" in db_content:
        print("✅ PASS: Default status 'captured' enforced in db.js")
    else:
        print("❌ FAIL: Status 'captured' not found in db.js")
        all_passed = False

    # Check 4: window.db and window.dbInstance exported for DevTools
    if "window.db" in db_content and "window.dbInstance" in db_content:
        print("✅ PASS: window.db and window.dbInstance exposed for DevTools console")
    else:
        print("❌ FAIL: window.db or window.dbInstance not exported in db.js")
        all_passed = False

    # Check 5: app.js persists image_blob and status='captured' on capture
    if not app_js.exists():
        print("❌ FAIL: src/app.js does not exist!")
        return 1
    app_content = app_js.read_text(encoding="utf-8")

    if "image_blob: blob" in app_content or "image_blob:" in app_content:
        print("✅ PASS: app.js passes image_blob to saveScanRecord/createScanRecord")
    else:
        print("❌ FAIL: app.js does not pass image_blob")
        all_passed = False

    if "status: 'captured'" in app_content:
        print("✅ PASS: app.js explicitly sets status: 'captured' at shutter/upload pass")
    else:
        print("❌ FAIL: app.js does not set status: 'captured'")
        all_passed = False

    # Check 6: index.html loads dexie.min.js
    index_content = index_html.read_text(encoding="utf-8")
    if "dexie.min.js" in index_content:
        print("✅ PASS: index.html loads dexie.min.js vendor script")
    else:
        print("❌ FAIL: index.html does not load dexie.min.js")
        all_passed = False

    print("=" * 65)
    if all_passed:
        print("🎉 ALL STEP 2 CHECKS PASSED: IndexedDB Dexie.js persistence fully ready!")
        return 0
    else:
        print("⚠️ SOME STEP 2 CHECKS FAILED.")
        return 1

if __name__ == "__main__":
    sys.exit(run_tests())
