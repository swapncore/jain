# Jaini Web App (`swapncore/jain`)

Progressive web app for Jain dietary verdict checks — scan or type a product
barcode, get a GREEN / YELLOW / ORANGE / RED / UNKNOWN verdict with per-ingredient
reasoning. Live at **https://jain.swapncore.com**.

## How this deploys (load-bearing — read first)

**GitHub Pages serves the raw files in this repo from `main`.** There is **no
build step in production**: `index.html` loads `app.js` and the `src/` modules
as native ES modules directly. Vite exists for local dev (`npm run dev`) and
vitest only — `vite.config.js` and `dist/` never affect production. **Pushing
to `main` IS a production deploy.**

Consequences:

- Every import must be a relative path (`./src/foo.js`) — no bare specifiers,
  no JSX/TS, nothing that needs a bundler.
- Third-party libs load from CDN at runtime (ZXing via jsdelivr) and must stay
  compatible with the CSP in `index.html`.
- `sw.js` caches the app shell **cache-first**. After any user-facing change,
  bump `CACHE_NAME`/`CACHE_API` (currently `jaini-v2`) or users keep running
  the previous deploy. A stale, partially-updated cache mixing old and new
  modules is this repo's known historical failure mode.

## File map

| Path | Role |
|---|---|
| `index.html` | Single-page app shell, CSP, inline early-theme script |
| `app.js` | Thin entry point: wiring, event listeners, shared `state` |
| `src/` | App modules: `api.js`, `scanner.js`, `verdict.js`, `history.js`, `profile.js`, `ui.js`, `community.js`, `missing.js`, `alternatives.js`, `sanitize.js`, `env.js`, `config.js` |
| `lib/` | `history.js` (server sync), `share.js` (share-card canvas) |
| `auth.js` | Firebase auth: Google sign-in + email magic links |
| `favorites.js` | Saved products (signed-in users) |
| `monetization.js` | Sponsored placements rendering |
| `barcode.js` | Barcode normalization (UPC-E expansion, checksums) |
| `config/shared-config.js` | **Generated — do not edit.** Produced by `compliance_core/shared/` + `sync.sh --religion jain`. API base, endpoints, profiles, verdict metadata, messages |
| `sw.js` | Service worker (cache versioning lives here) |
| `dashboard/` | Admin dashboard UI (auth: admin key against backend) |
| `tests/` | vitest unit tests (`npm test`) |
| Static pages | `privacy.html`, `terms.html`, `disclaimer.html`, `howitworks.html`, `modes.html` |

## Backend

Production API: `https://web-production-31034.up.railway.app` (FastAPI on
Railway, repo `swapncore/compliance_core`). Dev API: `http://localhost:8000`.
The value comes from `config/shared-config.js`; to change it, edit
`compliance_core/shared/api.json` and re-run `./sync.sh` there — do not edit
the generated file. (Known debt: `auth.js`, `dashboard/dashboard.js`, and the
CSP in `index.html` each hardcode the URL independently.)

## Local development

```bash
npm install
npm run dev     # Vite dev server (env vars from .env apply here ONLY)
npm test        # vitest — 61 unit tests
```

Simplest prod-faithful run (what GitHub Pages actually does):

```bash
python3 -m http.server 5173 --directory .
```

Note: in production there is no Vite, so `import.meta.env` is undefined and
`src/env.js` always uses its hardcoded fallback Firebase config (public
identifiers by design — not secrets).

## Production deploy (GitHub Pages)

1. Bump `CACHE_NAME` in `sw.js` if any user-facing file changed.
2. Push to `main` on `swapncore/jain` (public repo — never commit secrets).
3. GitHub Pages: Settings → Pages → Source: `main`, `/ (root)`.
4. `CNAME` must contain `jain.swapncore.com`; Cloudflare DNS points it at
   `swapncore.github.io` (DNS only), HTTPS enabled in Pages settings.

## Religion modularity status

This deployment is the **jain** build. The generated config carries religion
branding/profiles, but HTML copy, `manifest.json`, share-card text, and legend
strings still hardcode Jain — a non-jain deployment currently requires forking
those by hand. See the estate audit (2026-07-18) before attempting one.
