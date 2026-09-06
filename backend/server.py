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
    get_audit_log,
    get_dashboard_stats,
    verify_officer,
    verify_admin,
    get_all_officers,
    insert_officer,
    toggle_officer_status,
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
# API Routes
# ============================================================

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "DocuShield API", "version": "1.0.0"}


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
        return JSONResponse(
            content=serialize_response({
                "status": "success",
                "message": "Document scan stored successfully",
                "scan": result,
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

@app.post("/api/auth/login")
async def officer_login(request: Request):
    """Verify border officer credentials."""
    try:
        body = await request.json()
        officer_id = body.get("officer_id", "")
        password = body.get("password", "")
        officer = verify_officer(officer_id, password)
        if not officer:
            return JSONResponse(status_code=401, content={"success": False, "error": "Invalid Officer ID or Password."})
        if officer.get("status") != "ACTIVE":
            return JSONResponse(status_code=403, content={"success": False, "error": "Account is suspended. Contact Sector Admin."})
        return serialize_response({"success": True, "officer": officer})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/auth/admin-login")
async def admin_login(request: Request):
    """Verify administrator credentials."""
    try:
        body = await request.json()
        admin_id = body.get("admin_id", "")
        password = body.get("password", "")
        admin = verify_admin(admin_id, password)
        if not admin:
            return JSONResponse(status_code=401, content={"success": False, "error": "Invalid Admin ID or Master Password."})
        return serialize_response({"success": True, "admin": admin})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
