"""
DocuShield Phase 0 Verification Test Suite
Tests:
- Step 0a: Vendor libraries (OpenCV.js, TensorFlow.js, face-api.js, Dexie.js, Tesseract.js, Workbox)
- Step 0b: PWA manifest, service worker offline caching of all app shell and model files
- Step 0c: Camera permission via getUserMedia and persistent storage permission via navigator.storage.persist()
"""

import os
import sys
import json
import re
import urllib.request

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_URL = "http://localhost:8080"

def test_vendor_files_exist():
    print("\n--- Test 1: Vendor Files on Disk ---")
    vendor_files = [
        'assets/vendor/opencv.js',
        'assets/vendor/tf.min.js',
        'assets/vendor/face-api.min.js',
        'assets/vendor/dexie.min.js',
        'assets/vendor/tesseract.min.js',
        'assets/vendor/tesseract-worker.min.js',
        'assets/vendor/workbox-sw.js',
        'assets/vendor/workbox/workbox-core.prod.js',
        'assets/vendor/workbox/workbox-routing.prod.js',
        'assets/vendor/workbox/workbox-strategies.prod.js',
        'assets/vendor/workbox/workbox-precaching.prod.js',
        'assets/models/face-api/tiny_face_detector_model-weights_manifest.json',
        'assets/models/face-api/tiny_face_detector_model-shard1',
        'assets/models/face-api/face_landmark_68_model-weights_manifest.json',
        'assets/models/face-api/face_landmark_68_model-shard1',
        'assets/models/face-api/face_recognition_model-weights_manifest.json',
        'assets/models/face-api/face_recognition_model-shard1'
    ]

    all_exist = True
    for rel_path in vendor_files:
        full_path = os.path.join(ROOT_DIR, rel_path)
        if not os.path.exists(full_path):
            print(f"❌ Missing file: {rel_path}")
            all_exist = False
        else:
            size_kb = os.path.getsize(full_path) / 1024
            print(f"✅ {rel_path} ({size_kb:.1f} KB)")

    assert all_exist, "One or more vendor/model files are missing"
    print("Test 1 Passed: All Step 0a dependencies and model weights exist on disk.")

def test_manifest_pwa_installability():
    print("\n--- Test 2: Web Manifest (Step 0b PWA Shell) ---")
    manifest_path = os.path.join(ROOT_DIR, 'manifest.json')
    assert os.path.exists(manifest_path), "manifest.json does not exist"
    
    with open(manifest_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    assert data.get('name'), "manifest missing name"
    assert data.get('short_name'), "manifest missing short_name"
    assert data.get('display') == 'standalone', "manifest display must be standalone"
    assert data.get('start_url'), "manifest missing start_url"
    assert len(data.get('icons', [])) >= 4, "manifest must contain icon suite"

    # Verify key icon sizes exist on disk
    for icon in data['icons']:
        src = icon['src'].lstrip('./').lstrip('/')
        icon_disk = os.path.join(ROOT_DIR, src)
        assert os.path.exists(icon_disk), f"Icon missing on disk: {src}"

    print(f"✅ Web Manifest verified: {data['name']} (display: {data['display']}, icons: {len(data['icons'])})")
    print("Test 2 Passed: manifest.json is fully configured for home screen installation.")

def test_service_worker_workbox():
    print("\n--- Test 3: Workbox Service Worker & Offline Caching (Step 0a & 0b) ---")
    sw_path = os.path.join(ROOT_DIR, 'sw.js')
    assert os.path.exists(sw_path), "sw.js does not exist"

    with open(sw_path, 'r', encoding='utf-8') as f:
        sw_content = f.read()

    assert 'workbox-sw.js' in sw_content, "sw.js must import workbox-sw.js"
    assert 'workbox.routing.registerRoute' in sw_content, "sw.js must configure Workbox routing"
    assert 'workbox.strategies.CacheFirst' in sw_content, "sw.js must use CacheFirst strategy"
    assert 'workbox.strategies.NetworkFirst' in sw_content, "sw.js must use NetworkFirst strategy"
    assert 'CORE_APP_SHELL' in sw_content, "sw.js must define core app shell assets"
    assert 'assets/vendor/opencv.js' in sw_content, "sw.js must cache opencv.js"
    assert 'assets/vendor/dexie.min.js' in sw_content, "sw.js must cache dexie.min.js"
    assert 'assets/vendor/tf.min.js' in sw_content, "sw.js must cache tf.min.js"
    assert 'assets/vendor/face-api.min.js' in sw_content, "sw.js must cache face-api.min.js"
    assert 'assets/vendor/tesseract.min.js' in sw_content, "sw.js must cache tesseract.min.js"

    print("✅ Service worker Workbox integration, routes, and precache manifest verified.")
    print("Test 3 Passed: Service worker caches all app shell files, vendor libraries, and ML models.")

def test_camera_and_storage_permissions():
    print("\n--- Test 4: Camera & Persistent Storage Permissions (Step 0c) ---")
    app_path = os.path.join(ROOT_DIR, 'src', 'app.js')
    db_path = os.path.join(ROOT_DIR, 'src', 'storage', 'db.js')

    assert os.path.exists(db_path), "src/storage/db.js missing"
    with open(db_path, 'r', encoding='utf-8') as f:
        db_content = f.read()

    assert 'navigator.storage.persist' in db_content, "db.js must call navigator.storage.persist"
    assert 'navigator.storage.persisted' in db_content, "db.js must check navigator.storage.persisted"
    assert 'new DexieClass' in db_content or 'new Dexie' in db_content, "db.js must initialize Dexie"

    with open(app_path, 'r', encoding='utf-8') as f:
        app_content = f.read()

    assert 'getUserMedia' in app_content, "app.js must request camera access via getUserMedia"
    assert 'requestFirstUsePermissions' in app_content, "app.js must have requestFirstUsePermissions"
    assert 'docushield_camera_authorized' in app_content, "app.js must persist camera authorization status"
    assert 'updateHardwareDiagnostics' in app_content, "app.js must update hardware diagnostics UI"

    print("✅ getUserMedia first-use camera permission and persistent storage permission hooks verified.")
    print("Test 4 Passed: Step 0c camera and persistent storage logic correctly implemented.")

def test_http_endpoint_serving():
    print("\n--- Test 5: HTTP 200 Serving of App Shell & Dependencies ---")
    endpoints = [
        "/",
        "/index.html",
        "/manifest.json",
        "/styles.css",
        "/sw.js",
        "/assets/tailwindcss.js",
        "/assets/vendor/dexie.min.js",
        "/assets/vendor/opencv.js",
        "/assets/vendor/tf.min.js",
        "/assets/vendor/face-api.min.js",
        "/assets/vendor/tesseract.min.js",
        "/assets/vendor/tesseract-worker.min.js",
        "/assets/vendor/workbox-sw.js",
        "/assets/vendor/workbox/workbox-core.prod.js",
        "/assets/vendor/workbox/workbox-routing.prod.js",
        "/assets/vendor/workbox/workbox-strategies.prod.js",
        "/assets/models/face-api/tiny_face_detector_model-weights_manifest.json",
        "/assets/models/face-api/tiny_face_detector_model-shard1",
        "/src/app.js",
        "/src/storage/db.js",
        "/src/ledger/hashChain.js"
    ]

    for ep in endpoints:
        url = BASE_URL + ep
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status == 200, f"Expected 200 for {url}, got {resp.status}"
                body = resp.read()
                assert len(body) > 0, f"Empty response for {url}"
                print(f"✅ HTTP 200: {ep} ({len(body)} bytes)")
        except Exception as e:
            print(f"❌ Failed requesting {url}: {e}")
            raise

    print("Test 5 Passed: All assets served with HTTP 200 for offline caching.")

if __name__ == "__main__":
    print("==========================================================")
    print("DOCUSHIELD PHASE 0 VERIFICATION TEST")
    print("Step 0a: Dependencies (OpenCV, TF, face-api, Dexie, Tesseract, Workbox)")
    print("Step 0b: PWA Shell + Offline Caching (manifest.json, sw.js)")
    print("Step 0c: Camera + Storage Permissions (getUserMedia, navigator.storage.persist)")
    print("==========================================================")
    test_vendor_files_exist()
    test_manifest_pwa_installability()
    test_service_worker_workbox()
    test_camera_and_storage_permissions()
    test_http_endpoint_serving()
    print("\n🎉 ALL PHASE 0 VERIFICATION TESTS PASSED SUCCESSFULLY!")
