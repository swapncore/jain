# JainScan Frontend (`swapncore/jain`)

Static barcode scanner web app for Jain dietary verdict checks.

## Features

- Camera scanning (UPC-A, EAN-13) via `@zxing/browser` CDN ESM
- Manual barcode entry fallback
- Verdict card with status color, reason chips, explanation, confidence
- Ingredient category rows on every verdict:
  - `RED`, `ORANGE`, `YELLOW`, `GREEN`
- Error handling for `NOT_FOUND` (404) and `RATE_LIMIT` (429)
- Settings modal for API base URL override (stored in localStorage)
- Persistent `X-Client-Id` UUID in localStorage
- Automatic API fallback if a saved override URL is stale/unreachable
- Works on HTTPS for iPhone Safari / Android Chrome camera access

## File layout

- `index.html`
- `style.css`
- `app.js`
- `CNAME`

## Local run

```bash
cd jain
python3 -m http.server 5173
```

Open `http://localhost:5173`.

Default API base in local dev is `http://localhost:8000`.

## Production deploy (GitHub Pages)

1. Push to `swapncore/jain` (public repo).
2. In GitHub: Settings -> Pages.
3. Source: `main` branch, `/ (root)`.
4. Ensure `CNAME` contains:

```txt
jain.swapncore.com
```

5. In Cloudflare DNS, ensure `jain.swapncore.com` points to `swapncore.github.io` (DNS only).
6. In GitHub Pages settings, verify HTTPS is enabled.

## Backend integration

Default production API base is:

- `https://api.jain.swapncore.com`

If you use a Cloudflare quick tunnel URL for testing, open Settings in the app and override API base URL.
