# JainScan Frontend (`swapncore/jain`)

Static barcode scanner web app for Jain dietary verdict checks.

## Features

- Camera scanning (UPC-A, EAN-13) via `@zxing/browser` CDN ESM
- Auto camera flow on page open:
  - prompts camera permission (if needed)
  - opens scanner immediately
  - stops camera after first detected barcode result
  - shows bottom `NEW SCAN` button to start next scan
- Manual barcode entry fallback
- Verdict card with status color, reason chips, explanation, confidence
- Ingredient category rows on every verdict:
  - `RED`, `ORANGE`, `YELLOW`, `GREEN`
- Error handling for `NOT_FOUND` (404) and `RATE_LIMIT` (429)
- Persistent `X-Client-Id` UUID in localStorage
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

- `https://api.swapncore.com`

## Manual test checklist

1. Lookup a known code (example `8901234567892`) and verify verdict card.
2. Lookup an unknown code (example `0999999999999`) and verify `NOT_FOUND`.
