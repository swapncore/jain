/**
 * search.js — Product name search for Jaini web app.
 *
 * Calls /v1/search for trigram-ranked results and /v1/search/click for analytics.
 * Supports verdict color filter pills (GREEN/YELLOW/ORANGE/RED).
 * Exports init() for app.js to wire up.
 */

import { authFetch, getUser } from "./auth.js?v=3";

let _apiBase = "";
let _getClientId = () => "";
let _getProfile = () => "everyday_jain";
let _onProductSelect = null; // callback: (barcode) => void


export function init({ apiBase, getClientId, getProfile, onProductSelect }) {
  _apiBase = apiBase;
  _getClientId = getClientId;
  _getProfile = getProfile;
  _onProductSelect = onProductSelect;

  const form = document.getElementById("searchForm");
  const input = document.getElementById("searchInput");
  const resultsEl = document.getElementById("searchResults");
  const emptyEl = document.getElementById("searchEmpty");
  const switchBtn = document.getElementById("switchToBarcode");

  if (!form || !input) return;

  let _debounce = null;
  let _lastQuery = "";

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length >= 2) runSearch(q);
  });

  // Live search with debounce (300ms after typing stops)
  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(_debounce);
    if (q.length < 2) {
      hideResults();
      return;
    }
    _debounce = setTimeout(() => runSearch(q), 300);
  });

  // "scan the barcode instead" link
  switchBtn?.addEventListener("click", () => {
    hideResults();
    input.value = "";
    document.getElementById("manualBarcode")?.focus();
  });

  async function runSearch(query) {
    if (query === _lastQuery) return;
    _lastQuery = query;

    // Show loading skeleton
    if (resultsEl) {
      resultsEl.innerHTML = buildSearchSkeleton();
      resultsEl.classList.remove("hidden");
    }
    if (emptyEl) emptyEl.classList.add("hidden");

    const profile = _getProfile();
    const url = new URL(`${_apiBase}/v1/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("profile", profile);
    url.searchParams.set("limit", "12");

    try {
      const resp = await authFetch(url.toString(), {
        headers: { "X-Client-Id": _getClientId() },
      });
      if (!resp.ok) { hideResults(); return; }
      const data = await resp.json();
      const products = data.results || data.products || [];

      if (products.length === 0) {
        if (resultsEl) resultsEl.classList.add("hidden");
        if (emptyEl) emptyEl.classList.remove("hidden");
        return;
      }

      if (emptyEl) emptyEl.classList.add("hidden");
      renderResults(products, query);
    } catch {
      hideResults();
    }
  }

  function buildSearchSkeleton() {
    const items = Array.from({ length: 4 }, () =>
      `<div class="search-result-skeleton">
        <span class="skeleton skeleton-dot"></span>
        <span class="skeleton-info">
          <span class="skeleton skeleton-text skeleton-text--name"></span>
          <span class="skeleton skeleton-text skeleton-text--brand"></span>
        </span>
        <span class="skeleton skeleton-badge"></span>
      </div>`
    ).join("");
    return items;
  }

  function renderResults(products, query) {
    if (!resultsEl) return;
    resultsEl.innerHTML = "";

    products.forEach((p) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-result-item";
      item.dataset.barcode = p.barcode;

      const statusClass = (p.status || "UNKNOWN").toLowerCase();
      const statusLabel = p.status_label || p.status || "Unknown";

      item.innerHTML = `
        <span class="search-result-dot search-result-dot--${statusClass}" aria-hidden="true"></span>
        <span class="search-result-info">
          <span class="search-result-name">${escHtml(p.product_name || p.barcode)}</span>
          ${p.brand ? `<span class="search-result-brand">${escHtml(p.brand)}</span>` : ""}
          <span class="search-result-meta">${escHtml(p.barcode || "")}</span>
        </span>
        <span class="search-result-status search-result-status--${statusClass}">${escHtml(statusLabel)}</span>
      `;

      item.addEventListener("click", () => {
        // Log click for analytics
        logSearchClick(query, p.barcode);
        if (_onProductSelect) _onProductSelect(p.barcode);
      });

      resultsEl.appendChild(item);
    });

    resultsEl.classList.remove("hidden");
  }

  function hideResults() {
    _lastQuery = "";
    if (resultsEl) { resultsEl.classList.add("hidden"); resultsEl.innerHTML = ""; }
    if (emptyEl) emptyEl.classList.add("hidden");
  }

  async function logSearchClick(query, barcode) {
    try {
      await authFetch(`${_apiBase}/v1/search/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": _getClientId() },
        body: JSON.stringify({ query, barcode, profile: _getProfile() }),
      });
    } catch { /* fire-and-forget */ }
  }
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
