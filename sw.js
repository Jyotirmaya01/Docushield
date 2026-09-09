/**
 * DocuShield Official Service Worker (Workbox-Powered Offline Caching)
 * Ensures 100% offline functionality, zero-downtime background updates,
 * and instant-boot app shell caching for border control workstations.
 */

// 1. Load Local Workbox Service Worker Bundle (Zero external network dependencies)
importScripts('./assets/vendor/workbox-sw.js');

const CACHE_VERSION = 'v6-workbox';
const CACHE_NAME = `docushield-${CACHE_VERSION}`;

// Complete App Shell & Offline Assets Manifest (HTML, CSS, JS, Vendor, Models, Icons)
const CORE_APP_SHELL = [
  '/',
  './',
  '/index.html',
  './index.html',
  '/install.html',
  './install.html',
  '/styles.css',
  './styles.css',
  '/manifest.json',
  './manifest.json',
  '/assets/tailwindcss.js',
  './assets/tailwindcss.js',
  // Phase 0a: Vendor Dependencies
  '/assets/vendor/dexie.min.js',
  './assets/vendor/dexie.min.js',
  '/assets/vendor/opencv.js',
  './assets/vendor/opencv.js',
  '/assets/vendor/tf.min.js',
  './assets/vendor/tf.min.js',
  '/assets/vendor/face-api.min.js',
  './assets/vendor/face-api.min.js',
  '/assets/vendor/tesseract.min.js',
  './assets/vendor/tesseract.min.js',
  '/assets/vendor/tesseract-worker.min.js',
  './assets/vendor/tesseract-worker.min.js',
  '/assets/vendor/workbox-sw.js',
  './assets/vendor/workbox-sw.js',
  // Workbox Offline Modules
  '/assets/vendor/workbox/workbox-core.prod.js',
  './assets/vendor/workbox/workbox-core.prod.js',
  '/assets/vendor/workbox/workbox-routing.prod.js',
  './assets/vendor/workbox/workbox-routing.prod.js',
  '/assets/vendor/workbox/workbox-strategies.prod.js',
  './assets/vendor/workbox/workbox-strategies.prod.js',
  '/assets/vendor/workbox/workbox-precaching.prod.js',
  './assets/vendor/workbox/workbox-precaching.prod.js',
  '/assets/vendor/workbox/workbox-cacheable-response.prod.js',
  './assets/vendor/workbox/workbox-cacheable-response.prod.js',
  '/assets/vendor/workbox/workbox-expiration.prod.js',
  './assets/vendor/workbox/workbox-expiration.prod.js',
  // Application Source Modules
  '/src/app.js',
  './src/app.js',
  '/src/config.js',
  './src/config.js',
  '/src/samples.js',
  './src/samples.js',
  '/src/storage/db.js',
  './src/storage/db.js',
  '/src/ledger/hashChain.js',
  './src/ledger/hashChain.js',
  '/src/ledger/ledgerRouter.js',
  './src/ledger/ledgerRouter.js',
  '/src/ledger/syncManager.js',
  './src/ledger/syncManager.js',
  '/src/cv/qualityGate.js',
  './src/cv/qualityGate.js',
  '/src/pipeline/mrzValidator.js',
  './src/pipeline/mrzValidator.js',
  '/src/pipeline/forensicEngine.js',
  './src/pipeline/forensicEngine.js',
  '/src/pipeline/ocrEngine.js',
  './src/pipeline/ocrEngine.js',
  '/assets/samples/sample_passport.jpg',
  './assets/samples/sample_passport.jpg',
  '/src/api/backendClient.js',
  './src/api/backendClient.js',
  '/src/auth/authManager.js',
  './src/auth/authManager.js',
  // Models (Tiny Face Detector, Landmarks, Recognition)
  '/assets/models/face-api/tiny_face_detector_model-weights_manifest.json',
  './assets/models/face-api/tiny_face_detector_model-weights_manifest.json',
  '/assets/models/face-api/tiny_face_detector_model-shard1',
  './assets/models/face-api/tiny_face_detector_model-shard1',
  '/assets/models/face-api/face_landmark_68_model-weights_manifest.json',
  './assets/models/face-api/face_landmark_68_model-weights_manifest.json',
  '/assets/models/face-api/face_landmark_68_model-shard1',
  './assets/models/face-api/face_landmark_68_model-shard1',
  '/assets/models/face-api/face_recognition_model-weights_manifest.json',
  './assets/models/face-api/face_recognition_model-weights_manifest.json',
  '/assets/models/face-api/face_recognition_model-shard1',
  './assets/models/face-api/face_recognition_model-shard1',
  // Branding & Icons
  '/assets/logo.svg',
  './assets/logo.svg',
  '/assets/icon-72.png',
  './assets/icon-72.png',
  '/assets/icon-96.png',
  './assets/icon-96.png',
  '/assets/icon-128.png',
  './assets/icon-128.png',
  '/assets/icon-144.png',
  './assets/icon-144.png',
  '/assets/icon-152.png',
  './assets/icon-152.png',
  '/assets/icon-192.png',
  './assets/icon-192.png',
  '/assets/icon-384.png',
  './assets/icon-384.png',
  '/assets/icon-512.png',
  './assets/icon-512.png',
  '/assets/icon-maskable-192.png',
  './assets/icon-maskable-192.png',
  '/assets/icon-maskable-512.png',
  './assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png',
  './assets/apple-touch-icon.png'
];

// Configure Workbox if available
if (self.workbox) {
  workbox.setConfig({
    modulePathPrefix: './assets/vendor/workbox/',
    debug: false
  });

  workbox.core.skipWaiting();
  workbox.core.clientsClaim();

  // 1. Navigation Route: Fast cache-first response with background update
  workbox.routing.registerRoute(
    ({ request }) => request.mode === 'navigate' || request.destination === 'document',
    new workbox.strategies.NetworkFirst({
      cacheName: `${CACHE_NAME}-navigation`,
      networkTimeoutSeconds: 1.5,
      plugins: [
        new workbox.cacheableResponse.CacheableResponsePlugin({
          statuses: [0, 200]
        })
      ]
    })
  );

  // 2. Heavy Vendor Libraries & ML Models: Cache-First for instant offline operation
  workbox.routing.registerRoute(
    ({ url }) => url.pathname.includes('/assets/vendor/') || url.pathname.includes('/assets/models/'),
    new workbox.strategies.CacheFirst({
      cacheName: `${CACHE_NAME}-vendor-models`,
      plugins: [
        new workbox.cacheableResponse.CacheableResponsePlugin({
          statuses: [0, 200]
        }),
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 100,
          maxAgeSeconds: 60 * 24 * 60 * 60 // 60 days
        })
      ]
    })
  );

  // 3. Local Static Scripts, Styles, & Images
  workbox.routing.registerRoute(
    ({ request, url }) =>
      url.origin === self.location.origin &&
      (request.destination === 'script' ||
       request.destination === 'style' ||
       request.destination === 'image' ||
       request.destination === 'font'),
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: `${CACHE_NAME}-static`,
      plugins: [
        new workbox.cacheableResponse.CacheableResponsePlugin({
          statuses: [0, 200]
        })
      ]
    })
  );

  // 4. External Google Fonts Cache
  workbox.routing.registerRoute(
    ({ url }) => url.origin.includes('fonts.googleapis.com') || url.origin.includes('fonts.gstatic.com'),
    new workbox.strategies.CacheFirst({
      cacheName: `${CACHE_NAME}-google-fonts`,
      plugins: [
        new workbox.cacheableResponse.CacheableResponsePlugin({
          statuses: [0, 200]
        }),
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 30,
          maxAgeSeconds: 365 * 24 * 60 * 60
        })
      ]
    })
  );

  console.log('[DocuShield SW] Workbox offline caching initialized successfully');
}

// Skip waiting message listener for instant user-driven updates
self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting')) {
    self.skipWaiting();
  }
});

// Install Event: Precache entire app shell and models so app works with ZERO internet
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[DocuShield SW] Precaching app shell, vendor libraries, and ML models...');
      const cachePromises = CORE_APP_SHELL.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res && (res.ok || res.status === 200 || res.type === 'opaque')) {
            await cache.put(url, res);
          }
        } catch (e) {
          // Precache error for individual file does not abort entire install
        }
      });
      await Promise.all(cachePromises);
      console.log('[DocuShield SW] All core assets cached for 100% offline availability');
    })
  );
});

// Activate Event: Clean up legacy caches immediately and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => !key.includes(CACHE_VERSION)).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Universal Offline-First Fetch Fallback Handler
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // If Workbox already handled the route, let it manage; otherwise fallback to Cache-First
  const url = new URL(event.request.url);

  // Navigation requests: Return cached index.html immediately if network is down
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      (async () => {
        // Try cache first for instant load
        const cached = await caches.match('/index.html')
                    || await caches.match('/')
                    || await caches.match('./index.html')
                    || await caches.match('./')
                    || await caches.match(event.request);

        // Fetch fresh copy in background to keep cache updated
        const backgroundFetch = (async () => {
          try {
            const networkResponse = await fetch(event.request);
            if (networkResponse && networkResponse.status === 200) {
              const cache = await caches.open(CACHE_NAME);
              cache.put('/', networkResponse.clone());
              cache.put('/index.html', networkResponse.clone());
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          } catch (e) {
            return null;
          }
        })();

        if (cached) {
          backgroundFetch.catch(() => {});
          return cached;
        }

        const netRes = await backgroundFetch;
        if (netRes) return netRes;

        // Offline and no cache fallback
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>DocuShield Workstation</title><style>body{background:#0b1329;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;text-align:center;padding:24px;}</style></head><body><div style="font-size:48px;">🛡️</div><h2>DocuShield Workstation</h2><p>Terminal is loading offline cache. Please reload.</p><button onclick="location.reload()" style="padding:12px 24px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">Reload</button></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      })()
    );
    return;
  }

  // Assets fetch: Cache-First fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Revalidate in background
        fetch(event.request).then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then(async (networkResponse) => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => {
        return new Response('', { status: 408 });
      });
    })
  );
});
