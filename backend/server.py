"""
DocuShield Backend — FastAPI Server
Provides REST API for document scanning, image storage, and decision logging.
All scan images are stored as JPEG in SQLite.

Usage:
    python server.py
    # Runs on http://localhost:8000
"""
import sys
import os
import uuid
import base64
import io
import json
from datetime import date, datetime

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

# Ensure backend directory is in path
sys.path.insert(0, os.path.dirname(__file__))
from config import DB_PATH, CORS_ORIGINS, JPEG_QUALITY, MAX_IMAGE_SIZE_MB
from database import (
    init_database,
    insert_scan,
    insert_analysis,
    insert_decision,
    get_all_scans,
    get_scan_image,
    get_scan_detail,
    insert_extracted_fields,
    get_extracted_fields,
    get_audit_log,
    get_dashboard_stats,
    verify_officer,
    verify_admin,
    get_all_officers,
    insert_officer,
    toggle_officer_status,
    reset_officer_password,
    delete_officer,
    update_officer,
    create_user_session,
    get_user_session,
    delete_user_session,
    get_all_checkpoints,
    create_checkpoint,
    lookup_central_ledger,
    update_central_ledger,
    verify_and_insert_audit_sync,
    get_checkpoint_audit_log,
    get_all_sync_audit_log,
    insert_validation_results,
    get_validation_results,
    validate_scan_record,
)


# ============================================================
# FastAPI App
# ============================================================
app = FastAPI(
    title="DocuShield API",
    description="AI-Based Fake Identity & Document Screening System — SIH PS 26188",
    version="1.0.0",
)

# CORS — allow frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Custom JSON encoder for dates
# ============================================================
class DateEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (date, datetime)):
            return obj.isoformat()
        return super().default(obj)


def serialize_response(data):
    """Serialize response data handling date objects."""
    return json.loads(json.dumps(data, cls=DateEncoder))


# ============================================================
# Startup: Initialize database
# ============================================================
@app.on_event("startup")
async def startup():
    try:
        init_database()
        print("[SERVER] SQLite Database initialized successfully")
    except Exception as e:
        print(f"[SERVER] WARNING: Database initialization failed: {e}")
        print("[SERVER] Server will start but database operations will fail.")


# ============================================================
# Auth Session Helper
# ============================================================

def get_current_session(request: Request, required: bool = True) -> dict | None:
    """
    Extracts session token from Authorization: Bearer <token>, X-Session-Token header, or query param.
    Enforces role-based checkpoint boundaries.
    """
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    token = None
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    elif request.headers.get("X-Session-Token"):
        token = request.headers.get("X-Session-Token").strip()
    elif request.query_params.get("token"):
        token = request.query_params.get("token").strip()

    if not token:
        if required:
            raise HTTPException(
                status_code=401,
                detail="Authentication credentials required (Bearer token or X-Session-Token header)"
            )
        return None

    session = get_user_session(token)
    if not session:
        if required:
            raise HTTPException(status_code=401, detail="Invalid or expired session token")
        return None
    return session


# ============================================================
# API Routes
# ============================================================

@app.get("/health")
@app.get("/api/health")
async def health_check():
    """
    Health check endpoint that the app pings to check connectivity
    before attempting sync, ensuring the app never blocks its own workflow.
    """
    return {
        "status": "ok",
        "service": "DocuShield Central Sync & Audit Aggregation Layer",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }


# ---- SCAN ENDPOINTS ----

@app.post("/api/scans")
async def create_scan(
    scan_data: str = Form(...),
    document_image: UploadFile | None = File(None),
):
    """
    Create a new document scan record.
    
    - scan_data: JSON string with traveler info, MRZ data, etc.
    - document_image: Optional uploaded JPEG image of the document
    
    The image is converted to JPEG format and stored in SQLite.
    """
    try:
        data = json.loads(scan_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in scan_data")

    # Generate scan ID if not provided
    if 'scan_id' not in data:
        data['scan_id'] = str(uuid.uuid4())

    # Process image: convert to JPEG and get bytes
    image_bytes = None
    if document_image:
        contents = await document_image.read()
        if len(contents) > MAX_IMAGE_SIZE_MB * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"Image too large. Max: {MAX_IMAGE_SIZE_MB} MB")

        try:
            # Open image with Pillow and convert to JPEG
            img = Image.open(io.BytesIO(contents))
            # Convert RGBA/P to RGB for JPEG compatibility
            if img.mode in ('RGBA', 'P', 'LA'):
                img = img.convert('RGB')
            
            # Save as JPEG to bytes buffer
            jpeg_buffer = io.BytesIO()
            img.save(jpeg_buffer, format='JPEG', quality=JPEG_QUALITY)
            image_bytes = jpeg_buffer.getvalue()
            print(f"[SCAN] Image converted to JPEG: {len(image_bytes)} bytes")
        except Exception as e:
            print(f"[SCAN] Image processing error: {e}")
            # Store raw bytes if Pillow fails
            image_bytes = contents

    # Handle base64 image from frontend canvas
    if not image_bytes and data.get('image_base64'):
        try:
            b64_data = data['image_base64']
            # Remove data URL prefix if present
            if ',' in b64_data:
                b64_data = b64_data.split(',')[1]
            raw_bytes = base64.b64decode(b64_data)
            
            # Convert to JPEG via Pillow
            img = Image.open(io.BytesIO(raw_bytes))
            if img.mode in ('RGBA', 'P', 'LA'):
                img = img.convert('RGB')
            jpeg_buffer = io.BytesIO()
            img.save(jpeg_buffer, format='JPEG', quality=JPEG_QUALITY)
            image_bytes = jpeg_buffer.getvalue()
            print(f"[SCAN] Base64 image converted to JPEG: {len(image_bytes)} bytes")
        except Exception as e:
            print(f"[SCAN] Base64 image processing error: {e}")

        # Remove base64 from data before storing (it's now in image_bytes)
        data.pop('image_base64', None)

    try:
        result = insert_scan(data, image_bytes)

        # If extracted fields are included in scan payload, persist them
        ef_result = None
        if 'extracted_fields' in data and isinstance(data['extracted_fields'], dict):
            ef_data = data['extracted_fields']
            ef_data['record_id'] = data['scan_id']
            if 'document_type' not in ef_data:
                ef_data['document_type'] = data.get('document_type', 'passport')
            try:
                ef_result = insert_extracted_fields(ef_data)
            except Exception as ef_err:
                print(f"[SCAN] Extracted fields persistence warning: {ef_err}")

        return JSONResponse(
            content=serialize_response({
                "status": "success",
                "message": "Document scan stored successfully",
                "scan": result,
                "extracted_fields": ef_result,
                "image_stored": image_bytes is not None,
                "image_size_bytes": len(image_bytes) if image_bytes else 0,
            }),
            status_code=201,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/scans")
async def list_scans(limit: int = 50, offset: int = 0):
    """Get all scanned documents (paginated, without image data)."""
    try:
        scans = get_all_scans(limit=limit, offset=offset)
        return serialize_response({"status": "success", "count": len(scans), "scans": scans})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/scans/{scan_id}")
async def get_scan(scan_id: str):
    """Get full details for a specific scan."""
    try:
        scan = get_scan_detail(scan_id)
        if not scan:
            raise HTTPException(status_code=404, detail="Scan not found")
        return serialize_response({"status": "success", "scan": scan})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/scans/{scan_id}/image")
async def get_image(scan_id: str):
    """
    Get the stored JPEG document image for a scan.
    Returns the raw JPEG binary with proper Content-Type header.
    """
    try:
        result = get_scan_image(scan_id)
        if not result:
            raise HTTPException(status_code=404, detail="Image not found for this scan")
        
        image_data, mime_type = result
        return Response(
            content=bytes(image_data),
            media_type=mime_type or "image/jpeg",
            headers={"Content-Disposition": f"inline; filename=scan_{scan_id}.jpg"}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ---- ANALYSIS ENDPOINTS ----

@app.post("/api/scans/{scan_id}/analysis")
async def create_analysis(scan_id: str, request: Request):
    """Store pipeline analysis results for a scan."""
    try:
        data = await request.json()
        result = insert_analysis(scan_id, data)
        return serialize_response({"status": "success", "analysis": result})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ---- STRUCTURED OCR EXTRACTED FIELDS ENDPOINTS (STEP 4) ----

@app.post("/api/scans/{scan_id}/extracted-fields")
async def create_extracted_fields(scan_id: str, request: Request):
    """
    Store or update structured OCR extracted fields for a scan record.
    Generic across passport, national_id, and visa.
    Columns: record_id, document_type, name, date_of_birth, document_number,
             nationality, gender, issue_date, expiry_date, mrz_raw, extra_fields
    """
    try:
        data = await request.json()
        data['record_id'] = scan_id
        result = insert_extracted_fields(data)
        return serialize_response({"status": "success", "extracted_fields": result})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/scans/{scan_id}/extracted-fields")
async def get_scan_extracted_fields(scan_id: str):
    """Get structured OCR extracted fields for a scan record."""
    try:
        fields = get_extracted_fields(scan_id)
        if not fields:
            raise HTTPException(status_code=404, detail="Extracted fields not found for this scan")
        return serialize_response({"status": "success", "extracted_fields": fields})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ---- STEP 5 VALIDATION ENDPOINTS (ICAO 9303 & DATE LOGIC) ----

@app.post("/api/scans/{scan_id}/validation-results")
async def create_validation_results(scan_id: str, request: Request):
    """
    Store or update ICAO 9303 checksum, field consistency, and date logic validation results.
    Never auto-denies. Sets status to 'validated' or 'validation_failed'.
    """
    try:
        data = await request.json()
        data['record_id'] = scan_id
        result = insert_validation_results(data)
        return serialize_response({"status": "success", "validation_results": result})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/scans/{scan_id}/validation-results")
async def get_scan_validation_results(scan_id: str):
    """Get validation results for a scan record."""
    try:
        results = get_validation_results(scan_id)
        if not results:
            raise HTTPException(status_code=404, detail="Validation results not found for this scan")
        return serialize_response({"status": "success", "validation_results": results})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.post("/api/scans/{scan_id}/validate")
async def validate_scan(scan_id: str, request: Request):
    """
    Step 5: Validates an 'ocr_done' (or any) scan record.
    Transitions status to 'validated' (if validation_passed) or 'validation_failed' (if failed).
    Stores validation_passed and failure_reasons.
    """
    try:
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass
        result = validate_scan_record(scan_id, body)
        return serialize_response({"status": "success", **result})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation error: {str(e)}")


# ---- DECISION ENDPOINTS ----

@app.post("/api/scans/{scan_id}/decision")
async def create_decision(scan_id: str, request: Request):
    """
    Record an officer's decision on a scanned document.
    Decisions: AUTO_APPROVED, ESCALATED_SECONDARY, OFFICER_OVERRIDE, DENIED
    """
    try:
        data = await request.json()
        if 'decision' not in data:
            raise HTTPException(status_code=400, detail="'decision' field is required")
        
        result = insert_decision(scan_id, data)
        return serialize_response({"status": "success", "decision": result})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ---- DASHBOARD & AUDIT ENDPOINTS ----

@app.get("/api/dashboard/stats")
async def dashboard_stats():
    """Get aggregate dashboard statistics."""
    try:
        stats = get_dashboard_stats()
        return serialize_response({"status": "success", "stats": stats})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/audit")
async def audit_log(limit: int = 100):
    """Get recent audit log entries."""
    try:
        logs = get_audit_log(limit=limit)
        return serialize_response({"status": "success", "count": len(logs), "logs": logs})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ---- AUTH & OFFICER MANAGEMENT ENDPOINTS ----

# ---- AUTHENTICATION ENDPOINTS ----

@app.post("/auth/login")
@app.post("/api/auth/login")
async def unified_login(request: Request):
    """
    POST /auth/login — accepts officer_id + password, returns role (officer or admin),
    assigned checkpoint_id, and an active session token.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed JSON in request body")

    user_id = str(body.get("officer_id") or body.get("admin_id") or body.get("username") or "").strip()
    password = str(body.get("password") or "").strip()

    if not user_id or not password:
        raise HTTPException(status_code=400, detail="officer_id (or admin_id) and password are required")

    # 1. Check if Sector Administrator
    admin = verify_admin(user_id, password)
    if admin:
        token = create_user_session(user_id, role="admin", checkpoint_id=None)
        return serialize_response({
            "success": True,
            "role": "admin",
            "token": token,
            "session_token": token,
            "user_id": user_id,
            "checkpoint_id": None,
            "full_name": admin.get("full_name"),
            "admin": admin
        })

    # 2. Check if Border Officer
    officer = verify_officer(user_id, password)
    if officer:
        if officer.get("status") == "SUSPENDED":
            raise HTTPException(status_code=403, detail="Officer account is suspended. Contact Sector Command.")
        cp_id = officer.get("checkpoint_id", "CP-04-NORTH")
        token = create_user_session(user_id, role="officer", checkpoint_id=cp_id)
        return serialize_response({
            "success": True,
            "role": "officer",
            "token": token,
            "session_token": token,
            "user_id": user_id,
            "checkpoint_id": cp_id,
            "full_name": officer.get("full_name"),
            "officer": officer
        })

    # 3. Invalid credentials
    return JSONResponse(
        status_code=401,
        content={"success": False, "error": "Invalid Officer ID or Password."}
    )


@app.post("/api/auth/admin-login")
async def admin_login(request: Request):
    """Dedicated endpoint for Sector Administrator login (backward compatibility)."""
    try:
        body = await request.json()
        admin_id = body.get("admin_id", "")
        password = body.get("password", "")
        admin = verify_admin(admin_id, password)
        if not admin:
            return JSONResponse(status_code=401, content={"success": False, "error": "Invalid Admin ID or Master Password."})
        token = create_user_session(admin_id, role="admin", checkpoint_id=None)
        return serialize_response({"success": True, "role": "admin", "token": token, "admin": admin})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---- AUDIT LOG SYNC ENDPOINTS ----

@app.post("/sync/audit-log")
@app.post("/api/sync/audit-log")
async def sync_audit_log_batch(request: Request):
    """
    POST /sync/audit-log — accepts a batch of audit entries from a checkpoint device:
    (record_id, checkpoint_id, officer_id, timestamp, risk_score, decision, prior_hash, entry_hash).
    
    Security & Lightweight Rules:
    1. Before accepting each entry, verify entry_hash correctly incorporates prior_hash.
       Rejects any entry that fails hash verification (tampered or corrupted local log).
    2. Do NOT accept or store document images centrally — only metadata and decision records,
       to keep sync lightweight and avoid unnecessary centralization of identity data.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed JSON in audit sync batch")

    entries = body.get("entries") if isinstance(body, dict) and "entries" in body else body
    if not isinstance(entries, list) or len(entries) == 0:
        raise HTTPException(status_code=400, detail="Payload must contain a non-empty list of audit entries")

    try:
        result = verify_and_insert_audit_sync(entries)
        return serialize_response(result)
    except ValueError as val_err:
        # Rejection due to hash tampering, image presence, or invalid fields
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audit sync error: {str(e)}")


@app.get("/audit-log")
@app.get("/api/audit-log")
async def get_checkpoint_audit_records(
    request: Request,
    checkpoint_id: str | None = None,
    limit: int = 100,
    offset: int = 0
):
    """
    GET /audit-log?checkpoint_id=X — returns records for one checkpoint.
    Role-based access:
    - Officers can ONLY access their own assigned checkpoint's data.
    - Admins can access all checkpoints.
    """
    session = get_current_session(request, required=True)
    user_role = session.get("role")
    user_cp = session.get("checkpoint_id")

    if user_role == "officer":
        if not user_cp:
            raise HTTPException(status_code=403, detail="Officer has no assigned checkpoint")
        if checkpoint_id and checkpoint_id.strip().upper() != user_cp.strip().upper():
            raise HTTPException(
                status_code=403,
                detail=f"Access denied: Officer assigned to {user_cp} cannot view checkpoint {checkpoint_id}"
            )
        target_cp = user_cp
    else:
        # Admin access
        target_cp = checkpoint_id or user_cp or "CP-04-NORTH"

    try:
        records = get_checkpoint_audit_log(target_cp, limit=limit, offset=offset)
        return serialize_response({
            "status": "success",
            "checkpoint_id": target_cp,
            "count": len(records),
            "records": records
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/audit-log/all")
@app.get("/api/audit-log/all")
async def get_all_checkpoints_audit_records(
    request: Request,
    limit: int = 200,
    offset: int = 0
):
    """
    GET /audit-log/all — returns all records across all checkpoints.
    Role-based access: Admin access only.
    Officers receive HTTP 403 Forbidden.
    """
    session = get_current_session(request, required=True)
    if session.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Admin access required to view cross-checkpoint audit records"
        )

    try:
        records = get_all_sync_audit_log(limit=limit, offset=offset)
        return serialize_response({
            "status": "success",
            "count": len(records),
            "records": records
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ---- FREQUENT-CROSSER LEDGER ENDPOINTS ----

@app.get("/ledger/lookup")
@app.get("/api/ledger/lookup")
async def ledger_lookup(document_id: str | None = None, docId: str | None = None):
    """
    GET /ledger/lookup?document_id=X — returns prior status (approved/flagged/unknown)
    and crossing count for a given document, used by the fast-lane feature.
    """
    doc_id = (document_id or docId or "").strip()
    if not doc_id:
        raise HTTPException(status_code=400, detail="document_id query parameter is required")

    try:
        result = lookup_central_ledger(doc_id)
        return serialize_response({
            "status": "success",
            "document_id": result["document_id"],
            "ledger_status": result["status"],
            "crossing_count": result["crossing_count"],
            "traveler_name": result.get("traveler_name"),
            "nationality": result.get("nationality"),
            "last_crossing": result.get("last_crossing"),
            "last_checkpoint_id": result.get("last_checkpoint_id")
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ledger lookup error: {str(e)}")


@app.post("/ledger/update")
@app.post("/api/ledger/update")
async def ledger_update(request: Request):
    """
    POST /ledger/update — called after every finalized decision to update the
    central ledger's status and increment crossing count for that document.
    """
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed JSON in ledger update")

    doc_id = data.get("document_id") or data.get("docId")
    if not doc_id:
        raise HTTPException(status_code=400, detail="document_id is required in body")

    try:
        updated = update_central_ledger(data)
        return serialize_response({
            "status": "success",
            "message": "Central ledger updated successfully",
            "ledger": updated
        })
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ledger update error: {str(e)}")


# ---- CHECKPOINT MANAGEMENT ENDPOINTS ----

@app.get("/checkpoints")
@app.get("/api/checkpoints")
async def list_checkpoints(request: Request):
    """
    GET /checkpoints — list all registered checkpoints (admin access).
    """
    session = get_current_session(request, required=True)
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin access required to view checkpoint list")

    try:
        checkpoints = get_all_checkpoints()
        return serialize_response({
            "status": "success",
            "count": len(checkpoints),
            "checkpoints": checkpoints
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.post("/checkpoints")
@app.post("/api/checkpoints")
async def register_new_checkpoint(request: Request):
    """
    POST /checkpoints — register a new checkpoint (admin access).
    """
    session = get_current_session(request, required=True)
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin access required to register checkpoints")

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed JSON in checkpoint creation")

    if not data.get("checkpoint_id") or not data.get("name"):
        raise HTTPException(status_code=400, detail="checkpoint_id and name are required")

    try:
        new_cp = create_checkpoint(data)
        return serialize_response({
            "status": "success",
            "message": "Checkpoint registered successfully",
            "checkpoint": new_cp
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/api/admin/officers")
async def list_officers():
    """Admin endpoint: Return all registered border officers."""
    try:
        officers = get_all_officers()
        return serialize_response({"status": "success", "count": len(officers), "officers": officers})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/officers")
async def provision_officer(request: Request):
    """Admin endpoint: Provision a new verified border officer."""
    try:
        body = await request.json()
        if not body.get("officer_id") or not body.get("full_name") or not body.get("password"):
            raise HTTPException(status_code=400, detail="Officer ID, Full Name, and Password are required.")
        new_officer = insert_officer(body)
        return serialize_response({"status": "success", "officer": new_officer})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/officers/{officer_id}/status")
async def change_officer_status(officer_id: str):
    """Admin endpoint: Toggle officer active/suspended status."""
    try:
        updated = toggle_officer_status(officer_id)
        if not updated:
            raise HTTPException(status_code=404, detail="Officer not found.")
        return serialize_response({"status": "success", "officer": updated})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/officers/{officer_id}/reset-pin")
async def admin_reset_pin(officer_id: str, request: Request):
    """Admin endpoint: Reset terminal PIN for an officer."""
    try:
        body = await request.json()
        new_pin = body.get("new_pin", "")
        if not new_pin or len(new_pin.strip()) < 4:
            raise HTTPException(status_code=400, detail="PIN must be at least 4 characters.")
        res = reset_officer_password(officer_id, new_pin.strip())
        return serialize_response({"status": "success", "result": res})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/admin/officers/{officer_id}")
async def admin_delete_officer(officer_id: str):
    """Admin endpoint: Decommission and remove an officer."""
    try:
        res = delete_officer(officer_id)
        return serialize_response({"status": "success", "result": res})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/admin/officers/{officer_id}")
async def admin_update_officer(officer_id: str, request: Request):
    """Admin endpoint: Update officer rank, checkpoint, or badge details."""
    try:
        body = await request.json()
        res = update_officer(officer_id, body)
        return serialize_response({"status": "success", "result": res})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Serve frontend static files (index.html, etc.)
# ============================================================
frontend_dir = os.path.join(os.path.dirname(__file__), "..")
if os.path.isdir(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


# ============================================================
# Run server
# ============================================================
if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("  DocuShield API Server")
    print("  AI-Based Fake Identity & Document Screening System")
    print("=" * 60)
    print(f"  Database: SQLite ({os.path.abspath(DB_PATH)})")
    print(f"  Server:   http://localhost:8000")
    print(f"  API Docs: http://localhost:8000/docs")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
