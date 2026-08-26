/**
 * alternatives.js — Jain-friendly alternatives fetching and display.
 *
 * When a product is RED, ORANGE, or YELLOW, fetches Jain-friendly (GREEN)
 * alternative products and renders each as a link OUT to that exact product on
 * Amazon (a verified product page when available, otherwise a precise search
 * that lands on that specific product). Alternatives never re-scan inside the
 * app, and every rendered item has a working outbound link — items the backend
 * could not build a real Amazon link for are dropped, never shown as dead links.
 */

import { show, hide } from "./ui.js";
import { fetchWithTimeout, getApiBase, getClientId, REQUEST_TIMEOUT_MS, ENDPOINTS } from "./api.js";
import { getActiveProfile } from "./profile.js";
import { STATUS_META } from "./config.js";
import { sanitizeText } from "./sanitize.js";

const DISCLOSURE_TEXT =
  "Affiliate links. We may earn a commission, which never affects the verdict.";

// Tiny external-link glyph (opens on Amazon). Hardcoded path data only.
const EXTERNAL_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

/**
 * Fetch and render alternatives for the given barcode/status.
 *
 * Only fires on a rejected verdict (RED/ORANGE/YELLOW). Each alternative links
 * out to Amazon in a new tab; nothing is rendered on a GREEN/UNKNOWN verdict.
 *
 * @param {string} barcode
 * @param {string} status
 * @param {number} requestId - current request ID for stale-check
 * @param {Function} getRequestId - returns current state.requestId
 */
export async function fetchAndRenderAlternatives(barcode, status, requestId, getRequestId) {
  const section = document.getElementById("alternativesSection");
  const list = document.getElementById("alternativesList");
  const brandEl = document.getElementById("alternativesBrand");
  const disclosureEl = document.getElementById("alternativesDisclosure");

  if (status !== "RED" && status !== "ORANGE" && status !== "YELLOW") {
    hideAlternatives();
    return;
  }
  if (!section || !list) return;

  const profile = getActiveProfile();
  const url = new URL(`${getApiBase()}${ENDPOINTS.alternatives}`);
  url.searchParams.set("barcode", barcode);
  url.searchParams.set("profile", profile);

  try {
    const resp = await fetchWithTimeout(url.toString(), {
      headers: { "X-Client-Id": getClientId() }
    }, REQUEST_TIMEOUT_MS);
    if (!resp.ok) return;
    const data = await resp.json();

    // Only alternatives with a real, safe outbound Amazon link are shown. No
    // dead "#" hrefs, no in-app re-scan links.
    const alts = (data.alternatives || []).filter(
      a => typeof a.affiliate_url === "string" && a.affiliate_url.startsWith("https://")
    );
    if (!alts.length) return;

    if (requestId !== getRequestId()) return;

    list.replaceChildren();
    alts.forEach(a => {
      const safeStatus = ["green", "yellow", "orange", "red"].includes((a.status || "").toLowerCase()) ? a.status.toLowerCase() : "green";
      const label = STATUS_META[(a.status || "").toUpperCase()]?.label || a.status || "Jain-friendly";

      const li = document.createElement("li");
      li.className = "alternatives-item";

      // Anchor OUT to the exact product on Amazon — never an in-app re-scan.
      const link = document.createElement("a");
      link.className = "alt-link";
      link.href = a.affiliate_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
      link.setAttribute("aria-label", `Shop ${sanitizeText(a.product_name)} on Amazon (opens in a new tab)`);

      // Product thumbnail (or a neutral placeholder tile when we have no image
      // for this item, so every row is the same shape). A broken image URL
      // falls back to the placeholder rather than showing a torn-image glyph.
      const thumb = document.createElement("span");
      thumb.className = "alt-thumb";
      if (a.image_url && /^https:\/\//.test(a.image_url)) {
        const im = document.createElement("img");
        im.className = "alt-thumb-img";
        im.src = a.image_url;
        im.alt = "";
        im.loading = "lazy";
        im.referrerPolicy = "no-referrer";
        im.addEventListener("error", () => { thumb.classList.add("alt-thumb--empty"); im.remove(); });
        thumb.appendChild(im);
      } else {
        thumb.classList.add("alt-thumb--empty");
      }

      // Name on top; a meta line pairs the "Jain-friendly" label with the brand.
      // Both name and brand ellipsize so a long brand never shoves the CTA off.
      const body = document.createElement("span");
      body.className = "alt-body";

      const name = document.createElement("span");
      name.className = "alt-name";
      name.textContent = sanitizeText(a.product_name) || "View on Amazon";
      body.appendChild(name);

      const meta = document.createElement("span");
      meta.className = "alt-meta";
      const badge = document.createElement("span");
      badge.className = `alt-badge alt-badge--${safeStatus}`;
      badge.textContent = label;
      meta.appendChild(badge);
      if (a.brand) {
        const brandSpan = document.createElement("span");
        brandSpan.className = "alt-brand";
        brandSpan.textContent = sanitizeText(a.brand);
        meta.appendChild(brandSpan);
      }
      body.appendChild(meta);

      link.appendChild(thumb);
      link.appendChild(body);

      const cta = document.createElement("span");
      cta.className = "alt-cta";
      cta.innerHTML = EXTERNAL_ICON; // hardcoded glyph only
      const ctaText = document.createElement("span");
      ctaText.className = "alt-cta-text";
      ctaText.textContent = "Amazon";
      cta.appendChild(ctaText);
      link.appendChild(cta);

      li.appendChild(link);
      list.appendChild(li);
    });

    if (disclosureEl) disclosureEl.textContent = DISCLOSURE_TEXT;

    if (brandEl) {
      brandEl.textContent = (data.based_on === "brand" && alts[0]?.brand)
        ? `from ${sanitizeText(alts[0].brand)}`
        : "";
    }
    show(section);
  } catch { /* fire-and-forget: alternatives are non-critical */ }
}

export function hideAlternatives() {
  const section = document.getElementById("alternativesSection");
  const list = document.getElementById("alternativesList");
  const brandEl = document.getElementById("alternativesBrand");
  hide(section);
  if (list) list.replaceChildren();
  if (brandEl) brandEl.textContent = "";
}
