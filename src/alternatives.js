/**
 * alternatives.js — Jain-friendly alternatives fetching and display.
 *
 * When a product is RED, ORANGE, or YELLOW, fetches and renders
 * alternative Jain-friendly products.
 */

import { show, hide } from "./ui.js";
import { fetchWithTimeout, getApiBase, getClientId, REQUEST_TIMEOUT_MS, ENDPOINTS } from "./api.js";
import { getActiveProfile } from "./profile.js";
import { STATUS_META } from "./config.js";
import { sanitizeText } from "./sanitize.js";

/**
 * Fetch and render alternatives for the given barcode/status.
 * @param {string} barcode
 * @param {string} status
 * @param {number} requestId - current request ID for stale-check
 * @param {Function} getRequestId - returns current state.requestId
 * @param {Function} triggerManualBarcode - callback to scan a barcode from alternatives
 */
export async function fetchAndRenderAlternatives(barcode, status, requestId, getRequestId, triggerManualBarcode) {
  const section = document.getElementById("alternativesSection");
  const list = document.getElementById("alternativesList");
  const brandEl = document.getElementById("alternativesBrand");

  if (status !== "RED" && status !== "ORANGE" && status !== "YELLOW") {
    hideAlternatives();
    return;
  }
  if (!section) return;

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
    const alts = data.alternatives || [];
    if (!alts.length) return;

    if (requestId !== getRequestId()) return;

    list.replaceChildren();
    alts.forEach(a => {
      const safeStatus = ["green", "yellow", "orange", "red"].includes((a.status || "").toLowerCase()) ? a.status.toLowerCase() : "unknown";
      const label = STATUS_META[(a.status || "").toUpperCase()]?.label || a.status;

      const li = document.createElement("li");
      li.className = "alternatives-item";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alt-scan-btn";
      btn.dataset.barcode = a.barcode || "";
      btn.setAttribute("aria-label", `Scan ${sanitizeText(a.product_name)}`);

      const badge = document.createElement("span");
      badge.className = `alt-badge alt-badge--${safeStatus}`;
      badge.textContent = label;

      const name = document.createElement("span");
      name.className = "alt-name";
      name.textContent = sanitizeText(a.product_name);

      btn.appendChild(badge);
      btn.appendChild(name);

      if (a.brand) {
        const brandSpan = document.createElement("span");
        brandSpan.className = "alt-brand";
        brandSpan.textContent = sanitizeText(a.brand);
        btn.appendChild(brandSpan);
      }

      btn.addEventListener("click", () => {
        const bc = btn.dataset.barcode;
        if (bc) triggerManualBarcode(bc);
      });

      li.appendChild(btn);
      list.appendChild(li);
    });

    if (data.based_on === "brand" && alts[0]?.brand) {
      brandEl.textContent = `from ${sanitizeText(alts[0].brand)}`;
    }
    show(section);
  } catch { /* fire-and-forget */ }
}

export function hideAlternatives() {
  const section = document.getElementById("alternativesSection");
  const list = document.getElementById("alternativesList");
  const brandEl = document.getElementById("alternativesBrand");
  hide(section);
  if (list) list.replaceChildren();
  if (brandEl) brandEl.textContent = "";
}
