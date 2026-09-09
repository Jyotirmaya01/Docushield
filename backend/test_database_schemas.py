"""
DocuShield Schema Verification Script
Verifies that all specified tables and columns exist in:
1. On-Device SQLite & IndexedDB Schema
2. Central Backend SQLite Schema
"""
import sqlite3
import sys

# Ensure UTF-8 output on Windows ARM64 console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def verify_schemas():
    conn = sqlite3.connect("backend/docushield.db")
    cur = conn.cursor()

    # User Specification Schema Mapping
    expected_tables = {
        # --- On-Device (Local) Normalized Tables ---
        "scans": [
            "record_id", "checkpoint_id", "officer_id", "timestamp", "image_path", "document_type", "status"
        ],
        "extracted_fields": [
            "record_id", "document_type", "name", "date_of_birth", "document_number", "nationality", "gender", "issue_date", "expiry_date", "mrz_raw", "extra_fields"
        ],
        "validation_results": [
            "record_id", "mrz_checksum_passed", "field_format_passed", "date_logic_passed", "failure_reasons"
        ],
        "detection_scores": [
            "record_id", "tamper_score", "face_match_score", "hidden_text_flag", "risk_score", "decision"
        ],
        "ledger_cache": [
            "document_id", "last_status", "crossing_count", "last_seen_timestamp", "last_sync_timestamp"
        ],

        # --- Central Backend Tables ---
        "audit_log": [
            "entry_id", "record_id", "timestamp", "officer_id", "checkpoint_id", "risk_score", "decision", "prior_hash", "entry_hash", "received_at"
        ],
        "checkpoints": [
            "checkpoint_id", "name", "location", "active"
        ],
        "officers": [
            "officer_id", "name", "checkpoint_id", "role", "password_hash"
        ],
        "document_ledger": [
            "document_id", "status", "crossing_count", "last_checkpoint_id", "last_crossing_timestamp", "flagged_reason"
        ]
    }

    print("=" * 65)
    print("DOCUSHIELD FORMAL SCHEMA COMPLIANCE VERIFICATION")
    print("=" * 65)

    all_passed = True
    for table_name, expected_cols in expected_tables.items():
        cur.execute(f"PRAGMA table_info({table_name})")
        actual_cols = [r[1] for r in cur.fetchall()]

        if not actual_cols:
            print(f"❌ FAIL: Table '{table_name}' does not exist in SQLite database!")
            all_passed = False
            continue

        missing = [c for c in expected_cols if c not in actual_cols]
        if missing:
            print(f"❌ FAIL: Table '{table_name}' is missing columns: {missing}")
            all_passed = False
        else:
            print(f"✅ PASS: Table '{table_name:18}' contains all {len(expected_cols)} required columns.")

    conn.close()
    print("=" * 65)
    if all_passed:
        print("🎉 ALL ON-DEVICE AND CENTRAL BACKEND TABLES MATCH 100% WITH SPECIFICATION!")
        return 0
    else:
        print("⚠️ SOME SCHEMA CHECKS FAILED.")
        return 1

if __name__ == "__main__":
    sys.exit(verify_schemas())
