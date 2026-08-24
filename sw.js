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

// Bumped for the app-shell changes (new modules + markup). CACHE_API is
// deliberately NOT bumped: a wholesale purge would throw away every user's
// offline verdict history at once. Staleness is handled per-entry by the TTL
// below instead, which is both safer and more precise.
// v7: UNKNOWN is now a first-class rendered verdict (new src/confidence.js
// module, new markup in index.html, new styles). Every one of those is a cached
// app-shell asset, so returning users must be forced off v6 or they get the old
// JS against the new markup.
// v8: Article 9 consent gate. New modules (src/consent.js, src/consentBanner.js),
// changed app.js/auth.js/verdict.js, new index.html markup and consent CSS. auth.js
// now loads Firebase via dynamic import, so a stale v7 auth.js (static gstatic
// import at first paint) MUST be purged — returning users have to move off v7.
const CACHE_NAME = "jaini-v8";
const CACHE_API = "jaini-api-v2";
const MAX_API_ENTRIES = 100;

// A verdict can be corrected by moderation at any time, and this is a dietary
// tool — serving a day-old cached verdict as if it were current is a
// correctness bug, not a performance win. Entries older than this (and entries
// with no recorded age, i.e. written by an earlier version of this worker) are
// dropped rather than served.
const API_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = "X-Jaini-Cached-At";

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
  "/src/consent.js",
  "/src/consentBanner.js",
  "/src/confidence.js",
  "/src/privacy.js",
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
  "/src/report.js",
  "/src/account.js",
  "/src/submission.js",
  "/src/freescan.js",
  "/lib/history.js",
  "/lib/share.js",
  "/logo-transparent.png",
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

// Store a verdict response stamped with the time it was cached. Response
// headers from the network are immutable, so a fresh Response is rebuilt.
async function putStampedApiResponse(request, response) {
  const cache = await caches.open(CACHE_API);
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  await cache.put(request, new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
  // Evict oldest entries when over limit
  const keys = await cache.keys();
  if (keys.length > MAX_API_ENTRIES) {
    await Promise.all(
      keys.slice(0, keys.length - MAX_API_ENTRIES).map((k) => cache.delete(k))
    );
  }
}

// Only serve a cached verdict that is provably fresh. Anything older than
// API_MAX_AGE_MS — or with no age recorded at all — is deleted and reported as
// a network failure, which the app already surfaces as "couldn't reach the
// server" rather than as a verdict.
async function matchFreshApiResponse(request) {
  const cache = await caches.open(CACHE_API);
  const cached = await cache.match(request);
  if (!cached) return null;
  const ts = Number(cached.headers.get(CACHED_AT_HEADER) || 0);
  if (!ts || (Date.now() - ts) > API_MAX_AGE_MS) {
    // Undated entries were written by an earlier worker: their age is unknown,
    // and "unknown age" is not good enough for a dietary verdict.
    try { await cache.delete(request); } catch { /* best effort */ }
    return null;
  }
  return cached;
}

// Fetch: cache-first for app shell, network-first for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first, cache verdict responses for offline.
  // Cached entries are evicted LRU-style once MAX_API_ENTRIES is exceeded, and
  // expire after API_MAX_AGE_MS.
  if (url.pathname.startsWith("/v1/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful verdict responses in the dedicated API cache
          if (response.ok && url.pathname.includes("/verdict")) {
            const clone = response.clone();
            putStampedApiResponse(event.request, clone).catch(() => {});
          }
          return response;
        })
        .catch(async () => (await matchFreshApiResponse(event.request)) || Response.error())
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
