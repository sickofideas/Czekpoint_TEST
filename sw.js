// ============================================================
// CZEKPOINT v1.3 — Service Worker pro offline mapy a běh v lese bez signálu (sw.js)
// - Automaticky ukládá aplikační soubory (index.html, src/*.js, assets/**)
// - Ukládá mapové dlaždice (tile.openstreetmap.org, tile.opentopomap.org, tile.waymarkedtrails.org)
// - Poskytuje cache-first strategii s doživotním fallbackem pro dlaždice při výpadku signálu
// ============================================================

const APP_CACHE_NAME = 'czekpoint-app-shell-maplibre-test-1';
const TILE_CACHE_NAME = 'czekpoint-offline-tiles-v1.3';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/walk.css',
  './src/app.js',
  './src/walk.js',
  './src/maplibre-base.js',
  './assets/vendor/maplibre/maplibre-gl.js',
  './assets/vendor/maplibre/maplibre-gl.css',
  './assets/vendor/maplibre/leaflet-maplibre-gl.js',
  './src/walk-engine.js',
  './src/walk-store.js',
  './src/planner.js',
  './src/place-photos.js',
  './src/elevation.js',
  './src/postcards.js',
  './src/offline-maps.js',
  './src/keep-alive.js',
  './src/domain.js',
  './src/ui.js',
  './src/data.js',
];

function isMapTileRequest(urlStr) {
  return (
    urlStr.includes('tile.openstreetmap.org') ||
    urlStr.includes('tile.opentopomap.org') ||
    urlStr.includes('tile.waymarkedtrails.org')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== APP_CACHE_NAME && key !== TILE_CACHE_NAME) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // 1. Mapové dlaždice: Cache-First s ukládáním na pozadí a trvalým offline fallbackem
  if (isMapTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          return cached;
        }
        try {
          const networkRes = await fetch(req);
          if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
            cache.put(req, networkRes.clone()).catch(() => {});
          }
          return networkRes;
        } catch {
          // Offline fallback — prázdná průhledná SVG dlaždice, aby mapa nevyhazovala chyby
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#efe6d5"/><text x="128" y="128" text-anchor="middle" fill="#8b7355" font-family="sans-serif" font-size="11">Offline mapa</text></svg>',
            {
              status: 200,
              headers: { 'Content-Type': 'image/svg+xml' },
            }
          );
        }
      })
    );
    return;
  }

  // 2. Aplikační soubory stejného původu: Network-First s uložením do cache a offline fallbackem
  if (url.startsWith(self.location.origin)) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(APP_CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('', { status: 504 });
        })
    );
  }
});
