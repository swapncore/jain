/**
 * verdict.js — Verdict fetching, result card rendering, ingredient display,
 * and reason chips rendering.
 */

import { show, hide, toggle, setLoading, clearMessage, showMessage, showFirstScanCelebration, showFreeScanBanner } from "./ui.js";
import { fetchWithTimeout, getApiBase, getClientId, reportClientEvent, REQUEST_TIMEOUT_MS, ENDPOINTS } from "./api.js";
import { getActiveProfile, PROFILES } from "./profile.js";
import { STATUS_META, INGREDIENT_GROUP_META, REASON_LABELS, MESSAGES, VERDICT_FAILSAFE_MS } from "./config.js";
import { normalizeBarcode, pickLookupBarcode, isValidBarcode as isValidBarcodeUtil } from "../barcode.js";
// Anonymous free-scan accounting — DOM-free policy module, unit-tested.
import {
  FREE_SCAN_KEY, FREE_SCAN_LIMIT,
  isFreeScanExhausted, readServerScansRemaining, recordServerLookup,
  setFreeScanCount,
} from "./freescan.js";
import {
  getConfidenceMeta, verdictCaveat, hasIngredientEvidence, UNKNOWN_CAUSES,
} from "./confidence.js";
import { showCommunitySection, hideCommunitySection } from "./community.js";
import { fetchAndRenderAlternatives, hideAlternatives } from "./alternatives.js";
import { historyPush } from "./history.js";
import { stopScanning } from "./scanner.js";
import { sanitizeText } from "./sanitize.js";
// Article 9 consent gate — no verdict may be requested without essential consent.
import { canScan } from "./consent.js";
import * as Auth from "../auth.js";
import * as Favorites from "../favorites.js";
import * as Monetization from "../monetization.js";
import { handleShare as _handleShare } from "../lib/share.js";

/**
 * Bring the verdict into view AFTER layout settles.
 *
 * The old code scrolled the instant the result was shown -- but on a scan the
 * tall camera/scan panel ABOVE the result collapses at the same moment, which
 * shifts the result upward. Scrolling in that same frame targeted the taller
 * pre-collapse offset and left the user parked BELOW the verdict, looking at the
 * ingredient table. Two rAFs let the collapse + content population finish, then
 * we scroll to the verdict CARD itself (not the whole section) so its header
 * sits at the top of the viewport.
 */
function scrollVerdictIntoView() {
  const target = document.getElementById("verdictCard")
    || document.getElementById("resultSection");
  if (!target) return;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }));
}

// ── Verdict session cache ───────────────────────────────────────────────────
const _verdictCache = new Map();

// ── State ───────────────────────────────────────────────────────────────────
// App state is passed from the main entry point
let _state = null;
let _openAuthModalFn = null;
let _renderHistoryFn = null;
let _onNeedConsentFn = null;

export function initVerdict({ state, openAuthModal, renderHistory, onNeedConsent }) {
  _state = state;
  _openAuthModalFn = openAuthModal;
  _renderHistoryFn = renderHistory;
  _onNeedConsentFn = onNeedConsent || null;
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

// ── Evidence quality: confidence chip, caveat, UNKNOWN guidance ─────────────

// The magnifier belongs to "we searched and this barcode is not in the set".
// It is deliberately no longer the UNKNOWN status icon.
const NOT_FOUND_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

/** Small inline SVG built via DOM (never innerHTML with untrusted input). */
function makeIcon(paths, size = 14) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths; // hardcoded path data only
  return svg;
}

/**
 * Render the confidence chip as an evidence-strength meter plus a label.
 *
 * The meter carries the level; the chip stays visually neutral. Colouring this
 * chip red/amber/green would put a second traffic light next to the verdict's
 * own, and a green "Jain-friendly" card wearing a red chip reads as a
 * contradiction instead of as "friendly, thinly evidenced".
 */
function renderConfidenceChip(el, rawConfidence) {
  if (!el) return;
  el.replaceChildren();
  const meta = getConfidenceMeta(rawConfidence);
  if (!meta) {
    // Nothing stated by the server. Say nothing rather than invent a level.
    el.className = "confidence-chip";
    el.removeAttribute("title");
    return;
  }

  el.className = `confidence-chip confidence-chip--${meta.key.toLowerCase()}`;
  el.title = meta.detail;

  const meter = document.createElement("span");
  meter.className = "confidence-meter";
  meter.setAttribute("aria-hidden", "true");
  for (let i = 1; i <= 3; i++) {
    const bar = document.createElement("span");
    bar.className = i <= meta.level ? "confidence-bar confidence-bar--on" : "confidence-bar";
    meter.appendChild(bar);
  }

  const label = document.createElement("span");
  label.className = "confidence-chip-label";
  label.textContent = meta.label;

  // Screen readers get the explanation, not just the level name.
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = `: ${meta.detail}`;

  el.append(meter, label, sr);
}

/**
 * Show or clear the evidence caveat under the verdict badge.
 * Returns the element it created, if any.
 */
function renderVerdictCaveat(verdictCard, status, data) {
  verdictCard.querySelector(".verdict-caveat")?.remove();
  const caveat = verdictCaveat(status, data);
  if (!caveat) return null;

  const box = document.createElement("div");
  box.className = `verdict-caveat verdict-caveat--${caveat.tone}`;
  // role="note" not "alert": this is a standing qualification on the verdict,
  // not an error that just occurred. "alert" would interrupt screen readers
  // mid-verdict and frame thin evidence as a failure.
  box.setAttribute("role", "note");
  box.appendChild(makeIcon(
    caveat.tone === "warn"
      ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
      : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
  ));
  const text = document.createElement("span");
  text.textContent = caveat.text;
  box.appendChild(text);
  verdictCard.appendChild(box);
  return box;
}

/**
 * The UNKNOWN panel: a first-class, explained outcome.
 *
 * UNKNOWN is not an error and not a near-miss of a verdict — it is the honest
 * answer when the evidence will not support one. It therefore gets the same
 * structural weight as any other result: what it means, why it happened, and
 * what the user can do next.
 */
function renderUnknownGuidance(show_) {
  const panel = document.getElementById("unknownGuidance");
  if (!panel) return;
  if (!show_) { hide(panel); return; }

  const list = document.getElementById("unknownCauses");
  if (list && !list.childElementCount) {
    UNKNOWN_CAUSES.forEach(cause => {
      const li = document.createElement("li");
      li.textContent = cause;
      list.appendChild(li);
    });
  }
  show(panel);
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
  hide(document.getElementById("unknownGuidance"));
  hide(document.getElementById("ingredientEmpty"));
  document.getElementById("verdictCard")?.querySelector(".verdict-caveat")?.remove();
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

// Count one scan against the anonymous free-scan allowance.
//
// Called ONLY after a real server lookup returned a verdict. Cached renders
// (session cache, Recent-scans clicks, community submissions), not-found,
// network errors and rate-limits must never burn a free scan.
export function countFreeScan(serverRemaining = null) {
  if (Auth.isSignedIn()) return;
  const remaining = recordServerLookup(serverRemaining);
  if (remaining > 0 && remaining < FREE_SCAN_LIMIT) {
    showFreeScanBanner(remaining, _openAuthModalFn);
  }
}

export function displayVerdictData(data, barcode, fromCache = false) {
  _state.currentBarcode = barcode;
  // renderResult runs presentOutcome() exactly once. Do NOT call
  // presentOutcome() again here \u2014 that double-counted the scan.
  // No free scan is counted: this path renders an already-fetched verdict.
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
  scrollVerdictIntoView();
  verdictCard.className = `verdict verdict-${status}`;
  verdictCard.setAttribute("aria-label", `${meta.ariaPrefix} ${data.explain || ""}`);
  verdictIcon.innerHTML = meta.icon;
  statusLabel.textContent = meta.label;
  explainText.textContent = sanitizeText(data.explain) || "No explanation available.";

  // Confidence \u2014 evidence quality, shown in its own visual language so it never
  // competes with the verdict's colour. GREEN is no longer always HIGH.
  renderConfidenceChip(confidenceText, data.confidence);

  // Evidence caveat (thin data / low or medium confidence). Replaces the old
  // "confidence-warning-banner", which only ever fired for LOW *and* no
  // ingredient text \u2014 so a LOW-confidence GREEN with a partial ingredient list
  // was presented with no qualification at all.
  verdictCard.querySelector(".confidence-warning-banner")?.remove();
  renderVerdictCaveat(verdictCard, status, data);

  // UNKNOWN gets a dedicated explanation panel, not an error message.
  renderUnknownGuidance(status === "UNKNOWN");

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
  showCommunitySection(_state.currentBarcode, data.community || null, status);

  // Alternatives — a SINGLE surface (2026-08-24). Fetches Jain-friendly (GREEN)
  // products similar to the rejected one and renders each as a link OUT to that
  // exact product on Amazon (verified /dp page or a precise brand+name search),
  // never an in-app re-scan. It fires only on a RED/ORANGE/YELLOW reject; on a
  // GREEN/UNKNOWN verdict it renders nothing. The old separate affiliate
  // "Recommended alternatives" surface is retired — this is the only one.
  fetchAndRenderAlternatives(
    _state.currentBarcode, data.status, _state.requestId,
    () => _state.requestId
  );
  Monetization.hide();

  // Favorites
  Favorites.onResultDisplayed(_state.currentBarcode);

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

  // Ingredients.
  //
  // With no evidence at all, the four-row breakdown renders as
  // "Animal-derived: None / Uncertain: None / Restricted: None / Friendly:
  // None" — which looks exactly like a completed check that found nothing
  // wrong. Nothing was checked. Say so instead.
  const hasEvidence = hasIngredientEvidence(data);
  const ingredientRaw = document.getElementById("ingredientRawDetails");
  const ingredientRowsEl = document.getElementById("ingredientRows");
  const ingredientEmpty = document.getElementById("ingredientEmpty");

  show(ingredientSection);
  if (hasEvidence) {
    ingredientsText.textContent = sanitizeText(data.ingredients_text) || "Ingredient text not available.";
    toggle(ingredientRaw, String(data.ingredients_text ?? "").trim() !== "");
    show(ingredientRowsEl);
    hide(ingredientEmpty);
    renderIngredientRows(data.ingredient_categories);
  } else {
    ingredientsText.textContent = "";
    hide(ingredientRaw);
    hide(ingredientRowsEl);
    if (ingredientRowsEl) ingredientRowsEl.replaceChildren();
    show(ingredientEmpty);
  }

  presentOutcome();
  // NOTE: free scans are NOT counted here. Rendering is also how cached
  // history entries and community submissions reach the screen; only a real
  // server lookup in fetchVerdict() counts (see countFreeScan).

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
  scrollVerdictIntoView();
  // Not-found and UNKNOWN are different claims and must not look identical.
  // Not-found: this barcode is not in the data set at all.
  // UNKNOWN:   we hold the product but the evidence will not support a verdict.
  verdictCard.className = "verdict verdict-UNKNOWN";
  verdictCard.setAttribute("aria-label", "Product not found in the current data set.");
  verdictIcon.innerHTML = NOT_FOUND_ICON;
  statusLabel.textContent = "Product not found";
  explainText.textContent = "";

  barcodeInfo.textContent = "";
  // Nothing is known about the product, so the (empty) product-detail block is
  // left hidden rather than shown as three blank lines.
  hide(productDetails);
  productNameText.textContent = "";
  brandText.textContent = "";
  renderConfidenceChip(document.getElementById("confidenceText"), null);
  renderUnknownGuidance(false);

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

export async function fetchVerdict(rawBarcode, symbologyHint = null) {
  // Article 9 gate: judging a product against the user's dietary mode is
  // special-category processing. Without essential consent, no verdict request
  // may fire — surface the consent prompt instead. This is the single choke
  // point for every scan path (manual, camera, demo chips, favourites, shared
  // links, history re-fetch), so the gate holds even if a UI entry point misses.
  if (!canScan()) {
    _state.scanLocked = false;
    _state.inFlight = false;
    if (typeof _onNeedConsentFn === "function") _onNeedConsentFn();
    return;
  }

  if (!Auth.isSignedIn() && isFreeScanExhausted()) {
    // Free limit hit: the caller (submit handler / scanner) already set the
    // scan lock. Release it here, otherwise the manual-submit guard swallows
    // every subsequent Check and the button stays dead until reload.
    _state.scanLocked = false;
    _state.inFlight = false;
    _openAuthModalFn("Sign in with Google to keep scanning");
    return;
  }

  const { barcode, symbology, valid } = pickLookupBarcode(rawBarcode, symbologyHint);
  if (!valid) {
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
    // Optional symbology hint — lets the backend tell a genuine EAN-8 from a
    // compressed UPC-E. Backward compatible: a backend that does not know the
    // parameter ignores it, and the raw 8-digit barcode still resolves via the
    // dual-candidate lookup.
    if (symbology && symbology !== "unknown") {
      url.searchParams.set("symbology", symbology);
    }

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
        setFreeScanCount(FREE_SCAN_LIMIT);
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
      // A real server lookup — the only thing that costs a free scan.
      countFreeScan(readServerScansRemaining(resp, data));
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
