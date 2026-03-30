/**
 * Jaini Service Worker — lightweight caching for offline support and faster loads.
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS, images) → cache-first with network update
 *   - API calls → network-first with cached fallback for recent verdicts
 *   - Everything else → network only
 */

const CACHE_NAME = "jaini-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/auth.js",
  "/favorites.js",
  "/monetization.js",
  "/barcode.js",
  "/config/shared-config.js",
  "/logo.png",
  "/favicon-32.png",
];

// Install: pre-cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first, cache verdict responses for offline
  if (url.pathname.startsWith("/v1/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful verdict responses
          if (response.ok && url.pathname.includes("/verdict")) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell & static assets: cache-first
  if (event.request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }
});
