const CACHE_NAME = 'docushield-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './install.html',
  './styles.css',
  './manifest.json',
  './src/config.js',
  './src/samples.js',
  './src/ledger/hashChain.js',
  './src/ledger/syncManager.js',
  './src/cv/qualityGate.js',
  './src/pipeline/mrzValidator.js',
  './src/pipeline/forensicEngine.js',
  './src/api/backendClient.js',
  './src/app.js',
  './assets/logo.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png'
];

// Install — cache all core assets for offline use
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch — offline-first strategy: serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached version immediately, but also update cache in background
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => {});

        return cachedResponse;
      }

      // Not in cache — try network
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline and not in cache — fallback
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
