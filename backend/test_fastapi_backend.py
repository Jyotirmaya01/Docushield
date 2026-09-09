"""
DocuShield FastAPI Backend Verification Test Suite
Tests all endpoints specified in the central sync and audit-aggregation layer prompt:
- Health check (GET /health)
- Authentication & Role-based tokens (POST /auth/login)
- Audit log sync with cryptographic hash-chain verification (POST /sync/audit-log)
- Role-based audit log access (GET /audit-log, GET /audit-log/all)
- Frequent-crosser ledger (GET /ledger/lookup, POST /ledger/update)
- Checkpoint management (GET /checkpoints, POST /checkpoints)
"""

import sys
import os
import json
import hashlib
import urllib.request
import urllib.error

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "http://127.0.0.1:8000"


def http_request(method, path, data=None, token=None):
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp_body = resp.read().decode("utf-8")
            return resp.status, json.loads(resp_body) if resp_body else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"detail": err_body}
        return e.code, parsed


def test_health():
    print("\n--- Test 1: Health Check (GET /health) ---")
    status, data = http_request("GET", "/health")
    assert status == 200, f"Expected 200, got {status}"
    assert data.get("status") == "ok", f"Expected status 'ok', got {data.get('status')}"
    print(f"PASS: /health returned 200 OK: {data.get('service')}")


def test_authentication():
    print("\n--- Test 2: Authentication & Role-Based Tokens (POST /auth/login) ---")
    # 1. Officer login
    status, data = http_request("POST", "/auth/login", {
        "officer_id": "SSB-7489-N",
        "password": "882194"
    })
    assert status == 200, f"Expected 200 for officer login, got {status}"
    assert data.get("role") == "officer", f"Expected role 'officer', got {data.get('role')}"
    assert data.get("token"), "Missing session token"
    assert data.get("checkpoint_id") == "CP-04-NORTH", f"Expected CP-04-NORTH, got {data.get('checkpoint_id')}"
    officer_token = data["token"]
    print(f"PASS: Officer authenticated: {data.get('full_name')} (Checkpoint: {data.get('checkpoint_id')})")

    # 2. Admin login
    status, data = http_request("POST", "/auth/login", {
        "admin_id": "ADMIN-01",
        "password": "admin"
    })
    assert status == 200, f"Expected 200 for admin login, got {status}"
    assert data.get("role") == "admin", f"Expected role 'admin', got {data.get('role')}"
    assert data.get("token"), "Missing admin token"
    admin_token = data["token"]
    print(f"PASS: Administrator authenticated: {data.get('full_name')} (Role: {data.get('role')})")

    # 3. Invalid credentials
    status, data = http_request("POST", "/auth/login", {
        "officer_id": "SSB-INVALID",
        "password": "wrongpassword"
    })
    assert status == 401, f"Expected 401 for invalid login, got {status}"
    print("PASS: Invalid credentials rejected with 401 Unauthorized")

    return officer_token, admin_token


def test_audit_sync_hash_verification(officer_token):
    print("\n--- Test 3: Audit Log Sync with Hash Verification (POST /sync/audit-log) ---")
    
    # 1. Valid batch incorporating prior_hash
    prior_hash = "0000000000000000000000000000000000000000000000000000000000000000"
    record_id = "REC-SYNC-TEST-001"
    timestamp = "2026-09-07T11:00:00Z"
    risk_score = 12
    decision = "AUTO_APPROVED"
    officer_id = "SSB-7489-N"
    checkpoint_id = "CP-04-NORTH"

    # Canonical string calculation incorporating prior_hash
    canon = f"{record_id}|{prior_hash}|{timestamp}|{risk_score}|{decision}|{officer_id}"
    valid_entry_hash = hashlib.sha256(canon.encode('utf-8')).hexdigest()

    valid_batch = [{
        "record_id": record_id,
        "checkpoint_id": checkpoint_id,
        "officer_id": officer_id,
        "timestamp": timestamp,
        "risk_score": risk_score,
        "decision": decision,
        "prior_hash": prior_hash,
        "entry_hash": valid_entry_hash,
        "traveler_name": "Test Traveler",
        "nationality": "IND",
        "pathway": "FAST_LANE"
    }]

    status, data = http_request("POST", "/sync/audit-log", valid_batch, token=officer_token)
    assert status == 200, f"Expected 200 for valid batch, got {status}: {data}"
    assert data.get("verified") is True, "Expected verified=True"
    assert data.get("processed_count") == 1, f"Expected 1 record processed, got {data.get('processed_count')}"
    print(f"PASS: Valid audit batch accepted & verified: {data.get('message')}")

    # 2. Tampered entry with invalid hash that does NOT incorporate prior_hash
    tampered_batch = [{
        "record_id": "REC-SYNC-TAMPER-002",
        "checkpoint_id": checkpoint_id,
        "officer_id": officer_id,
        "timestamp": timestamp,
        "risk_score": 90,
        "decision": "AUTO_APPROVED", # Tampered decision
        "prior_hash": prior_hash,
        "entry_hash": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" # Forged hash
    }]

    status, data = http_request("POST", "/sync/audit-log", tampered_batch, token=officer_token)
    assert status == 400, f"Expected 400 for tampered hash, got {status}: {data}"
    print(f"PASS: Tampered hash rejected with 400: {data.get('detail')}")

    # 3. Entry with centralized image attached (must be rejected)
    image_batch = [{
        "record_id": "REC-SYNC-IMG-003",
        "checkpoint_id": checkpoint_id,
        "officer_id": officer_id,
        "timestamp": timestamp,
        "risk_score": 10,
        "decision": "AUTO_APPROVED",
        "prior_hash": prior_hash,
        "entry_hash": valid_entry_hash,
        "document_image": "data:image/jpeg;base64,12345" # Image attached!
    }]
    status, data = http_request("POST", "/sync/audit-log", image_batch, token=officer_token)
    assert status == 400, f"Expected 400 for image upload attempt, got {status}"
    print("PASS: Centralized document image upload rejected (lightweight metadata-only rule enforced)")


def test_role_based_audit_access(officer_token, admin_token):
    print("\n--- Test 4: Role-Based Audit Log Access (GET /audit-log, GET /audit-log/all) ---")

    # 1. Officer querying own checkpoint -> 200 OK
    status, data = http_request("GET", "/audit-log?checkpoint_id=CP-04-NORTH", token=officer_token)
    assert status == 200, f"Expected 200 for officer own checkpoint, got {status}: {data}"
    print(f"PASS: Officer accessed own checkpoint data (Records: {data.get('count')})")

    # 2. Officer querying DIFFERENT checkpoint -> 403 Forbidden
    status, data = http_request("GET", "/audit-log?checkpoint_id=CP-02-RAXAUL", token=officer_token)
    assert status == 403, f"Expected 403 when officer accesses other checkpoint, got {status}"
    print("PASS: Officer forbidden from viewing other checkpoints (403 Forbidden)")

    # 3. Admin querying any checkpoint -> 200 OK
    status, data = http_request("GET", "/audit-log?checkpoint_id=CP-02-RAXAUL", token=admin_token)
    assert status == 200, f"Expected 200 for admin querying CP-02-RAXAUL, got {status}"
    print(f"PASS: Admin allowed to inspect any checkpoint: {data.get('checkpoint_id')}")

    # 4. Officer attempting to access GET /audit-log/all -> 403 Forbidden
    status, data = http_request("GET", "/audit-log/all", token=officer_token)
    assert status == 403, f"Expected 403 for officer on /audit-log/all, got {status}"
    print("PASS: Officer forbidden from global aggregate /audit-log/all (403 Forbidden)")

    # 5. Admin accessing GET /audit-log/all -> 200 OK
    status, data = http_request("GET", "/audit-log/all", token=admin_token)
    assert status == 200, f"Expected 200 for admin on /audit-log/all, got {status}"
    print(f"PASS: Admin retrieved central cross-checkpoint audit records (Total: {data.get('count')})")


def test_frequent_crosser_ledger(officer_token):
    print("\n--- Test 5: Frequent-Crosser Ledger (GET /ledger/lookup, POST /ledger/update) ---")

    # 1. Lookup known pre-seeded frequent crosser (Ramesh Thapa)
    status, data = http_request("GET", "/ledger/lookup?document_id=NP-FC-991204", token=officer_token)
    assert status == 200, f"Expected 200, got {status}"
    assert data.get("ledger_status") == "approved", f"Expected 'approved', got {data.get('ledger_status')}"
    assert data.get("crossing_count") >= 14, f"Expected crossing count >= 14, got {data.get('crossing_count')}"
    print(f"PASS: Fast-lane lookup for NP-FC-991204: status={data.get('ledger_status')}, crossings={data.get('crossing_count')}")

    # 2. Lookup known flagged traveler (Vikram Singh)
    status, data = http_request("GET", "/ledger/lookup?document_id=IND-FL-402911", token=officer_token)
    assert status == 200, f"Expected 200, got {status}"
    assert data.get("ledger_status") == "flagged", f"Expected 'flagged', got {data.get('ledger_status')}"
    print(f"PASS: Fast-lane lookup for IND-FL-402911 flagged traveler: status={data.get('ledger_status')}")

    # 3. Lookup unknown document
    import time
    test_doc = f"TEST-DOC-NEW-{int(time.time())}"
    status, data = http_request("GET", f"/ledger/lookup?document_id={test_doc}", token=officer_token)
    assert status == 200, f"Expected 200, got {status}"
    assert data.get("ledger_status") == "unknown", f"Expected 'unknown', got {data.get('ledger_status')}"
    assert data.get("crossing_count") == 0, f"Expected 0, got {data.get('crossing_count')}"
    print(f"PASS: Unknown traveler lookup returned status='unknown', crossings=0")

    # 4. Post ledger update after finalized decision
    status, data = http_request("POST", "/ledger/update", {
        "document_id": test_doc,
        "decision": "AUTO_APPROVED",
        "checkpoint_id": "CP-04-NORTH",
        "officer_id": "SSB-7489-N",
        "traveler_name": "New Verified Crosser",
        "nationality": "IND"
    }, token=officer_token)
    assert status == 200, f"Expected 200 for ledger update, got {status}: {data}"
    assert data.get("ledger", {}).get("crossing_count") == 1
    assert data.get("ledger", {}).get("status") == "approved"
    print(f"PASS: /ledger/update recorded clearance and incremented count to 1")

    # 5. Re-lookup to verify persistent increment
    status, data = http_request("GET", f"/ledger/lookup?document_id={test_doc}", token=officer_token)
    assert status == 200, f"Expected 200, got {status}"
    assert data.get("crossing_count") == 1
    assert data.get("ledger_status") == "approved"
    print(f"PASS: Re-lookup verified updated status='approved' and crossing_count=1")


def test_checkpoint_management(officer_token, admin_token):
    print("\n--- Test 6: Checkpoint Management (GET /checkpoints, POST /checkpoints) ---")

    # 1. Officer attempting to list checkpoints -> 403 Forbidden
    status, data = http_request("GET", "/checkpoints", token=officer_token)
    assert status == 403, f"Expected 403 for officer, got {status}"
    print("PASS: Officer forbidden from managing checkpoints (403 Forbidden)")

    # 2. Admin listing checkpoints -> 200 OK
    status, data = http_request("GET", "/checkpoints", token=admin_token)
    assert status == 200, f"Expected 200 for admin, got {status}"
    assert len(data.get("checkpoints", [])) >= 4, "Expected at least 4 default checkpoints"
    print(f"PASS: Admin retrieved {data.get('count')} registered checkpoints")

    # 3. Officer attempting to create checkpoint -> 403 Forbidden
    status, data = http_request("POST", "/checkpoints", {
        "checkpoint_id": "CP-NEW-99",
        "name": "Unauthorized Station"
    }, token=officer_token)
    assert status == 403, f"Expected 403 for officer on POST, got {status}"
    print("PASS: Officer forbidden from registering new checkpoints (403 Forbidden)")

    # 4. Admin registering new checkpoint -> 200 OK
    new_cp_id = "CP-09-MECHI"
    status, data = http_request("POST", "/checkpoints", {
        "checkpoint_id": new_cp_id,
        "name": "Mechi Bridge International Post",
        "sector": "SECTOR-09",
        "location": "Indo-Nepal Mechi River Transit",
        "status": "ACTIVE"
    }, token=admin_token)
    assert status == 200, f"Expected 200 for admin registration, got {status}: {data}"
    assert data.get("checkpoint", {}).get("checkpoint_id") == new_cp_id
    print(f"PASS: Admin successfully registered new checkpoint: {new_cp_id}")


if __name__ == "__main__":
    print("==========================================================")
    print("DOCUSHIELD FASTAPI CENTRAL SYNC & AGGREGATION TEST SUITE")
    print("==========================================================")
    test_health()
    off_tok, adm_tok = test_authentication()
    test_audit_sync_hash_verification(off_tok)
    test_role_based_audit_access(off_tok, adm_tok)
    test_frequent_crosser_ledger(off_tok)
    test_checkpoint_management(off_tok, adm_tok)
    print("\n🎉 ALL FASTAPI BACKEND VERIFICATION TESTS PASSED SUCCESSFULLY!")
