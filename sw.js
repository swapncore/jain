/**
 * Jaini Service Worker — lightweight caching for offline support and faster loads.
 *
 * Strategy:
 *   - App shell (HTML, CSS, JS, images) → cache-first with network update
 *   - API calls (/v1/verdict) → network-first with cached fallback
 *   - Everything else → network only
 *
 * Cache versioning: bump CACHE_NAME to force full purge of stale assets.
 */

const CACHE_NAME = "jaini-v4";
const CACHE_API = "jaini-api-v2";
const MAX_API_ENTRIES = 100;

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
  "/src/config.js",
  "/src/api.js",
  "/src/ui.js",
  "/src/scanner.js",
  "/src/verdict.js",
  "/src/history.js",
  "/src/alternatives.js",
  "/src/community.js",
  "/src/missing.js",
  "/src/profile.js",
  "/src/sanitize.js",
  "/src/env.js",
  "/lib/history.js",
  "/lib/share.js",
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

// Activate: clean old caches (keep current app-shell and API caches)
self.addEventListener("activate", (event) => {
  const keep = new Set([CACHE_NAME, CACHE_API]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first, cache verdict responses for offline.
  // Cached entries are evicted LRU-style once MAX_API_ENTRIES is exceeded.
  if (url.pathname.startsWith("/v1/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful verdict responses in the dedicated API cache
          if (response.ok && url.pathname.includes("/verdict")) {
            const clone = response.clone();
            caches.open(CACHE_API).then((cache) => {
              cache.put(event.request, clone);
              // Evict oldest entries when over limit
              cache.keys().then((keys) => {
                if (keys.length > MAX_API_ENTRIES) {
                  keys.slice(0, keys.length - MAX_API_ENTRIES).forEach((k) => cache.delete(k));
                }
              });
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell & static assets: cache-first with background network update.
  // ignoreSearch lets versioned requests (e.g. app.js?v=4) match pre-cached /app.js.
  if (event.request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
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
