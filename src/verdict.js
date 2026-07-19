/**
 * verdict.js — Verdict fetching, result card rendering, ingredient display,
 * and reason chips rendering.
 */

import { show, hide, setLoading, clearMessage, showMessage, showFirstScanCelebration, showFreeScanBanner } from "./ui.js";
import { fetchWithTimeout, getApiBase, getClientId, reportClientEvent, REQUEST_TIMEOUT_MS, ENDPOINTS } from "./api.js";
import { getActiveProfile, PROFILES } from "./profile.js";
import { STATUS_META, INGREDIENT_GROUP_META, REASON_LABELS, MESSAGES, VERDICT_FAILSAFE_MS } from "./config.js";
import { normalizeBarcode, isValidBarcode as isValidBarcodeUtil } from "../barcode.js";
import { showCommunitySection, hideCommunitySection } from "./community.js";
import { fetchAndRenderAlternatives, hideAlternatives } from "./alternatives.js";
import { historyPush } from "./history.js";
import { stopScanning } from "./scanner.js";
import { sanitizeText } from "./sanitize.js";
import * as Auth from "../auth.js";
import * as Favorites from "../favorites.js";
import * as Monetization from "../monetization.js";
import { handleShare as _handleShare } from "../lib/share.js";

// ── Verdict session cache ───────────────────────────────────────────────────
const _verdictCache = new Map();

// ── Free scan tracking ──────────────────────────────────────────────────────
const FREE_SCAN_KEY = "JAINI_FREE_SCANS";
const FREE_SCAN_LIMIT = 3;

function getFreeScanCount() {
  return parseInt(localStorage.getItem(FREE_SCAN_KEY) || "0", 10);
}

function incrementFreeScanCount() {
  const count = getFreeScanCount() + 1;
  localStorage.setItem(FREE_SCAN_KEY, String(count));
  return count;
}

// ── State ───────────────────────────────────────────────────────────────────
// App state is passed from the main entry point
let _state = null;
let _openAuthModalFn = null;
let _renderHistoryFn = null;

export function initVerdict({ state, openAuthModal, renderHistory }) {
  _state = state;
  _openAuthModalFn = openAuthModal;
  _renderHistoryFn = renderHistory;
}

export function clearVerdictCache() {
  _verdictCache.clear();
}

// ── Share ───────────────────────────────────────────────────────────────────

let _shareToastTimer = null;
function showShareToast(msg, ms = 3000) {
  const shareToast = document.getElementById("shareToast");
  if (!shareToast) return;
  shareToast.textContent = msg;
  shareToast.classList.add("share-toast--visible");
  clearTimeout(_shareToastTimer);
  _shareToastTimer = setTimeout(() => {
    if (shareToast) {
      shareToast.classList.remove("share-toast--visible");
      shareToast.textContent = "";
    }
  }, ms);
}

async function handleShare(barcode, status, productName, brand, reasons, explain) {
  return _handleShare(barcode, status, productName, brand, reasons, {
    statusMeta: STATUS_META,
    profileId: getActiveProfile(),
    onToast: showShareToast,
    explain: explain || "",
  });
}

// ── Manual input validation ─────────────────────────────────────────────────

export function isManualValid() {
  const input = document.getElementById("manualBarcode");
  return isValidBarcodeUtil(input?.value);
}

export function updateManualState() {
  const manualInput = document.getElementById("manualBarcode");
  const manualHelp = document.getElementById("manualHelp");
  const checkBtn = document.getElementById("checkBtn");

  const raw = manualInput.value;
  const result = normalizeBarcode(raw);
  const hadNonNumeric = raw !== result.cleaned && raw.length > 0;

  manualInput.value = result.cleaned;

  let help = "";
  let isError = false;

  if (hadNonNumeric) {
    help = "Only numbers are allowed. Spaces and hyphens are removed automatically.";
    isError = true;
  } else if (result.cleaned.length > 13) {
    help = `Too many digits (${result.cleaned.length}). Barcodes are 8, 12, or 13 digits.`;
    isError = true;
  } else if (result.symbology === "UPC-E") {
    // Manual entry can't disambiguate UPC-E from EAN-8 (both are 8 digits and
    // no scanner symbology hint is available), so don't assert one over the
    // other or flag a check digit that only applies to the UPC-E reading.
    help = "8-digit barcode (UPC-E / EAN-8). 8 digits \u2713";
  } else if (result.cleaned.length > 0 && result.cleaned.length < 8) {
    const need = 8 - result.cleaned.length;
    help = `Enter ${need} more digit${need === 1 ? "" : "s"} (need 8, 12, or 13 total).`;
    isError = false;
  } else if (result.cleaned.length > 8 && result.cleaned.length < 12) {
    const need = 12 - result.cleaned.length;
    help = `Enter ${need} more digit${need === 1 ? "" : "s"} (need 12 or 13 total).`;
    isError = false;
  } else if (result.symbology === "UPC-A") {
    const tag = result.checksumValid === false ? " (invalid check digit)" : "";
    help = `UPC-A detected. 12 digits \u2713${tag}`;
  } else if (result.symbology === "EAN-13") {
    const tag = result.checksumValid === false ? " (invalid check digit)" : "";
    help = `EAN-13 detected. 13 digits \u2713${tag}`;
  }

  manualHelp.textContent = help;
  manualHelp.classList.toggle("field-help-error", isError && result.cleaned.length > 0);
  manualInput.setAttribute("aria-invalid", isError ? "true" : "false");
  if (checkBtn) checkBtn.disabled = !isManualValid() || _state.inFlight;

  return isManualValid();
}

// ── Verdict failsafe ────────────────────────────────────────────────────────

function clearFailsafe() {
  if (_state.verdictFailsafeTimer) { clearTimeout(_state.verdictFailsafeTimer); _state.verdictFailsafeTimer = null; }
}

function startFailsafe(reqId) {
  clearFailsafe();
  _state.verdictFailsafeTimer = setTimeout(() => {
    if (reqId !== _state.requestId || !_state.inFlight) return;
    _state.inFlight = false;
    renderError(MESSAGES.scannerStalled);
    const scanStatus = document.getElementById("scanStatus");
    if (scanStatus) scanStatus.textContent = "Lookup stalled. Please try again.";
    reportClientEvent("scan_timeout", { response_ms: VERDICT_FAILSAFE_MS });
  }, VERDICT_FAILSAFE_MS);
}

// ── Skeleton loading ────────────────────────────────────────────────────────

function showVerdictSkeleton() {
  const resultSection = document.getElementById("resultSection");
  const verdictCard = document.getElementById("verdictCard");
  const productDetails = document.getElementById("productDetails");
  const ingredientSection = document.getElementById("ingredientSection");
  const notFoundState = document.getElementById("notFoundState");
  const reasonChips = document.getElementById("reasonChips");
  const shareBtn = document.getElementById("shareBtn");

  show(resultSection);
  verdictCard.className = "verdict verdict-skeleton-wrap";
  verdictCard.innerHTML = `
    <div class="verdict-skeleton">
      <div class="skeleton skeleton-verdict-badge"></div>
      <div class="skeleton skeleton-verdict-explain"></div>
      <div class="skeleton-verdict-meta">
        <span class="skeleton skeleton-verdict-chip"></span>
        <span class="skeleton skeleton-verdict-chip"></span>
      </div>
      <div class="skeleton skeleton-product-name"></div>
      <div class="skeleton skeleton-product-brand"></div>
    </div>
  `;
  hide(productDetails);
  hide(ingredientSection);
  hide(notFoundState);
  reasonChips.innerHTML = "";
  hideCommunitySection();
  hideAlternatives();
  Favorites.hideButton();
  hide(shareBtn);
  Monetization.hide();
}

function restoreVerdictCard() {
  const verdictCard = document.getElementById("verdictCard");
  verdictCard.className = "verdict verdict-UNKNOWN";
  verdictCard.innerHTML = "";
  verdictCard.setAttribute("role", "status");

  const badge = document.createElement("div");
  badge.className = "verdict-badge";
  badge.id = "verdictBadge";
  const icon = document.createElement("span");
  icon.id = "verdictIcon";
  icon.className = "verdict-icon";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.id = "statusLabel";
  label.className = "verdict-label";
  badge.appendChild(icon);
  badge.appendChild(label);

  const explain = document.createElement("p");
  explain.id = "explainText";
  explain.className = "verdict-explain";

  const metaRow = document.createElement("div");
  metaRow.className = "verdict-meta-row";
  const conf = document.createElement("span");
  conf.id = "confidenceText";
  conf.className = "confidence-chip";
  const modeChip = document.createElement("span");
  modeChip.id = "modeChip";
  modeChip.className = "mode-result-chip";
  modeChip.title = "Strictness mode used for this scan";
  metaRow.appendChild(conf);
  metaRow.appendChild(modeChip);

  verdictCard.appendChild(badge);
  verdictCard.appendChild(explain);
  verdictCard.appendChild(metaRow);
}

// ── Result rendering ────────────────────────────────────────────────────────

function renderIngredientRows(categories) {
  const ingredientRows = document.getElementById("ingredientRows");
  ingredientRows.innerHTML = "";
  const order = ["RED", "ORANGE", "YELLOW", "GREEN"];

  order.forEach(level => {
    const rawItems = Array.isArray(categories?.[level]) ? categories[level] : [];
    const meta = INGREDIENT_GROUP_META[level];

    const seenClean = new Set();
    // Strip stray split artifacts (whitespace, commas, semicolons) but KEEP
    // parentheses — the API returns balanced parens like "colour (caramel e150d)".
    const items = rawItems.filter(n => n != null).map(n => String(n).replace(/^[\s,;]+|[\s,;]+$/g, "").trim()).filter(n => {
      if (!n || seenClean.has(n)) return false;
      seenClean.add(n);
      return true;
    });

    const group = document.createElement("div");
    group.className = "ingredient-group";
    group.setAttribute("role", "listitem");

    const header = document.createElement("div");
    header.className = "ingredient-group-header";

    const badge = document.createElement("span");
    badge.className = `ingredient-group-badge badge-${level}`;
    badge.textContent = meta.label;
    badge.setAttribute("aria-label", `${meta.label}: ${items.length} ingredient${items.length === 1 ? "" : "s"}`);

    const count = document.createElement("span");
    count.className = "ingredient-group-count";
    count.textContent = items.length > 0 ? `${items.length} found` : "None";

    header.appendChild(badge);
    header.appendChild(count);
    group.appendChild(header);

    if (items.length > 0) {
      const itemsEl = document.createElement("div");
      itemsEl.className = "ingredient-items";
      items.forEach(name => {
        const row = document.createElement("div");
        row.className = "ingredient-item";
        const nameEl = document.createElement("span");
        nameEl.className = "ingredient-name";
        nameEl.textContent = sanitizeText(name);
        const reasonEl = document.createElement("span");
        reasonEl.className = "ingredient-reason";
        reasonEl.textContent = meta.reason;
        row.appendChild(nameEl);
        row.appendChild(reasonEl);
        itemsEl.appendChild(row);
      });
      group.appendChild(itemsEl);
    }

    ingredientRows.appendChild(group);
  });
}

export function hideResult() {
  const resultSection = document.getElementById("resultSection");
  const notFoundState = document.getElementById("notFoundState");
  const ingredientSection = document.getElementById("ingredientSection");
  const productDetails = document.getElementById("productDetails");
  const shareBtn = document.getElementById("shareBtn");
  const reasonChips = document.getElementById("reasonChips");
  const savedNote = document.getElementById("savedNote");
  const dataSourceBadge = document.getElementById("dataSourceBadge");

  hide(resultSection);
  hide(notFoundState);
  hide(ingredientSection);
  hide(productDetails);
  hide(shareBtn);
  hide(dataSourceBadge);
  if (dataSourceBadge) dataSourceBadge.textContent = "";
  hideCommunitySection();
  hideAlternatives();
  Favorites.hideButton();
  Monetization.hide();
  reasonChips.replaceChildren();
  savedNote.textContent = "";
  _state.currentBarcode = "";
}

// UI cleanup shared by every outcome (success, not-found, error, rate-limit).
// Must be idempotent-safe: it does NOT touch the free-scan counter.
function presentOutcome() {
  const cameraArea = document.getElementById("cameraArea");
  const scanTriggerArea = document.getElementById("scanTriggerArea");
  const newScanBtn = document.getElementById("newScanBtn");

  stopScanning(_state);
  clearFailsafe();
  setLoading(false, "Looking up product\u2026", isManualValid);
  hide(cameraArea);
  hide(scanTriggerArea);
  show(newScanBtn);
  updateManualState();
}

// Count one scan against the anonymous free-scan allowance. Called ONLY from a
// successful verdict render \u2014 not-found, network errors and rate-limits must
// not burn a free scan. Runs exactly once per successful outcome.
function countFreeScan() {
  if (Auth.isSignedIn()) return;
  const count = incrementFreeScanCount();
  const remaining = Math.max(0, FREE_SCAN_LIMIT - count);
  if (remaining > 0 && remaining < FREE_SCAN_LIMIT) {
    showFreeScanBanner(remaining, _openAuthModalFn);
  }
}

export function displayVerdictData(data, barcode, fromCache = false) {
  _state.currentBarcode = barcode;
  // renderResult already runs presentOutcome() + countFreeScan() exactly once.
  // Do NOT call presentOutcome() again here \u2014 that double-counted the scan.
  renderResult(data);
  if (fromCache) {
    const savedNote = document.getElementById("savedNote");
    if (savedNote) savedNote.textContent = "\u21BB From your recent scan";
  }
  _state.scanLocked = false;
  _state.inFlight = false;
}

export function renderResult(data) {
  clearMessage();
  setLoading(false, "Looking up product\u2026", isManualValid);

  const verdictCard = document.getElementById("verdictCard");
  if (verdictCard.classList.contains("verdict-skeleton-wrap")) {
    restoreVerdictCard();
  }

  hideResult();

  const status = STATUS_META[data.status] ? data.status : "UNKNOWN";
  const meta = STATUS_META[status];
  _state.currentBarcode = data.barcode || "";

  // Haptic feedback
  if (navigator.vibrate) {
    const haptics = { GREEN: [30], YELLOW: [30, 50, 30], ORANGE: [30, 50, 30], RED: [80] };
    const pattern = haptics[status];
    if (pattern) try { navigator.vibrate(pattern); } catch {}
  }

  const resultSection = document.getElementById("resultSection");
  const verdictIcon = document.getElementById("verdictIcon");
  const statusLabel = document.getElementById("statusLabel");
  const explainText = document.getElementById("explainText");
  const confidenceText = document.getElementById("confidenceText");
  const modeChip = document.getElementById("modeChip");
  const productDetails = document.getElementById("productDetails");
  const productNameText = document.getElementById("productNameText");
  const brandText = document.getElementById("brandText");
  const barcodeInfo = document.getElementById("barcodeInfo");
  const reasonChips = document.getElementById("reasonChips");
  const savedNote = document.getElementById("savedNote");
  const shareBtn = document.getElementById("shareBtn");
  const ingredientSection = document.getElementById("ingredientSection");
  const ingredientsText = document.getElementById("ingredientsText");

  show(resultSection);
  resultSection.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  verdictCard.className = `verdict verdict-${status}`;
  verdictCard.setAttribute("aria-label", `${meta.ariaPrefix} ${data.explain || ""}`);
  verdictIcon.innerHTML = meta.icon;
  statusLabel.textContent = meta.label;
  explainText.textContent = sanitizeText(data.explain) || "No explanation available.";

  // Confidence chip
  if (confidenceText) {
    const conf = (data.confidence || "").toUpperCase();
    if (conf === "HIGH" || conf === "MED" || conf === "LOW") {
      const displayConf = conf === "MED" ? "Medium" : conf.charAt(0) + conf.slice(1).toLowerCase();
      confidenceText.textContent = displayConf + " confidence";
      const cssClass = conf === "MED" ? "medium" : conf.toLowerCase();
      confidenceText.className = "confidence-chip conf-" + cssClass;
    } else {
      confidenceText.textContent = "";
      confidenceText.className = "confidence-chip";
    }
  }

  // Low-confidence warning
  const existingWarning = verdictCard.querySelector(".confidence-warning-banner");
  if (existingWarning) existingWarning.remove();
  if (
    (data.confidence || "").toUpperCase() === "LOW" &&
    (!data.ingredients_text || data.ingredients_text.trim() === "")
  ) {
    const banner = document.createElement("div");
    banner.className = "confidence-warning-banner";
    banner.setAttribute("role", "alert");
    banner.textContent = "\u26A0\uFE0F No ingredient data available \u2014 this verdict cannot be confirmed. Please check the product label.";
    verdictCard.appendChild(banner);
  }

  // Mode chip
  if (modeChip) {
    const activeProfile = PROFILES.find(p => p.id === getActiveProfile());
    modeChip.textContent = activeProfile ? `${activeProfile.label} mode` : "";
  }

  // Product metadata
  if (data.product_name || data.brand) {
    show(productDetails);
    productNameText.textContent = sanitizeText(data.product_name) || "Product name unknown";
    brandText.textContent = data.brand ? `Brand: ${sanitizeText(data.brand)}` : "";
    barcodeInfo.textContent = "";
  }

  // Reason chips
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  reasonChips.replaceChildren();
  reasons.filter(r => r != null).forEach(r => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.setAttribute("role", "listitem");
    chip.textContent = REASON_LABELS[r] || String(r).replace(/_/g, " ").toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
    chip.setAttribute("title", r);
    reasonChips.appendChild(chip);
  });

  // Data source provenance badge (community-submitted vs curated).
  // Curated products show no badge. Built via textContent (never innerHTML).
  const dataSourceBadge = document.getElementById("dataSourceBadge");
  if (dataSourceBadge) {
    if (data.data_source === "community") {
      if (data.verified === true) {
        dataSourceBadge.textContent = "Community-verified";
        dataSourceBadge.className = "data-source-badge data-source-badge--verified";
      } else {
        dataSourceBadge.textContent = "Community-submitted · unverified";
        dataSourceBadge.className = "data-source-badge data-source-badge--unverified";
      }
      show(dataSourceBadge);
    } else {
      dataSourceBadge.textContent = "";
      dataSourceBadge.className = "data-source-badge hidden";
    }
  }

  // Community verification
  showCommunitySection(_state.currentBarcode, data.community || null);

  // Alternatives
  fetchAndRenderAlternatives(
    _state.currentBarcode, data.status, _state.requestId,
    () => _state.requestId,
    triggerManualBarcode
  );

  // Favorites
  Favorites.onResultDisplayed(_state.currentBarcode);

  // Monetization
  Monetization.showForVerdict(_state.currentBarcode, data.status);

  // History push
  historyPush({
    barcode: _state.currentBarcode,
    status: status,
    product_name: data.product_name || "",
    brand: data.brand || "",
    profile: getActiveProfile(),
    ts: new Date().toISOString(),
    verdictData: {
      status: data.status, explain: data.explain, product_name: data.product_name,
      brand: data.brand, reasons: data.reasons, barcode: data.barcode,
      confidence: data.confidence, exactness: data.exactness,
    },
  }, _renderHistoryFn);

  // Saved banner
  savedNote.textContent = data.saved ? "\u2713 Saved for future scans" : "";

  // Share button
  if (shareBtn && _state.currentBarcode) {
    shareBtn.dataset.barcode = _state.currentBarcode;
    shareBtn.dataset.status = status;
    shareBtn.dataset.name = data.product_name || "";
    shareBtn.dataset.brand = data.brand || "";
    shareBtn.dataset.reasons = JSON.stringify(data.reasons || []);
    shareBtn.dataset.explain = data.explain || "";
    show(shareBtn);
  }

  // Ingredients
  show(ingredientSection);
  ingredientsText.textContent = sanitizeText(data.ingredients_text) || "Ingredient text not available.";
  renderIngredientRows(data.ingredient_categories);

  presentOutcome();
  // Successful verdict render — this is the only place a free scan is counted.
  countFreeScan();

  // First-scan celebration
  if (!localStorage.getItem("JAINI_FIRST_SCAN_DONE")) {
    localStorage.setItem("JAINI_FIRST_SCAN_DONE", "1");
    showFirstScanCelebration();
  }
}

export function renderNotFound(barcode) {
  clearMessage();
  setLoading(false, "Looking up product\u2026", isManualValid);
  const verdictCard = document.getElementById("verdictCard");
  if (verdictCard.classList.contains("verdict-skeleton-wrap")) {
    restoreVerdictCard();
  }
  hideResult();

  _state.currentBarcode = barcode;
  const resultSection = document.getElementById("resultSection");
  const verdictIcon = document.getElementById("verdictIcon");
  const statusLabel = document.getElementById("statusLabel");
  const explainText = document.getElementById("explainText");
  const barcodeInfo = document.getElementById("barcodeInfo");
  const productDetails = document.getElementById("productDetails");
  const productNameText = document.getElementById("productNameText");
  const brandText = document.getElementById("brandText");
  const notFoundState = document.getElementById("notFoundState");
  const missingBarcode = document.getElementById("missingBarcode");

  show(resultSection);
  resultSection.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  verdictCard.className = "verdict verdict-UNKNOWN";
  verdictIcon.innerHTML = STATUS_META.UNKNOWN.icon;
  statusLabel.textContent = STATUS_META.UNKNOWN.label;
  explainText.textContent = "";

  barcodeInfo.textContent = "";
  show(productDetails);
  productNameText.textContent = "";
  brandText.textContent = "";

  show(notFoundState);
  if (missingBarcode) missingBarcode.value = barcode;

  presentOutcome();
}

function renderRateLimit(data) {
  clearMessage();
  setLoading(false, "Looking up product\u2026", isManualValid);
  hideResult();
  const count = String(data?.count ?? "?");
  const limit = String(data?.limit ?? "?");
  const reset = String(data?.reset ?? "unknown");

  const p = document.createElement("p");
  p.appendChild(document.createTextNode(`You've used ${count} of ${limit} free lookups today. Your limit resets on ${reset}. Contact `));
  const a = document.createElement("a");
  a.href = "mailto:hello@swapncore.com";
  a.textContent = "hello@swapncore.com";
  p.appendChild(a);
  p.appendChild(document.createTextNode(" to request an increase."));

  showMessage({ variant: "warn", domContent: p });
  presentOutcome();
}

export function renderError(message) {
  const retryBarcode = _state.currentBarcode;
  clearMessage();
  setLoading(false, "Looking up product\u2026", isManualValid);
  const verdictCard = document.getElementById("verdictCard");
  if (verdictCard.classList.contains("verdict-skeleton-wrap")) {
    restoreVerdictCard();
  }
  hideResult();

  if (retryBarcode) {
    const container = document.createElement("div");
    const text = document.createElement("span");
    text.textContent = message || MESSAGES.genericError;
    container.appendChild(text);

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn-link retry-btn";
    retryBtn.textContent = "Try again";
    retryBtn.style.marginLeft = "0.5em";
    retryBtn.addEventListener("click", () => fetchVerdict(retryBarcode));
    container.appendChild(retryBtn);

    showMessage({ variant: "error", domContent: container });
  } else {
    showMessage({ variant: "error", message: message || MESSAGES.genericError });
  }

  presentOutcome();
}

// ── Trigger manual barcode scan ─────────────────────────────────────────────

export function triggerManualBarcode(barcode) {
  const manualInput = document.getElementById("manualBarcode");
  if (manualInput) {
    manualInput.value = barcode;
    fetchVerdict(barcode).catch(() => renderError(MESSAGES.genericError));
  }
}

// ── Main fetch verdict ──────────────────────────────────────────────────────

export async function fetchVerdict(rawBarcode) {
  if (!Auth.isSignedIn() && getFreeScanCount() >= FREE_SCAN_LIMIT) {
    // Free limit hit: the caller (submit handler / scanner) already set the
    // scan lock. Release it here, otherwise the manual-submit guard swallows
    // every subsequent Check and the button stays dead until reload.
    _state.scanLocked = false;
    _state.inFlight = false;
    _openAuthModalFn("Sign in with Google to keep scanning");
    return;
  }

  const normalized = normalizeBarcode(rawBarcode);
  const barcode = normalized.upc12 || normalized.ean13 || normalized.cleaned;
  if (barcode.length !== 12 && barcode.length !== 13) {
    _state.scanLocked = false;
    _state.inFlight = false;
    updateManualState();
    showMessage({ variant: "error", message: MESSAGES.invalidBarcode });
    return;
  }

  // Instant re-scan: check session cache
  const cacheKey = `${barcode}:${getActiveProfile()}`;
  const cached = _verdictCache.get(cacheKey);
  if (cached && (Date.now() - cached._cachedAt) < 86400000) {
    _verdictCache.delete(cacheKey);
    _verdictCache.set(cacheKey, { ...cached, _cachedAt: Date.now() });
    _state.scanLocked = true;
    clearMessage();
    hideResult();
    displayVerdictData(cached, barcode, true);
    return;
  }

  const reqId = ++_state.requestId;
  _state.inFlight = true;
  _state.scanLocked = true;

  clearMessage();
  hideResult();
  setLoading(true, `Looking up barcode ${barcode}\u2026`, isManualValid);
  showVerdictSkeleton();
  const scanStatus = document.getElementById("scanStatus");
  if (scanStatus) scanStatus.textContent = `Looking up ${barcode}\u2026`;
  startFailsafe(reqId);

  const tStart = Date.now();

  try {
    const url = new URL(`${getApiBase()}${ENDPOINTS.verdict}`);
    url.searchParams.set("barcode", barcode);
    url.searchParams.set("profile", getActiveProfile());

    let resp;
    try {
      const hdrs = { "X-Client-Id": getClientId() };
      const tok = Auth.getAccessToken();
      if (tok) hdrs["Authorization"] = `Bearer ${tok}`;
      resp = await fetchWithTimeout(url.toString(), {
        method: "GET",
        headers: hdrs,
      }, REQUEST_TIMEOUT_MS);
    } catch (err) {
      if (reqId !== _state.requestId) return;
      renderError(err?.name === "AbortError" ? MESSAGES.timeout : MESSAGES.network);
      if (scanStatus) scanStatus.textContent = err?.name === "AbortError" ? "Request timed out." : "Network error.";
      reportClientEvent("api_error", {
        error_code: "network",
        error_msg: err?.message || "network",
        response_ms: Date.now() - tStart,
      });
      return;
    }

    if (reqId !== _state.requestId) return;
    const data = await resp.json().catch(() => ({}));
    if (reqId !== _state.requestId) return;

    if (resp.status === 401) {
      if (data.error === "AUTH_REQUIRED" && !Auth.isSignedIn()) {
        localStorage.setItem(FREE_SCAN_KEY, String(FREE_SCAN_LIMIT));
        _openAuthModalFn(data.message || "Sign in with Google to keep scanning");
        presentOutcome();
        return;
      }
      _openAuthModalFn();
      presentOutcome();
      showMessage({ variant: "warn", message: "Your session expired. Please sign in again." });
      return;
    }

    if (resp.ok) {
      const ck = `${barcode}:${getActiveProfile()}`;
      _verdictCache.set(ck, { ...data, _cachedAt: Date.now() });
      if (_verdictCache.size > 50) {
        const oldest = _verdictCache.keys().next().value;
        _verdictCache.delete(oldest);
      }
      renderResult(data);
      if (scanStatus) scanStatus.textContent = `Scan complete: ${barcode}`;
      return;
    }

    if (resp.status === 404 && data.error === "NOT_FOUND") {
      renderNotFound(barcode);
      if (scanStatus) scanStatus.textContent = `Barcode ${barcode} not found in dataset.`;
      return;
    }

    if (resp.status === 429 && data.error === "RATE_LIMIT") {
      renderRateLimit(data);
      if (scanStatus) scanStatus.textContent = "Daily lookup limit reached.";
      return;
    }

    renderError(MESSAGES.network);
    if (scanStatus) scanStatus.textContent = "Lookup failed.";
    reportClientEvent("api_error", {
      error_code: String(resp?.status || "network"),
      error_msg: data?.error || data?.message || "",
      response_ms: Date.now() - tStart,
    });

  } catch {
    if (reqId !== _state.requestId) return;
    renderError(MESSAGES.network);
  } finally {
    _state.inFlight = false;
    _state.scanLocked = false;
    if (reqId === _state.requestId) {
      clearFailsafe();
      setLoading(false, "Looking up product\u2026", isManualValid);
      updateManualState();
    }
  }
}

// ── Bind share button ───────────────────────────────────────────────────────

export function bindShareEvent() {
  const shareBtn = document.getElementById("shareBtn");
  shareBtn?.addEventListener("click", () => {
    const { barcode, status, name, brand, reasons, explain } = shareBtn.dataset;
    if (barcode) handleShare(barcode, status, name, brand, JSON.parse(reasons || "[]"), explain);
  });
}

// ── Export free scan utilities ───────────────────────────────────────────────

export { FREE_SCAN_KEY, FREE_SCAN_LIMIT };
