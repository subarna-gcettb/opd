const CACHE_NAME = 'hms-shell-v1';
const SHELL_ASSETS = ['/css/style.css', '/css/print.css', '/js/main.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Cache-first for static shell assets only; everything else (all HTML
// pages, which are dynamic/authenticated) goes straight to the network.
// This deliberately does NOT cache patient data or any page behind auth.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellAsset = SHELL_ASSETS.some((path) => url.pathname === path);
  if (!isShellAsset || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
      );
    })
  );
});
