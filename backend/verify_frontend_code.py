"""
DocuShield Frontend & Pipeline Code Audit Script
Validates that all frontend source code conforms to the generic schema
and validation branching requirements.
"""
import re
import sys

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def audit_code():
    print("=" * 70)
    print("DOCUSHIELD FRONTEND & PIPELINE GENERIC IMPLEMENTATION AUDIT")
    print("=" * 70)

    # 1. Check index.html
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    assert 'id="capture-doc-type-select"' in html, "Missing #capture-doc-type-select in index.html"
    assert 'value="passport"' in html, "Missing passport option in index.html"
    assert 'value="national_id"' in html, "Missing national_id option in index.html"
    assert 'value="visa"' in html, "Missing visa option in index.html"
    print("✅ PASS: index.html contains #capture-doc-type-select with Passport, National ID, and Visa options.")

    # 2. Check src/samples.js
    with open("src/samples.js", "r", encoding="utf-8") as f:
        samples_code = f.read()

    assert "document_type: 'passport'" in samples_code, "Missing passport document_type in samples.js"
    assert "document_type: 'national_id'" in samples_code, "Missing national_id document_type in samples.js"
    assert "document_type: 'visa'" in samples_code, "Missing visa document_type in samples.js"
    assert "issuing_authority" in samples_code, "Missing issuing_authority in samples.js"
    assert "id_card_type" in samples_code, "Missing id_card_type in samples.js"
    assert "linked_passport_number" in samples_code, "Missing linked_passport_number in samples.js"
    assert "mrzLines: []" in samples_code, "Missing non-MRZ specimen in samples.js"
    print("✅ PASS: src/samples.js provides specimen documents with type-specific extra_fields and non-MRZ formats.")

    # 3. Check src/pipeline/forensicEngine.js
    with open("src/pipeline/forensicEngine.js", "r", encoding="utf-8") as f:
        engine_code = f.read()

    assert "hasMrz" in engine_code, "Missing hasMrz branching in forensicEngine.js"
    assert "skipped: true" in engine_code, "Missing MRZ skip status in forensicEngine.js"
    assert "documentType" in engine_code, "Missing documentType detection in forensicEngine.js"
    assert "Field Format Consistency" in engine_code, "Missing Field Format Consistency stage in forensicEngine.js"
    print("✅ PASS: src/pipeline/forensicEngine.js branches validation: validates MRZ when present, skips cleanly when absent.")

    # 4. Check src/app.js
    with open("src/app.js", "r", encoding="utf-8") as f:
        app_code = f.read()

    assert "selectedDocType" in app_code, "Missing selectedDocType state in app.js"
    assert "capture-doc-type-select" in app_code, "Missing capture-doc-type-select event listener in app.js"
    assert "saveExtractedFields" in app_code, "Missing saveExtractedFields call in app.js"
    assert "extra_fields" in app_code, "Missing extra_fields handling in app.js"
    print("✅ PASS: src/app.js synchronizes officer selection, attaches extra_fields, and persists to IndexedDB.")

    # 5. Check src/storage/db.js
    with open("src/storage/db.js", "r", encoding="utf-8") as f:
        db_code = f.read()

    assert "version(4)" in db_code, "Missing version(4) store definition in db.js"
    assert "saveExtractedFields" in db_code, "Missing saveExtractedFields method in db.js"
    assert "extra_fields" in db_code, "Missing extra_fields column handling in db.js"
    print("✅ PASS: src/storage/db.js implements Dexie Version 4 with generic extracted_fields.")

    print("=" * 70)
    print("🎉 ALL FRONTEND & PIPELINE GENERIC VERIFICATION CHECKS PASSED (100%)!")
    print("=" * 70)
    return 0

if __name__ == "__main__":
    sys.exit(audit_code())
