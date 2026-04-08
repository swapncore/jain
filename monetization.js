/**
 * monetization.js — Sponsored/affiliate product cards for Jaini web app.
 *
 * Fetches placements from /v1/placements, renders cards in the result view,
 * and logs impression/click events for analytics.
 */

import { authFetch } from "./auth.js";

let _apiBase = "";
let _getClientId = () => "";

// DOM refs
let _section = null;
let _title = null;
let _disclosure = null;
let _cardsEl = null;

// Track impressions already fired this session to avoid duplicates
const _impressionsSent = new Set();
const _IMPRESSIONS_MAX = 500;

export function init({ apiBase, getClientId }) {
  _apiBase = apiBase;
  _getClientId = getClientId;

  _section = document.getElementById("monetizationSection");
  _title = document.getElementById("monetizationTitle");
  _disclosure = document.getElementById("monetizationDisclosure");
  _cardsEl = document.getElementById("monetizationCards");
}

/**
 * Show monetization cards relevant to the current verdict.
 * @param {string} barcode - current product barcode
 * @param {string} status - verdict status (GREEN, YELLOW, ORANGE, RED, UNKNOWN)
 */
export async function showForVerdict(barcode, status) {
  if (!_section || !_cardsEl) return;
  hide();

  try {
    const url = new URL(`${_apiBase}/v1/placements`);
    url.searchParams.set("status", status);
    if (barcode) url.searchParams.set("barcode", barcode);

    const resp = await authFetch(url.toString(), {
      headers: { "X-Client-Id": _getClientId() },
    });
    if (!resp.ok) return;

    const data = await resp.json();
    const placements = data.placements || data || [];
    if (!placements.length) return;

    renderCards(placements, barcode);
    _section.classList.remove("hidden");

    // Log impressions
    placements.forEach((p) => {
      const key = `${p.id}-${barcode}`;
      if (!_impressionsSent.has(key)) {
        _impressionsSent.add(key);
        if (_impressionsSent.size > _IMPRESSIONS_MAX) {
          _impressionsSent.delete(_impressionsSent.values().next().value);
        }
        logEvent(p.id, "impression", barcode);
      }
    });
  } catch {
    /* silent — monetization is non-critical */
  }
}

/** Hide monetization section */
export function hide() {
  if (_section) _section.classList.add("hidden");
  if (_cardsEl) _cardsEl.innerHTML = "";
}

// ── Internal ────────────────────────────────────────────────────────────────

function renderCards(placements, contextBarcode) {
  if (!_cardsEl) return;
  _cardsEl.innerHTML = "";

  // Show disclosure from first placement that has one
  const disc = placements.find((p) => p.disclosure);
  if (_disclosure) {
    _disclosure.textContent = disc?.disclosure || "Sponsored";
    _disclosure.classList.remove("hidden");
  }

  placements.forEach((p) => {
    const card = document.createElement("a");
    card.className = "monetization-card";
    const safeUrl = (p.affiliate_url && p.affiliate_url.startsWith("https://")) ? p.affiliate_url : "#";
    card.href = safeUrl;
    card.target = "_blank";
    card.rel = "noopener noreferrer sponsored";
    card.setAttribute("aria-label", `${p.product_name || "Sponsored product"} — ${p.cta_text || "Learn more"}`);

    card.innerHTML = `
      ${p.image_url ? `<img class="monetization-card-img" src="${escHtml(p.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'" />` : ""}
      <div class="monetization-card-body">
        <span class="monetization-card-name">${escHtml(p.product_name || p.name || "Sponsored")}</span>
        ${p.brand ? `<span class="monetization-card-brand">${escHtml(p.brand)}</span>` : ""}
        <span class="monetization-card-cta">${escHtml(p.cta_text || "Shop now")}</span>
      </div>
    `;

    card.addEventListener("click", () => {
      logEvent(p.id, "click", contextBarcode);
    });

    _cardsEl.appendChild(card);
  });
}

async function logEvent(placementId, eventType, barcodeContext) {
  try {
    await authFetch(`${_apiBase}/v1/placements/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": _getClientId() },
      body: JSON.stringify({
        placement_id: placementId,
        event_type: eventType,
        barcode_context: barcodeContext || "",
      }),
    });
  } catch {
    /* fire-and-forget */
  }
}

function escHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
