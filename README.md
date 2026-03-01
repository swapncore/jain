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
- `NOT_FOUND` submit flow:
  - button to submit missing product
  - upload ingredient-label photo(s) or type ingredients manually
  - backend OCR + classification + save, with immediate verdict response
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

- `https://api.swapncore.com`

If you use a Cloudflare quick tunnel URL for testing, open Settings in the app and override API base URL.

## Manual test checklist

1. Lookup a known code (example `8901234567892`) and verify verdict card.
2. Lookup an unknown code (example `0999999999999`) and verify `NOT_FOUND`.
3. Tap `Submit missing product`.
4. Upload ingredient-label photo or paste manual ingredients.
5. Verify progress text and immediate verdict with `Saved for future scans`.
6. Lookup same barcode again and confirm it is now found.
