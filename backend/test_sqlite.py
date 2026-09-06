"""
Verification script for DocuShield SQLite backend.
Tests CRUD operations, BLOB storage, JSON parsing, and dashboard stats.
"""
import sys
import os
import uuid

# Set UTF-8 encoding for Windows console
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(__file__))
from database import (
    init_database,
    insert_scan,
    insert_analysis,
    insert_decision,
    get_all_scans,
    get_scan_image,
    get_scan_detail,
    get_audit_log,
    get_dashboard_stats,
)

def run_tests():
    print("=== Testing DocuShield SQLite Backend ===")
    init_database()
    
    # 1. Test Scan Insertion
    scan_id = str(uuid.uuid4())
    dummy_image = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00" # Dummy JPEG header
    
    scan_payload = {
        "scan_id": scan_id,
        "traveler_name": "TEST TRAVELER",
        "nationality": "IND",
        "date_of_birth": "1990-05-15",
        "sex": "M",
        "document_number": "T99887766",
        "document_type": "PASSPORT",
        "expiry_date": "2030-05-14",
        "issue_date": "2020-05-15",
        "mrz_line_1": "P<INDTRAVELER<<TEST<<<<<<<<<<<<<<<<<<<<<<<<<",
        "mrz_line_2": "T998877660IND9005151M3005142<<<<<<<<<<<<<<04",
        "checkpoint_id": "CP-04-NORTH",
        "officer_id": "SSB-7489-N",
        "sync_status": "SYNCED",
    }
    
    scan_res = insert_scan(scan_payload, dummy_image)
    assert scan_res.get("scan_id") == scan_id, "Scan insertion failed!"
    print(f"[OK] Scan inserted: {scan_id}")
    
    # 2. Test Analysis Insertion
    analysis_payload = {
        "risk_score": 14,
        "confidence": 96,
        "quality_gate": {"blur_score": 185.4, "glare_pct": 2.1},
        "ocr_result": {"document_number": "T99887766"},
        "mrz_validation": {"is_valid": True, "checksum_errors": []},
        "anomalies": [{"module": "QUALITY", "description": "Minor lighting variance", "impact": 5}],
        "processing_time_ms": 320,
    }
    analysis_res = insert_analysis(scan_id, analysis_payload)
    assert analysis_res.get("scan_id") == scan_id, "Analysis insertion failed!"
    print(f"[OK] Analysis inserted for scan: {scan_id}")
    
    # 3. Test Decision Insertion
    decision_payload = {
        "decision": "AUTO_APPROVED",
        "officer_id": "SSB-7489-N",
        "officer_notes": "Test automated verification pass",
        "reasons": ["Auto-approved test"],
        "risk_score": 14,
        "ledger_block_index": 1,
        "ledger_hash": "abcdef1234567890",
    }
    decision_res = insert_decision(scan_id, decision_payload)
    assert decision_res.get("decision") == "AUTO_APPROVED", "Decision insertion failed!"
    print(f"[OK] Decision inserted: {decision_res.get('decision')}")
    
    # 4. Test Scan Detail Retrieval (with JSON parsing)
    detail = get_scan_detail(scan_id)
    assert detail is not None, "Scan detail retrieval returned None!"
    assert detail["traveler_name"] == "TEST TRAVELER", "Detail traveler name mismatch!"
    assert isinstance(detail["anomalies"], list), f"Expected anomalies to be list, got {type(detail['anomalies'])}"
    assert isinstance(detail["quality_gate"], dict), f"Expected quality_gate to be dict, got {type(detail['quality_gate'])}"
    print(f"[OK] Scan detail verified with auto-parsed JSON fields")
    
    # 5. Test Image Retrieval
    img_data, mime = get_scan_image(scan_id)
    assert img_data == dummy_image, "Retrieved image bytes do not match inserted bytes!"
    assert mime == "image/jpeg", f"Expected image/jpeg, got {mime}"
    print(f"[OK] Image retrieved successfully: {len(img_data)} bytes ({mime})")
    
    # 6. Test Dashboard Stats
    stats = get_dashboard_stats()
    assert stats["total_scans"] >= 1, "Total scans should be >= 1"
    assert "AUTO_APPROVED" in stats["decisions"], "Decisions breakdown should contain AUTO_APPROVED"
    print(f"[OK] Dashboard stats verified: {stats}")
    
    # 7. Test Audit Log
    audit = get_audit_log(limit=5)
    assert len(audit) >= 1, "Audit log should have entries"
    assert isinstance(audit[0]["details"], dict), "Audit log details should be auto-parsed dict"
    print(f"[OK] Audit log verified: {len(audit)} entries retrieved")
    
    print("\n>>> ALL SQLITE BACKEND TESTS PASSED! <<<")

if __name__ == "__main__":
    run_tests()
