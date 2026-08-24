/**
 * favorites.js — Saved products / favorites for Jaini web app.
 *
 * Manages the favorites list, toggle button on result cards,
 * and the favorites section on the main page.
 * Requires user to be signed in (delegates to auth.js).
 */

import { authFetch, isSignedIn } from "./auth.js";

let _apiBase = "";
let _getClientId = () => "";
let _getProfile = () => "everyday_jain";
let _onProductSelect = null;

// DOM refs
let _favoriteBtn = null;
let _favoriteBtnText = null;
let _favoritesSection = null;
let _favoritesList = null;
let _favoritesEmpty = null;
let _favoritesSignIn = null;
let _favoritesSignInBtn = null;
let _onSignInRequest = null;
// Predicate: has this device recorded at least one scan? The sign-in upsell is
// withheld until then — a brand-new visitor should not meet a "Sign in" card as
// the biggest thing above the fold before they have scanned anything.
let _hasAnyScans = () => true;

// State
let _currentBarcode = "";
let _currentIsFav = false;

export function init({ apiBase, getClientId, getProfile, onProductSelect, onSignInRequest, hasAnyScans }) {
  _apiBase = apiBase;
  _getClientId = getClientId;
  _getProfile = getProfile;
  _onProductSelect = onProductSelect;
  _onSignInRequest = onSignInRequest;
  if (typeof hasAnyScans === "function") _hasAnyScans = hasAnyScans;

  _favoriteBtn = document.getElementById("favoriteBtn");
  _favoriteBtnText = document.getElementById("favoriteBtnText");
  _favoritesSection = document.getElementById("favoritesSection");
  _favoritesList = document.getElementById("favoritesList");
  _favoritesEmpty = document.getElementById("favoritesEmpty");
  _favoritesSignIn = document.getElementById("favoritesSignInPrompt");
  _favoritesSignInBtn = document.getElementById("favoritesSignInBtn");

  // Toggle favorite on result card
  _favoriteBtn?.addEventListener("click", handleToggle);

  // Sign-in prompt in favorites section
  _favoritesSignInBtn?.addEventListener("click", () => {
    if (_onSignInRequest) _onSignInRequest();
  });
}

/** Call when auth state changes — refresh favorites list */
export function onAuthChange() {
  if (isSignedIn()) {
    loadFavorites();
  } else {
    showSignInPrompt();
  }
}

/**
 * Call when the "has the user scanned anything yet?" answer may have changed
 * (history rendered, first scan recorded). Re-evaluates whether the saved-
 * products / sign-in card should be on screen at all.
 */
export function onFirstRunStateChange() {
  if (!isSignedIn()) showSignInPrompt();
}

/** Call when a new result is displayed — update favorite button state */
export async function onResultDisplayed(barcode) {
  _currentBarcode = barcode;
  _currentIsFav = false;

  if (!_favoriteBtn) return;

  if (!isSignedIn() || !barcode) {
    _favoriteBtn.classList.add("hidden");
    return;
  }

  // Check if this barcode is a favorite
  try {
    const profile = _getProfile();
    const resp = await authFetch(
      `${_apiBase}/v1/favorites/${encodeURIComponent(barcode)}/check?profile=${encodeURIComponent(profile)}`,
      { headers: { "X-Client-Id": _getClientId() } }
    );
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      _currentIsFav = !!data.is_favorite;
    }
  } catch {
    _currentIsFav = false;
  }

  updateFavButton();
  _favoriteBtn.classList.remove("hidden");
}

/** Hide the favorite button (e.g., when result is hidden) */
export function hideButton() {
  _favoriteBtn?.classList.add("hidden");
}

/** Load and render favorites list */
export async function loadFavorites() {
  if (!_favoritesSection) return;

  if (!isSignedIn()) {
    showSignInPrompt();
    return;
  }

  // Hide sign-in prompt, show loading
  if (_favoritesSignIn) _favoritesSignIn.classList.add("hidden");
  if (_favoritesEmpty) _favoritesEmpty.classList.add("hidden");
  if (_favoritesList) _favoritesList.innerHTML = '<div class="favorites-loading">Loading saved products...</div>';
  if (_favoritesSection) _favoritesSection.classList.remove("hidden");

  try {
    const profile = _getProfile();
    const resp = await authFetch(
      `${_apiBase}/v1/favorites?profile=${encodeURIComponent(profile)}`,
      { headers: { "X-Client-Id": _getClientId() } }
    );

    if (!resp.ok) {
      _favoritesSection.classList.add("hidden");
      return;
    }

    const data = await resp.json().catch(() => ({}));
    const items = data.favorites || data || [];

    if (items.length === 0) {
      _favoritesSection.classList.remove("hidden");
      if (_favoritesList) _favoritesList.innerHTML = "";
      if (_favoritesEmpty) _favoritesEmpty.classList.remove("hidden");
      return;
    }

    if (_favoritesEmpty) _favoritesEmpty.classList.add("hidden");
    renderFavorites(items);
    _favoritesSection.classList.remove("hidden");
  } catch {
    _favoritesSection.classList.add("hidden");
  }
}

// ── Internal ────────────────────────────────────────────────────────────────

function showSignInPrompt() {
  if (!_favoritesSection) return;
  // Defer the whole card until the user has actually scanned something.
  if (!_hasAnyScans()) {
    _favoritesSection.classList.add("hidden");
    if (_favoritesList) _favoritesList.innerHTML = "";
    return;
  }
  _favoritesSection.classList.remove("hidden");
  if (_favoritesSignIn) _favoritesSignIn.classList.remove("hidden");
  if (_favoritesList) _favoritesList.innerHTML = "";
  if (_favoritesEmpty) _favoritesEmpty.classList.add("hidden");
}

function updateFavButton() {
  if (!_favoriteBtn || !_favoriteBtnText) return;
  if (_currentIsFav) {
    _favoriteBtnText.textContent = "Saved";
    _favoriteBtn.classList.add("fav-active");
    _favoriteBtn.setAttribute("aria-label", "Remove from saved products");
  } else {
    _favoriteBtnText.textContent = "Save";
    _favoriteBtn.classList.remove("fav-active");
    _favoriteBtn.setAttribute("aria-label", "Save this product");
  }
}

let _toggleInFlight = false;
async function handleToggle() {
  if (_toggleInFlight) return;
  if (!isSignedIn()) {
    if (_onSignInRequest) _onSignInRequest();
    return;
  }
  if (!_currentBarcode) return;
  _toggleInFlight = true;
  try {

  const profile = _getProfile();

  if (_currentIsFav) {
    // Remove
    _currentIsFav = false;
    updateFavButton();
    try {
      await authFetch(
        `${_apiBase}/v1/favorites/${encodeURIComponent(_currentBarcode)}?profile=${encodeURIComponent(profile)}`,
        { method: "DELETE", headers: { "X-Client-Id": _getClientId() } }
      );
    } catch { /* revert on failure? keep optimistic for now */ }
  } else {
    // Add
    _currentIsFav = true;
    updateFavButton();
    try {
      await authFetch(
        `${_apiBase}/v1/favorites/${encodeURIComponent(_currentBarcode)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Client-Id": _getClientId() },
          body: JSON.stringify({ profile }),
        }
      );
    } catch { /* optimistic */ }
  }

  // Refresh favorites list
  loadFavorites();
  } finally {
    _toggleInFlight = false;
  }
}

function renderFavorites(items) {
  if (!_favoritesList) return;
  _favoritesList.innerHTML = "";

  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "favorites-item";
    li.setAttribute("role", "listitem");

    const statusClass = (item.status || "unknown").toLowerCase();

    li.innerHTML = `
      <button type="button" class="favorites-item-btn" data-barcode="${escHtml(item.barcode)}" aria-label="View ${escHtml(item.product_name || item.barcode)}">
        <span class="history-dot history-dot--${escHtml(statusClass)}" aria-hidden="true"></span>
        <span class="favorites-item-name">${escHtml(item.product_name || item.barcode)}</span>
        ${item.brand ? `<span class="favorites-item-brand">${escHtml(item.brand)}</span>` : ""}
      </button>
      <button type="button" class="favorites-remove-btn" data-barcode="${escHtml(item.barcode)}" aria-label="Remove ${escHtml(item.product_name || item.barcode)} from favorites">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    // Click to view product
    li.querySelector(".favorites-item-btn")?.addEventListener("click", () => {
      if (_onProductSelect) _onProductSelect(item.barcode);
    });

    // Remove button
    li.querySelector(".favorites-remove-btn")?.addEventListener("click", async () => {
      const profile = _getProfile();
      try {
        await authFetch(
          `${_apiBase}/v1/favorites/${encodeURIComponent(item.barcode)}?profile=${encodeURIComponent(profile)}`,
          { method: "DELETE", headers: { "X-Client-Id": _getClientId() } }
        );
      } catch { /* ignore */ }
      loadFavorites();
    });

    _favoritesList.appendChild(li);
  });
}

function escHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
