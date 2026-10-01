/* Chhayabithi HMS PWA service worker.
 * Only static same-origin assets are cached. HTML, API responses,
 * authenticated pages and live data always stay on the network.
 */
const CACHE_NAME = 'chhayabithi-hms-v12';

const PRECACHE_ASSETS = [
  '/css/style.css',
  '/css/public-bootstrap-fallback.css',
  '/css/landing-v2.css',
  '/css/public-pages-desktop.css',
  '/css/public-pages-final.css',
  '/css/pwa-install.css',
  '/css/print.css',
  '/js/main.js',
  '/js/pwa-install.js',
  '/images/chhayabithi-logo.webp',
  '/images/pwa-icon-192.svg',
  '/images/pwa-icon-512.svg'
];

const STATIC_DESTINATIONS = new Set(['style', 'script', 'image', 'font']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Do not fail the whole install because one optional asset is unavailable.
    await Promise.all(
      PRECACHE_ASSETS.map(async (asset) => {
        try {
          const response = await fetch(asset, { cache: 'no-cache' });
          if (response.ok) {
            await cache.put(asset, response);
          }
        } catch (_) {
          // The fetch can fail during a temporary deployment/network issue.
        }
      })
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never intercept cross-origin requests, HTML navigations, JSON/API/live data,
  // or other dynamic server responses.
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') return;
  if (event.request.headers.get('accept')?.includes('text/html')) return;
  if (url.pathname === '/live-opd.json') return;

  // Static assets use network-first. This prevents old CSS/JS/logo files from
  // surviving a deployment indefinitely while still allowing offline fallback.
  if (!STATIC_DESTINATIONS.has(event.request.destination)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);

      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }

      return response;
    } catch (_) {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      return new Response('', {
        status: 504,
        statusText: 'Offline and asset unavailable'
      });
    }
  })());
});
