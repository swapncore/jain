// Barcode libraries are lazy-loaded on first camera use to cut initial page load (~200KB)
let _BrowserMultiFormatReader = null;
let _DecodeHintType = null;
let _BarcodeFormat = null;
let _BarcodeDetectorPolyfill = null;
let _barcodeLibsLoading = null;

async function _loadBarcodeLibs() {
  if (_barcodeLibsLoading) return _barcodeLibsLoading;
  _barcodeLibsLoading = (async () => {
    // Load ZXing libs first — these MUST succeed (pure JS, no WASM, works on all browsers)
    const [zxingBrowser, zxingLib] = await Promise.all([
      import("https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm"),
      import("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/+esm"),
    ]);
    _BrowserMultiFormatReader = zxingBrowser.BrowserMultiFormatReader;
    _DecodeHintType = zxingLib.DecodeHintType;
    _BarcodeFormat = zxingLib.BarcodeFormat;

    // Load barcode-detector polyfill separately — it uses WASM and can fail on iOS
    // (CSP wasm-unsafe-eval not supported on older iOS versions).
    // A failure here is fine — we fall back to ZXing for all scanning.
    try {
      const barcodeDetMod = await import("https://cdn.jsdelivr.net/npm/barcode-detector@2/+esm");
      _BarcodeDetectorPolyfill = barcodeDetMod.BarcodeDetector;
    } catch {
      _BarcodeDetectorPolyfill = null;
    }
  })();
  // Don't cache failures — a transient network error shouldn't permanently break scanning
  _barcodeLibsLoading.catch(() => { _barcodeLibsLoading = null; });
  return _barcodeLibsLoading;
}

import {
  API_BASE_PROD, API_BASE_DEV,
  REQUEST_TIMEOUT_MS, VERDICT_FAILSAFE_MS,
  ENDPOINTS,
  PROFILES, PROFILE_DEFAULT, PROFILE_KEY,
  STATUS_META as _STATUS_META,
  INGREDIENT_GROUP_META, REASON_LABELS, MESSAGES,
} from "./config/shared-config.js";
import { normalizeBarcode, isValidBarcode as isValidBarcodeUtil } from "./barcode.js";
import * as Auth from "./auth.js?v=3";
import * as Favorites from "./favorites.js";
import * as Monetization from "./monetization.js";
import { handleShare as _handleShare } from "./lib/share.js";
import { historySave, historyPush as _historyPush, syncServerHistory, renderHistory as _renderHistory } from "./lib/history.js";

// ─── Constants ───────────────────────────────────────────────────────────────

// SCAN_FORMATS is initialized lazily after barcode libs load
let SCAN_FORMATS = null;

// ─── Web-only: SVG icons merged into STATUS_META ──────────────────────────────
// Labels, descriptions, and ariaPrefix come from shared/verdicts.json via shared-config.js.
// Icons are SVG strings and are web-specific — kept here, not in shared config.
const STATUS_ICONS = {
  GREEN:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  YELLOW:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  ORANGE:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  RED:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  UNKNOWN: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
};
const STATUS_META = Object.fromEntries(
  Object.entries(_STATUS_META).map(([k, v]) => [k, { ...v, icon: STATUS_ICONS[k] }])
);

// ─── DOM References ───────────────────────────────────────────────────────────

const el = {
  // Scan card
  startCameraBtn:    document.getElementById("startCameraBtn"),
  stopCameraBtn:     document.getElementById("stopCameraBtn"),
  cameraArea:        document.getElementById("cameraArea"),
  scanTriggerArea:   document.getElementById("scanTriggerArea"),
  cameraBlockedMsg:  document.getElementById("cameraBlockedMsg"),
  videoWrap:         document.getElementById("videoWrap"),
  video:             document.getElementById("videoPreview"),
  torchBtn:          document.getElementById("torchBtn"),
  scanStatus:        document.getElementById("scanStatus"),
  progressWrap:      document.getElementById("progressWrap"),
  progressText:      document.getElementById("progressText"),
  messageBox:        document.getElementById("messageBox"),
  manualForm:        document.getElementById("manualForm"),
  manualInput:       document.getElementById("manualBarcode"),
  manualHelp:        document.getElementById("manualHelp"),
  checkBtn:          document.getElementById("checkBtn"),
  newScanBtn:        document.getElementById("newScanBtn"),

  // Result card
  resultSection:     document.getElementById("resultSection"),
  verdictCard:       document.getElementById("verdictCard"),
  verdictBadge:      document.getElementById("verdictBadge"),
  verdictIcon:       document.getElementById("verdictIcon"),
  statusLabel:       document.getElementById("statusLabel"),
  explainText:       document.getElementById("explainText"),
  productDetails:    document.getElementById("productDetails"),
  productNameText:   document.getElementById("productNameText"),
  brandText:         document.getElementById("brandText"),
  barcodeInfo:       document.getElementById("barcodeInfo"),
  reasonChips:       document.getElementById("reasonChips"),
  savedNote:         document.getElementById("savedNote"),
  shareBtn:          document.getElementById("shareBtn"),
  shareToast:        document.getElementById("shareToast"),
  notFoundState:     document.getElementById("notFoundState"),
  ingredientSection: document.getElementById("ingredientSection"),
  ingredientsText:   document.getElementById("ingredientsText"),
  ingredientRows:    document.getElementById("ingredientRows"),
  modeChip:          document.getElementById("modeChip"),

  // Community verification
  communitySection:     document.getElementById("communitySection"),
  communityBadge:       document.getElementById("communityBadge"),
  feedbackPrompt:       document.getElementById("feedbackPrompt"),
  feedbackCorrectBtn:   document.getElementById("feedbackCorrectBtn"),
  feedbackIncorrectBtn: document.getElementById("feedbackIncorrectBtn"),
  feedbackThanks:       document.getElementById("feedbackThanks"),

  // Alternatives
  alternativesSection: document.getElementById("alternativesSection"),
  alternativesBrand:   document.getElementById("alternativesBrand"),
  alternativesList:    document.getElementById("alternativesList"),

  // Offline banner
  offlineBanner: document.getElementById("offlineBanner"),

  // Mode bar (pills rendered dynamically)
  modeBar:           document.getElementById("modeBar"),

  // History
  historySection:    document.getElementById("historySection"),
  historyList:       document.getElementById("historyList"),
  clearHistoryBtn:   document.getElementById("clearHistoryBtn"),

  // Modals
  missingModal:      document.getElementById("missingModal"),
  missingStep1:      document.getElementById("missingStep1"),
  missingCameraArea: document.getElementById("missingCameraArea"),
  missingVideo:      document.getElementById("missingVideo"),
  missingCanvas:     document.getElementById("missingCanvas"),
  missingPreview:    document.getElementById("missingPreview"),
  missingPreviewImg: document.getElementById("missingPreviewImg"),
  missingCaptureBtn: document.getElementById("missingCaptureBtn"),
  missingRetakeBtn:  document.getElementById("missingRetakeBtn"),
  missingFileInput:  document.getElementById("missingFileInput"),
  missingBarcode:    document.getElementById("missingBarcode"),
  missingName:       document.getElementById("missingName"),
  missingFormMsg:    document.getElementById("missingFormMsg"),
  missingSubmitBtn:  document.getElementById("missingSubmitBtn"),
  missingSubmitLabel:document.getElementById("missingSubmitLabel"),
  missingCloseBtn:   document.getElementById("missingCloseBtn"),

  // Auth nav
  signInBtn:         document.getElementById("signInBtn"),
  userMenuBtn:       document.getElementById("userMenuBtn"),
  userAvatar:        document.getElementById("userAvatar"),
  userName:          document.getElementById("userName"),

  // Auth modal
  authModal:         document.getElementById("authModal"),
  authModalClose:    document.getElementById("authModalClose"),
  googleSignInBtn:   document.getElementById("googleSignInBtn"),
  authModalError:    document.getElementById("authModalError"),

  // User dropdown
  userDropdown:      document.getElementById("userDropdown"),
  userDropdownEmail: document.getElementById("userDropdownEmail"),
  dropdownSignOutBtn:document.getElementById("dropdownSignOutBtn"),

  // Email preferences in dropdown
  emailPrefBanner:   document.getElementById("emailPrefBanner"),
  emailPrefCheckbox: document.getElementById("emailPrefCheckbox"),

  // Favorite button (in result card)
  favoriteBtn:       document.getElementById("favoriteBtn"),
  favoriteBtnText:   document.getElementById("favoriteBtnText"),
};

// ─── Verdict session cache (instant re-scan within 24hrs) ─────────────────────
const _verdictCache = new Map();

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  reader:              null,
  controls:            null,
  torchOn:             false,
  inFlight:            false,
  scanLocked:          false,
  requestId:           0,
  verdictFailsafeTimer:null,
  lastBarcode:         "",
  lastScanAt:          0,
  pendingBarcode:      "",
  pendingCount:        0,
  currentBarcode:      "",   // barcode shown in result card
  missingPhotoData:    null, // base64 string of captured image for missing modal
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function getApiBase() {
  const h = window.location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? API_BASE_DEV : API_BASE_PROD;
}

function getClientId() {
  const KEY = "JAIN_CLIENT_ID";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (window.crypto?.randomUUID?.()) ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.floor(Math.random() * 16);
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
    localStorage.setItem(KEY, id);
  }
  return id;
}

function getActiveProfile() {
  const stored = localStorage.getItem(PROFILE_KEY);
  return PROFILES.some(p => p.id === stored) ? stored : PROFILE_DEFAULT;
}

function setActiveProfile(profileId) {
  if (!PROFILES.some(p => p.id === profileId)) return;
  localStorage.setItem(PROFILE_KEY, profileId);
  // Update pill UI
  document.querySelectorAll(".mode-pill").forEach(btn => {
    const active = btn.dataset.profile === profileId;
    btn.classList.toggle("mode-pill--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function initProfileSelector() {
  const bar = el.modeBar;
  if (!bar) return;

  // Label
  const lbl = document.createElement("span");
  lbl.className = "mode-bar-label";
  lbl.textContent = "Mode:";
  bar.appendChild(lbl);

  const current = getActiveProfile();
  PROFILES.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-pill";
    btn.dataset.profile = p.id;
    btn.textContent = p.label;
    btn.title = p.desc;
    const active = p.id === current;
    btn.classList.toggle("mode-pill--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.addEventListener("click", () => {
      const prev = getActiveProfile();
      setActiveProfile(p.id);
      // Re-fetch verdict if a result is currently displayed
      if (prev !== p.id && state.lastBarcode && !el.resultSection?.classList.contains("hidden")) {
        fetchVerdict(state.lastBarcode);
      }
    });
    bar.appendChild(btn);
  });
}

// ─── Share (delegated to lib/share.js) ─────────────────────────────────────────

let _shareToastTimer = null;
function showShareToast(msg, ms = 3000) {
  if (!el.shareToast) return;
  el.shareToast.textContent = msg;
  el.shareToast.classList.add("share-toast--visible");
  clearTimeout(_shareToastTimer);
  _shareToastTimer = setTimeout(() => {
    if (el.shareToast) {
      el.shareToast.classList.remove("share-toast--visible");
      el.shareToast.textContent = "";
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

// ─── Scan history (delegated to lib/history.js) ──────────────────────────────

function historyPush(entry) {
  _historyPush(entry, renderHistory);
}

function renderHistory() {
  _renderHistory({
    section: el.historySection,
    list: el.historyList,
    show, hide,
    getActiveProfile,
    state,
    onRescan: (barcode, verdictData, entryProfile) => {
      if (verdictData && entryProfile === getActiveProfile()) {
        clearMessage();
        hideResult();
        stopScanning();
        renderResult(verdictData);
      } else {
        fetchVerdict(barcode).catch(() => renderError(MESSAGES.genericError));
      }
    },
  });
}

async function _syncServerHistory() {
  return syncServerHistory(getApiBase(), renderHistory);
}

// ─── Community verification ───────────────────────────────────────────────────

const FEEDBACK_KEY = "JAIN_FEEDBACK";   // {"barcode:profile": signal} voted barcodes

function feedbackLoadVoted() {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "{}"); }
  catch { return {}; }
}

function feedbackMarkVoted(barcode, signal) {
  const voted = feedbackLoadVoted();
  const key = `${barcode}:${getActiveProfile()}`;
  voted[key] = signal;
  // Prune to last 200 entries
  const keys = Object.keys(voted);
  if (keys.length > 200) {
    const pruned = {};
    keys.slice(-200).forEach(k => { pruned[k] = voted[k]; });
    try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(pruned)); } catch {}
  } else {
    try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(voted)); } catch {}
  }
}

function renderCommunityBadge(community) {
  if (!el.communityBadge) return;
  if (!community || community.total < 5) {
    hide(el.communityBadge);
    return;
  }
  const { total, correct, correct_pct } = community;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  // SVG inner content is hardcoded (safe)
  svg.innerHTML = correct_pct >= 70
    ? '<polyline points="20 6 9 17 4 12"/>'
    : '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
  const label = correct_pct >= 70
    ? `${correct} of ${total} users confirmed`
    : `${total - correct} of ${total} users flagged`;
  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  el.communityBadge.replaceChildren(svg, document.createTextNode(" "), labelSpan);
  el.communityBadge.className = `community-badge community-badge--${correct_pct >= 70 ? "confirmed" : "flagged"}`;
  show(el.communityBadge);
}

function showCommunitySection(barcode, community) {
  if (!el.communitySection) return;

  // Show badge if community data exists
  renderCommunityBadge(community);

  // Show feedback prompt if not yet voted (keyed by barcode:profile)
  const voted = feedbackLoadVoted();
  const voteKey = `${barcode}:${getActiveProfile()}`;
  if (barcode && !voted[voteKey]) {
    show(el.feedbackPrompt);
    hide(el.feedbackThanks);
  } else {
    hide(el.feedbackPrompt);
    if (voted[voteKey]) {
      el.feedbackThanks.textContent = voted[voteKey] === "correct"
        ? "Thanks for confirming."
        : "Thanks for flagging — we'll review.";
      show(el.feedbackThanks);
    }
  }

  show(el.communitySection);
}

function hideCommunitySection() {
  hide(el.communitySection);
  hide(el.communityBadge);
  hide(el.feedbackPrompt);
  hide(el.feedbackThanks);
}

async function submitFeedback(barcode, signal) {
  const profile = getActiveProfile();
  hide(el.feedbackPrompt);
  feedbackMarkVoted(barcode, signal);
  el.feedbackThanks.textContent = signal === "correct"
    ? "Thanks for confirming."
    : "Thanks for flagging — we'll review.";
  show(el.feedbackThanks);

  try {
    const resp = await fetchWithTimeout(
      `${getApiBase()}${ENDPOINTS.feedback}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
        body: JSON.stringify({ barcode, profile, signal }),
      },
      REQUEST_TIMEOUT_MS,
    );
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (data.community) renderCommunityBadge(data.community);
    } else {
      // Server rejected — revert optimistic UI
      el.feedbackThanks.textContent = "Could not save your vote. Please try again.";
      el.feedbackThanks.classList.add("feedback-thanks--error");
      // Re-show prompt after a delay so user can retry
      setTimeout(() => {
        const voted = feedbackLoadVoted();
        delete voted[`${barcode}:${profile}`];
        try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(voted)); } catch {}
        hide(el.feedbackThanks);
        el.feedbackThanks.classList.remove("feedback-thanks--error");
        show(el.feedbackPrompt);
      }, 3000);
    }
  } catch {
    // Network error — revert optimistic UI
    el.feedbackThanks.textContent = "Network error — vote not saved.";
    el.feedbackThanks.classList.add("feedback-thanks--error");
    setTimeout(() => {
      const voted = feedbackLoadVoted();
      delete voted[`${barcode}:${profile}`];
      try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(voted)); } catch {}
      hide(el.feedbackThanks);
      el.feedbackThanks.classList.remove("feedback-thanks--error");
      show(el.feedbackPrompt);
    }, 3000);
    reportClientEvent("feedback_failed", { barcode, error_msg: "network_error" });
  }
}

// ─── Client failure telemetry ──────────────────────────────────────────────

async function reportClientEvent(eventType, opts = {}) {
  // opts: { barcode, profile, error_code, error_msg, response_ms }
  try {
    await fetchWithTimeout(`${getApiBase()}${ENDPOINTS.client_event}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
      body: JSON.stringify({
        event_type: eventType,
        barcode: opts.barcode || state.currentBarcode || undefined,
        profile: opts.profile || getActiveProfile(),
        error_code: opts.error_code,
        error_msg: opts.error_msg,
        response_ms: opts.response_ms,
      }),
    }, REQUEST_TIMEOUT_MS);
  } catch { /* fire-and-forget, never throw */ }
}

// ─── Alternatives ─────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function triggerManualBarcode(barcode) {
  if (el.manualInput) {
    el.manualInput.value = barcode;
    fetchVerdict(barcode).catch(() => renderError(MESSAGES.genericError));
  }
}

function hideAlternatives() {
  hide(el.alternativesSection);
  if (el.alternativesList) el.alternativesList.replaceChildren();
  if (el.alternativesBrand) el.alternativesBrand.textContent = "";
}

async function fetchAndRenderAlternatives(barcode, status) {
  if (status !== "RED" && status !== "ORANGE" && status !== "YELLOW") { hideAlternatives(); return; }
  if (!el.alternativesSection) return;
  const reqId = state.requestId;   // capture NOW before any await

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

    if (reqId !== state.requestId) return;  // a newer scan has started

    el.alternativesList.replaceChildren();
    alts.forEach(a => {
      const safeStatus = ["green","yellow","orange","red"].includes((a.status||"").toLowerCase()) ? a.status.toLowerCase() : "unknown";
      const label = STATUS_META[(a.status||"").toUpperCase()]?.label || a.status;

      const li = document.createElement("li");
      li.className = "alternatives-item";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alt-scan-btn";
      btn.dataset.barcode = a.barcode || "";
      btn.setAttribute("aria-label", `Scan ${a.product_name || ""}`);

      const badge = document.createElement("span");
      badge.className = `alt-badge alt-badge--${safeStatus}`;
      badge.textContent = label;

      const name = document.createElement("span");
      name.className = "alt-name";
      name.textContent = a.product_name || "";

      btn.appendChild(badge);
      btn.appendChild(name);

      if (a.brand) {
        const brandSpan = document.createElement("span");
        brandSpan.className = "alt-brand";
        brandSpan.textContent = a.brand;
        btn.appendChild(brandSpan);
      }

      li.appendChild(btn);
      el.alternativesList.appendChild(li);
    });

    // Bind click handlers
    el.alternativesList.querySelectorAll(".alt-scan-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const bc = btn.dataset.barcode;
        if (bc) triggerManualBarcode(bc);
      });
    });

    if (data.based_on === "brand" && alts[0]?.brand) {
      el.alternativesBrand.textContent = `from ${alts[0].brand}`;
    }
    show(el.alternativesSection);
  } catch { /* fire-and-forget */ }
}

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function show(el)  { el?.classList.remove("hidden"); }
function hide(el)  { el?.classList.add("hidden"); }
function toggle(el, on) { el?.classList.toggle("hidden", !on); }

function setLoading(active, text = "Looking up product…") {
  toggle(el.progressWrap, active);
  el.progressText.textContent = text;
  if (el.checkBtn) el.checkBtn.disabled = active || !isManualValid();
}

function clearMessage() {
  el.messageBox.className = "notice hidden";
  el.messageBox.replaceChildren();
}

function showMessage({ message, variant = "info", domContent = null }) {
  el.messageBox.className = `notice notice-${variant}`;

  const iconSvgs = {
    error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    warn:  '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info:  '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  };

  // Build icon via DOM (no innerHTML for untrusted content)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "notice-icon");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  // SVG inner content is hardcoded (safe)
  svg.innerHTML = iconSvgs[variant] || iconSvgs.info;

  const wrapper = document.createElement("div");

  if (domContent) {
    // Pre-built DOM node (e.g. from renderRateLimit) — no innerHTML needed
    wrapper.appendChild(domContent);
  } else {
    const p = document.createElement("p");
    p.textContent = message;
    wrapper.appendChild(p);
  }

  el.messageBox.replaceChildren(svg, wrapper);
  show(el.messageBox);
}

function showVerdictSkeleton() {
  // Show the result section with a skeleton placeholder
  show(el.resultSection);
  el.verdictCard.className = "verdict verdict-skeleton-wrap";
  el.verdictCard.innerHTML = `
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
  hide(el.productDetails);
  hide(el.ingredientSection);
  hide(el.notFoundState);
  el.reasonChips.innerHTML = "";
  hideCommunitySection();
  hideAlternatives();
  Favorites.hideButton();
  hide(el.shareBtn);
  Monetization.hide();
}

function restoreVerdictCard() {
  // Restore the verdict card's normal DOM structure after skeleton
  el.verdictCard.className = "verdict verdict-UNKNOWN";
  el.verdictCard.innerHTML = "";
  el.verdictCard.setAttribute("role", "status");

  // Rebuild normal DOM elements
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

  el.verdictCard.appendChild(badge);
  el.verdictCard.appendChild(explain);
  el.verdictCard.appendChild(metaRow);

  // Re-bind element references
  el.verdictBadge = badge;
  el.verdictIcon = icon;
  el.statusLabel = label;
  el.explainText = explain;
  el.confidenceText = conf;
  el.modeChip = modeChip;
}

function hideResult() {
  hide(el.resultSection);
  hide(el.notFoundState);
  hide(el.ingredientSection);
  hide(el.productDetails);
  hide(el.shareBtn);
  hideCommunitySection();
  hideAlternatives();
  Favorites.hideButton();
  Monetization.hide();
  el.reasonChips.replaceChildren();
  el.savedNote.textContent = "";
  state.currentBarcode = "";
}

// ─── Manual input validation ─────────────────────────────────────────────────

function isManualValid() {
  return isValidBarcodeUtil(el.manualInput.value);
}

function updateManualState() {
  const raw = el.manualInput.value;
  const result = normalizeBarcode(raw);
  const hadNonNumeric = raw !== result.cleaned && raw.length > 0;

  el.manualInput.value = result.cleaned;

  let help = "";
  let isError = false;

  if (hadNonNumeric) {
    help = "Only numbers are allowed. Spaces and hyphens are removed automatically.";
    isError = true;
  } else if (result.cleaned.length > 13) {
    help = `Too many digits (${result.cleaned.length}). Barcodes are 8, 12, or 13 digits.`;
    isError = true;
  } else if (result.symbology === "UPC-E") {
    const tag = result.checksumValid === false ? " (invalid check digit)" : "";
    help = `UPC-E detected. 8 digits ✓${tag}`;
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
    help = `UPC-A detected. 12 digits ✓${tag}`;
  } else if (result.symbology === "EAN-13") {
    const tag = result.checksumValid === false ? " (invalid check digit)" : "";
    help = `EAN-13 detected. 13 digits ✓${tag}`;
  }

  el.manualHelp.textContent = help;
  el.manualHelp.classList.toggle("field-help-error", isError && result.cleaned.length > 0);
  el.manualInput.setAttribute("aria-invalid", isError ? "true" : "false");
  if (el.checkBtn) el.checkBtn.disabled = !isManualValid() || state.inFlight;

  return isManualValid();
}

// ─── Verdict failsafe ─────────────────────────────────────────────────────────

function clearFailsafe() {
  if (state.verdictFailsafeTimer) { clearTimeout(state.verdictFailsafeTimer); state.verdictFailsafeTimer = null; }
}

function startFailsafe(reqId) {
  clearFailsafe();
  state.verdictFailsafeTimer = setTimeout(() => {
    if (reqId !== state.requestId || !state.inFlight) return;
    state.inFlight = false;
    renderError(MESSAGES.scannerStalled);
    el.scanStatus.textContent = "Lookup stalled. Please try again.";
    reportClientEvent("scan_timeout", { response_ms: VERDICT_FAILSAFE_MS });
  }, VERDICT_FAILSAFE_MS);
}

// ─── Result rendering ─────────────────────────────────────────────────────────

function renderIngredientRows(categories) {
  el.ingredientRows.innerHTML = "";
  const order = ["RED", "ORANGE", "YELLOW", "GREEN"];

  order.forEach(level => {
    const rawItems = Array.isArray(categories?.[level]) ? categories[level] : [];
    const meta     = INGREDIENT_GROUP_META[level];

    // Strip stray leading/trailing parens, commas, semicolons from ingredient names
    // (backend sub-ingredient parsing can produce e.g. "NATURAL FLAVOR)" or "DARK CHOCOLATE (SUGAR")
    // and deduplicate after cleaning.
    const seenClean = new Set();
    const items = rawItems.filter(n => n != null).map(n => String(n).replace(/^[\s,();]+|[\s,();]+$/g, "").trim()).filter(n => {
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
        nameEl.textContent = name;
        const reasonEl = document.createElement("span");
        reasonEl.className = "ingredient-reason";
        reasonEl.textContent = meta.reason;
        row.appendChild(nameEl);
        row.appendChild(reasonEl);
        itemsEl.appendChild(row);
      });
      group.appendChild(itemsEl);
    }

    el.ingredientRows.appendChild(group);
  });
}

/**
 * Display cached verdict data instantly (no network request).
 * Shows a "From recent scan" badge to indicate it's from cache.
 */
function displayVerdictData(data, barcode, fromCache = false) {
  state.currentBarcode = barcode;
  renderResult(data);
  presentOutcome();
  // Show cached indicator
  if (fromCache && el.savedNote) {
    el.savedNote.textContent = "\u21BB From your recent scan";
  }
  // Reset lock/inflight so the scanner is not permanently locked after cached verdict
  state.scanLocked = false;
  state.inFlight = false;
}

function renderResult(data) {
  clearMessage();
  setLoading(false);

  // Restore normal verdict card DOM if skeleton was shown
  if (el.verdictCard.classList.contains("verdict-skeleton-wrap")) {
    restoreVerdictCard();
  }

  hideResult();

  const status = STATUS_META[data.status] ? data.status : "UNKNOWN";
  const meta   = STATUS_META[status];
  state.currentBarcode = data.barcode || "";

  // Haptic feedback — subtle tactile response for verdict
  if (navigator.vibrate) {
    const haptics = { GREEN: [30], YELLOW: [30, 50, 30], ORANGE: [30, 50, 30], RED: [80] };
    const pattern = haptics[status];
    if (pattern) try { navigator.vibrate(pattern); } catch {}
  }

  // Verdict block
  show(el.resultSection);
  el.resultSection.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.verdictCard.className = `verdict verdict-${status}`;
  el.verdictCard.setAttribute("aria-label", `${meta.ariaPrefix} ${data.explain || ""}`);
  el.verdictIcon.innerHTML  = meta.icon;
  el.statusLabel.textContent = meta.label;
  el.explainText.textContent = data.explain || "No explanation available.";

  // Confidence chip — shows how confident the verdict is
  if (el.confidenceText) {
    const conf = (data.confidence || "").toUpperCase();
    if (conf === "HIGH" || conf === "MED" || conf === "LOW") {
      const displayConf = conf === "MED" ? "Medium" : conf.charAt(0) + conf.slice(1).toLowerCase();
      el.confidenceText.textContent = displayConf + " confidence";
      const cssClass = conf === "MED" ? "medium" : conf.toLowerCase();
      el.confidenceText.className = "confidence-chip conf-" + cssClass;
    } else {
      el.confidenceText.textContent = "";
      el.confidenceText.className = "confidence-chip";
    }
  }

  // Low-confidence warning banner when no ingredient data is available
  const existingWarning = el.verdictCard.querySelector(".confidence-warning-banner");
  if (existingWarning) existingWarning.remove();
  if (
    (data.confidence || "").toUpperCase() === "LOW" &&
    (!data.ingredients_text || data.ingredients_text.trim() === "")
  ) {
    const banner = document.createElement("div");
    banner.className = "confidence-warning-banner";
    banner.setAttribute("role", "alert");
    banner.textContent = "\u26A0\uFE0F No ingredient data available \u2014 this verdict cannot be confirmed. Please check the product label.";
    el.verdictCard.appendChild(banner);
  }

  // Mode chip — shows which strictness was used
  if (el.modeChip) {
    const activeProfile = PROFILES.find(p => p.id === getActiveProfile());
    el.modeChip.textContent = activeProfile ? `${activeProfile.label} mode` : "";
  }

  // Product metadata
  if (data.product_name || data.brand) {
    show(el.productDetails);
    el.productNameText.textContent = data.product_name || "Product name unknown";
    el.brandText.textContent       = data.brand ? `Brand: ${data.brand}` : "";
    el.barcodeInfo.textContent     = "";
  }

  // Reason chips
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  el.reasonChips.replaceChildren();
  reasons.filter(r => r != null).forEach(r => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.setAttribute("role", "listitem");
    chip.textContent = REASON_LABELS[r] || String(r).replace(/_/g, " ").toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
    chip.setAttribute("title", r);  // show raw code on hover for debugging
    el.reasonChips.appendChild(chip);
  });

  // Community verification section
  showCommunitySection(state.currentBarcode, data.community || null);

  // Jain-friendly alternatives (for RED/ORANGE)
  fetchAndRenderAlternatives(state.currentBarcode, data.status);

  // Favorites: update save button for this product
  Favorites.onResultDisplayed(state.currentBarcode);

  // Monetization: show sponsored cards if available
  Monetization.showForVerdict(state.currentBarcode, data.status);

  // Persist to scan history (cache full verdict for instant replay)
  historyPush({
    barcode:      state.currentBarcode,
    status:       status,
    product_name: data.product_name || "",
    brand:        data.brand || "",
    profile:      getActiveProfile(),
    ts:           new Date().toISOString(),
    verdictData:  {
      status: data.status, explain: data.explain, product_name: data.product_name,
      brand: data.brand, reasons: data.reasons, barcode: data.barcode,
      confidence: data.confidence, exactness: data.exactness,
    },
  });

  // Saved banner
  el.savedNote.textContent = data.saved ? "✓ Saved for future scans" : "";

  // Share button — store all card data for image generation
  if (el.shareBtn && state.currentBarcode) {
    el.shareBtn.dataset.barcode  = state.currentBarcode;
    el.shareBtn.dataset.status   = status;
    el.shareBtn.dataset.name     = data.product_name || "";
    el.shareBtn.dataset.brand    = data.brand || "";
    el.shareBtn.dataset.reasons  = JSON.stringify(data.reasons || []);
    el.shareBtn.dataset.explain  = data.explain || "";
    show(el.shareBtn);
  }

  // Ingredients
  show(el.ingredientSection);
  el.ingredientsText.textContent = data.ingredients_text || "Ingredient text not available.";
  renderIngredientRows(data.ingredient_categories);

  presentOutcome();

  // First-scan celebration — show once ever
  if (!localStorage.getItem("JAINI_FIRST_SCAN_DONE")) {
    localStorage.setItem("JAINI_FIRST_SCAN_DONE", "1");
    showFirstScanCelebration();
  }
}

function showFirstScanCelebration() {
  const toast = document.createElement("div");
  toast.className = "first-scan-toast";
  toast.setAttribute("role", "status");
  toast.innerHTML = '<span class="first-scan-confetti">&#127881;</span> You\'re all set! Scan any product to check if it\'s Jain-friendly.';
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function renderNotFound(barcode) {
  clearMessage();
  setLoading(false);
  if (el.verdictCard.classList.contains("verdict-skeleton-wrap")) {
    restoreVerdictCard();
  }
  hideResult();

  state.currentBarcode = barcode;
  show(el.resultSection);
  el.resultSection.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.verdictCard.className = "verdict verdict-UNKNOWN";
  el.verdictIcon.innerHTML  = STATUS_META.UNKNOWN.icon;
  el.statusLabel.textContent = STATUS_META.UNKNOWN.label;
  el.explainText.textContent = "";

  el.barcodeInfo.textContent = "";
  show(el.productDetails);
  el.productNameText.textContent = "";
  el.brandText.textContent = "";

  show(el.notFoundState);
  // Pre-fill missing modal
  if (el.missingBarcode) el.missingBarcode.value = barcode;

  presentOutcome();
}

function renderRateLimit(data) {
  clearMessage();
  setLoading(false);
  hideResult();
  const count = String(data?.count ?? "?");
  const limit = String(data?.limit ?? "?");
  const reset = String(data?.reset ?? "unknown");

  // Build the message using safe DOM APIs instead of innerHTML
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

function renderError(message) {
  // Preserve the barcode before hideResult() clears it
  const retryBarcode = state.currentBarcode;

  clearMessage();
  setLoading(false);
  if (el.verdictCard.classList.contains("verdict-skeleton-wrap")) {
    restoreVerdictCard();
  }
  hideResult();

  if (retryBarcode) {
    // Build error message with retry button
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

function presentOutcome() {
  stopScanning();
  clearFailsafe();
  setLoading(false);
  hide(el.cameraArea);
  hide(el.scanTriggerArea);
  show(el.newScanBtn);
  updateManualState();
  // Track free scans for anonymous users
  if (!Auth.isSignedIn()) {
    const count = incrementFreeScanCount();
    const remaining = Math.max(0, FREE_SCAN_LIMIT - count);
    if (remaining > 0 && remaining < FREE_SCAN_LIMIT) {
      showFreeScanBanner(remaining);
    }
  }
}

function showFreeScanBanner(remaining) {
  // Show a subtle inline banner with scans remaining
  const existingBanner = document.getElementById("freeScanBanner");
  if (existingBanner) existingBanner.remove();

  const banner = document.createElement("div");
  banner.id = "freeScanBanner";
  banner.className = "free-scan-banner";
  banner.setAttribute("role", "status");

  const text = document.createElement("span");
  text.textContent = remaining === 1
    ? "1 free scan remaining. "
    : `${remaining} free scans remaining. `;

  const link = document.createElement("button");
  link.type = "button";
  link.className = "free-scan-signin";
  link.textContent = "Sign in for unlimited scans";
  link.addEventListener("click", () => {
    openAuthModal("Sign in with Google for unlimited scans");
    banner.remove();
  });

  banner.appendChild(text);
  banner.appendChild(link);

  // Insert after result section
  const insertTarget = el.resultSection || el.messageBox;
  if (insertTarget?.parentNode) {
    insertTarget.parentNode.insertBefore(banner, insertTarget.nextSibling);
  }

  // Auto-dismiss after 8 seconds
  setTimeout(() => { banner.classList.add("free-scan-banner--fade"); }, 7000);
  setTimeout(() => { banner.remove(); }, 8000);
}

// ─── Network ──────────────────────────────────────────────────────────────────

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

async function fetchVerdict(rawBarcode) {
  // Anonymous users get 3 free scans, then must sign in
  if (!Auth.isSignedIn() && getFreeScanCount() >= FREE_SCAN_LIMIT) {
    openAuthModal("Sign in with Google to keep scanning");
    return;
  }

  const normalized = normalizeBarcode(rawBarcode);
  // Use expanded UPC-A for API lookup (UPC-E → 12-digit), otherwise cleaned digits
  const barcode = normalized.upc12 || normalized.ean13 || normalized.cleaned;
  if (barcode.length !== 12 && barcode.length !== 13) {
    updateManualState();
    showMessage({ variant: "error", message: MESSAGES.invalidBarcode });
    return;
  }

  // Instant re-scan: check session cache for recent verdicts
  const cacheKey = `${barcode}:${getActiveProfile()}`;
  const cached = _verdictCache.get(cacheKey);
  if (cached && (Date.now() - cached._cachedAt) < 86400000) { // 24hr TTL
    // Refresh access time for LRU eviction — delete and re-set moves to end of Map
    _verdictCache.delete(cacheKey);
    _verdictCache.set(cacheKey, { ...cached, _cachedAt: Date.now() });
    state.scanLocked = true;
    clearMessage();
    hideResult();
    displayVerdictData(cached, barcode, true);
    // displayVerdictData resets scanLocked/inFlight; early return skips finally block
    return;
  }

  const reqId = ++state.requestId;
  state.inFlight  = true;
  state.scanLocked = true;

  clearMessage();
  hideResult();
  setLoading(true, `Looking up barcode ${barcode}…`);
  showVerdictSkeleton();
  el.scanStatus && (el.scanStatus.textContent = `Looking up ${barcode}…`);
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
      if (reqId !== state.requestId) return;
      renderError(err?.name === "AbortError" ? MESSAGES.timeout : MESSAGES.network);
      el.scanStatus && (el.scanStatus.textContent = err?.name === "AbortError" ? "Request timed out." : "Network error.");
      reportClientEvent("api_error", {
        error_code: "network",
        error_msg: err?.message || "network",
        response_ms: Date.now() - tStart,
      });
      return;
    }

    if (reqId !== state.requestId) return;
    const data = await resp.json().catch(() => ({}));
    if (reqId !== state.requestId) return;

    if (resp.status === 401) {
      if (data.error === "AUTH_REQUIRED" && !Auth.isSignedIn()) {
        // Free scan limit exhausted — sync client counter and show auth gate
        localStorage.setItem(FREE_SCAN_KEY, String(FREE_SCAN_LIMIT));
        openAuthModal(data.message || "Sign in with Google to keep scanning");
        presentOutcome();
        return;
      }
      // Signed-in user with expired token
      openAuthModal();
      presentOutcome();
      showMessage({ variant: "warn", message: "Your session expired. Please sign in again." });
      return;
    }

    if (resp.ok) {
      // Cache for instant re-scan
      const ck = `${barcode}:${getActiveProfile()}`;
      _verdictCache.set(ck, { ...data, _cachedAt: Date.now() });
      // LRU eviction: keep cache bounded at 50 entries
      if (_verdictCache.size > 50) {
        const oldest = _verdictCache.keys().next().value;
        _verdictCache.delete(oldest);
      }
      renderResult(data);
      el.scanStatus && (el.scanStatus.textContent = `Scan complete: ${barcode}`);
      return;
    }

    if (resp.status === 404 && data.error === "NOT_FOUND") {
      renderNotFound(barcode);
      el.scanStatus && (el.scanStatus.textContent = `Barcode ${barcode} not found in dataset.`);
      return;
    }

    if (resp.status === 429 && data.error === "RATE_LIMIT") {
      renderRateLimit(data);
      el.scanStatus && (el.scanStatus.textContent = "Daily lookup limit reached.");
      return;
    }

    renderError(MESSAGES.network);
    el.scanStatus && (el.scanStatus.textContent = "Lookup failed.");
    reportClientEvent("api_error", {
      error_code: String(resp?.status || "network"),
      error_msg: data?.error || data?.message || "",
      response_ms: Date.now() - tStart,
    });

  } catch {
    if (reqId !== state.requestId) return;
    renderError(MESSAGES.network);
  } finally {
    state.inFlight   = false;
    state.scanLocked = false;
    if (reqId === state.requestId) {
      clearFailsafe();
      setLoading(false);
      updateManualState();
    }
  }
}

// ─── Camera ───────────────────────────────────────────────────────────────────

function onDecodedText(text) {
  if (state.scanLocked || state.inFlight) return;
  const normalized = normalizeBarcode(text);
  const digits = normalized.upc12 || normalized.ean13 || normalized.cleaned;
  if (digits.length !== 8 && digits.length !== 12 && digits.length !== 13) return;

  const now = Date.now();
  if (digits === state.lastBarcode && now - state.lastScanAt < 1200) return;

  // Require 2 consecutive identical reads - filters single-frame misreads
  if (digits !== state.pendingBarcode) {
    state.pendingBarcode = digits;
    state.pendingCount   = 1;
    el.scanStatus && (el.scanStatus.textContent = `Detected ${digits}... confirming`);
    return;
  }
  state.pendingCount++;
  if (state.pendingCount < 2) return;

  state.pendingBarcode = "";
  state.pendingCount   = 0;
  state.lastBarcode    = digits;
  state.lastScanAt     = now;
  state.scanLocked     = true;

  el.scanStatus && (el.scanStatus.textContent = `Barcode ${digits} confirmed. Looking up...`);
  fetchVerdict(digits).catch(() => renderError(MESSAGES.network));
}

async function pickBackCamera() {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const vids = devs.filter(d => d.kind === "videoinput");
    // Only return an explicit back/rear/environment camera — never fall back to
    // vids[0] because that is often the front camera on phones.
    // When null is returned, startScanning uses facingMode:"environment" instead.
    const back = vids.find(d => /back|rear|environment/i.test(d.label || ""));
    return back?.deviceId || null;
  } catch { return null; }
}

function getActiveTrack() {
  return el.video?.srcObject?.getVideoTracks?.()[0] ?? null;
}

async function setupTorch() {
  const track = getActiveTrack();
  if (!track) return;
  const caps = track.getCapabilities?.();
  if (!caps?.torch) return;
  show(el.torchBtn);
  state.torchOn = false;
}

async function applyTorch(on) {
  const track = getActiveTrack();
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    state.torchOn = on;
    el.torchBtn.classList.toggle("torch-on", on);
  } catch {
    hide(el.torchBtn);
  }
}

function resetTorch() {
  state.torchOn = false;
  hide(el.torchBtn);
  el.torchBtn?.classList.remove("torch-on");
}

// ─── Native BarcodeDetector scanning (supports UPC-E) ────────────────────────

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

// DetectorImpl is resolved lazily after barcode libs load
// Returns null if neither native API nor polyfill is available (ZXing will be used instead)
function _getDetectorImpl() {
  if (typeof globalThis.BarcodeDetector !== "undefined") return globalThis.BarcodeDetector;
  return _BarcodeDetectorPolyfill; // may be null if polyfill failed to load
}

async function startNativeScanning(stream) {
  const DetectorImpl = _getDetectorImpl();
  if (!DetectorImpl) return false;   // polyfill failed to load — use ZXing
  const supported = await DetectorImpl.getSupportedFormats();
  const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
  if (!formats.length) return false;              // fallback to ZXing

  const detector = new DetectorImpl({ formats });
  state._nativeDetector = detector;

  el.video.srcObject = stream;
  await el.video.play();

  let running = true;
  state._nativeScanStop = () => { running = false; };

  const SCAN_INTERVAL_MS = 50; // ~20fps — faster detection on mobile
  const tick = async () => {
    if (!running) return;
    try {
      const barcodes = await detector.detect(el.video);
      for (const bc of barcodes) {
        onDecodedText(bc.rawValue);
      }
    } catch { /* frame not ready */ }
    if (running) setTimeout(tick, SCAN_INTERVAL_MS);
  };
  setTimeout(tick, SCAN_INTERVAL_MS);
  return true;
}

// ─── Start scanning (native BarcodeDetector → ZXing fallback) ────────────────

async function startScanning() {
  if (state.controls || state._nativeScanStop) return;

  // Lazy-load barcode libraries on first camera use
  try {
    await _loadBarcodeLibs();
    if (!SCAN_FORMATS) {
      SCAN_FORMATS = [_BarcodeFormat.EAN_13, _BarcodeFormat.EAN_8, _BarcodeFormat.UPC_A, _BarcodeFormat.UPC_E];
    }
  } catch (e) {
    console.error("Failed to load barcode scanning libraries", e);
    showMessage({ variant: "error", message: MESSAGES.cameraUnsupported });
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    hide(el.cameraArea);
    show(el.cameraBlockedMsg);
    reportClientEvent("camera_error", { error_msg: "permission_denied" });
    return;
  }

  clearMessage();
  hide(el.cameraBlockedMsg);
  hide(el.newScanBtn);
  show(el.cameraArea);
  hide(el.scanTriggerArea);
  state.scanLocked = false;

  try {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isMobile = isIOS || /Mobi|Android/i.test(navigator.userAgent);
    const idealW = isMobile ? 1280 : 1920;
    const idealH = isMobile ? 720  : 1080;

    const deviceId = await pickBackCamera();

    // iOS doesn't support focusMode constraint
    const videoConstraints = isIOS
      ? (deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: idealW, min: 640 }, height: { ideal: idealH, min: 480 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: idealW, min: 640 }, height: { ideal: idealH, min: 480 } })
      : (deviceId
          ? { deviceId: { exact: deviceId }, focusMode: { ideal: "continuous" }, width: { ideal: idealW, min: 640 }, height: { ideal: idealH, min: 480 } }
          : { facingMode: { ideal: "environment" }, focusMode: { ideal: "continuous" }, width: { ideal: idealW, min: 640 }, height: { ideal: idealH, min: 480 } });

    // ── iOS: manual decode loop ──────────────────────────────────────────────
    // ZXing's decodeFromConstraints manages its own stream internally with async
    // callbacks that silently break on iOS Safari. Instead: get the stream
    // ourselves, attach it to the video, then call decodeFromCanvas() in a tight
    // loop — synchronous per-frame, full control, proven to work on iOS.
    if (isIOS) {
      const hints = new Map();
      hints.set(_DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
      hints.set(_DecodeHintType.TRY_HARDER, true);
      state.reader = new _BrowserMultiFormatReader(hints, 50);

      // Try preferred constraints first, then minimal fallback
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
      }

      el.video.srcObject = stream;
      el.video.setAttribute("playsinline", "");
      el.video.muted = true;
      await el.video.play();

      // Offscreen canvas for frame capture
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let running = true;

      state._nativeScanStop = () => {
        running = false;
        stream.getTracks().forEach(t => t.stop());
        el.video.srcObject = null;
      };

      const FRAME_MS = 50; // ~20fps — faster detection
      // Use a center-cropped canvas for faster decode (barcodes are usually centered)
      const cropCanvas = document.createElement("canvas");
      const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
      const tick = () => {
        if (!running) return;
        try {
          if (el.video.readyState >= 2 && el.video.videoWidth > 0) {
            const vw = el.video.videoWidth, vh = el.video.videoHeight;
            // Crop center 60% width, 40% height — where barcodes usually are
            const cw = Math.round(vw * 0.6), ch = Math.round(vh * 0.4);
            const cx = Math.round((vw - cw) / 2), cy = Math.round((vh - ch) / 2);
            if (cropCanvas.width !== cw) { cropCanvas.width = cw; cropCanvas.height = ch; }
            cropCtx.drawImage(el.video, cx, cy, cw, ch, 0, 0, cw, ch);
            const result = state.reader.decodeFromCanvas(cropCanvas);
            if (result) { onDecodedText(result.getText()); }
            else {
              // Fallback: try full frame every other tick for off-center barcodes
              if (canvas.width !== vw) { canvas.width = vw; canvas.height = vh; }
              ctx.drawImage(el.video, 0, 0);
              const r2 = state.reader.decodeFromCanvas(canvas);
              if (r2) onDecodedText(r2.getText());
            }
          }
        } catch { /* NotFoundException on frames with no barcode — expected */ }
        if (running) setTimeout(tick, FRAME_MS);
      };
      setTimeout(tick, 200); // reduced delay — video produces frames quickly

      await setupTorch();
      el.scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
      return;
    }

    // ── Non-iOS: native BarcodeDetector → ZXing fallback ────────────────────
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      const ok = await startNativeScanning(stream);
      if (ok) {
        await setupTorch();
        el.scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
        return;
      }
      stream.getTracks().forEach(t => t.stop());
    } catch { /* BarcodeDetector unavailable — fall through to ZXing */ }

    // ZXing decodeFromConstraints fallback (non-iOS)
    const hints = new Map();
    hints.set(_DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
    hints.set(_DecodeHintType.TRY_HARDER, true);
    state.reader = new _BrowserMultiFormatReader(hints, 50);
    const onResult = (r) => { if (r) onDecodedText(r.getText()); };
    try {
      state.controls = await state.reader.decodeFromConstraints(
        { audio: false, video: videoConstraints }, el.video, onResult);
    } catch {
      state.controls = await state.reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } }, el.video, onResult);
    }

    await setupTorch();
    el.scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
  } catch (err) {
    hide(el.cameraArea);
    show(el.cameraBlockedMsg);
    show(el.scanTriggerArea);
    show(el.newScanBtn);
    el.scanStatus.textContent = "Camera access needed.";
    reportClientEvent("camera_error", { error_msg: err?.message || "unknown" });
  }
}

function stopScanning() {
  state.pendingBarcode = "";
  state.pendingCount   = 0;
  resetTorch();
  // Stop native BarcodeDetector scanning
  if (state._nativeScanStop) { state._nativeScanStop(); state._nativeScanStop = null; }
  if (el.video?.srcObject) {
    el.video.srcObject.getTracks().forEach(t => t.stop());
    el.video.srcObject = null;
  }
  // Stop ZXing scanning
  try { if (state.controls) { state.controls.stop(); state.controls = null; } } catch { state.controls = null; }
  try { if (state.reader)   { state.reader.reset();   state.reader   = null; } } catch { state.reader   = null; }
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function trapFocus(modal, e) {
  if (e.key !== "Tab") return;
  const focusable = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

function openModal(modal) {
  show(modal);
  document.body.classList.add("modal-open");
  // Focus first focusable element
  const first = modal.querySelector("button, input, textarea, select, a[href]");
  first?.focus();
  modal._trapFocusHandler = (e) => trapFocus(modal, e);
  modal.addEventListener("keydown", modal._trapFocusHandler);
}

function closeModal(modal) {
  if (modal._trapFocusHandler) {
    modal.removeEventListener("keydown", modal._trapFocusHandler);
    modal._trapFocusHandler = null;
  }
  hide(modal);
  clearFormMsg(modal);
  // Only remove modal-open if no other modals are visible
  const anyOpen = document.querySelector('.modal-backdrop:not(.hidden)');
  if (!anyOpen) document.body.classList.remove("modal-open");
}

function clearFormMsg(modal) {
  const msg = modal.querySelector(".form-msg");
  if (msg) { msg.className = "form-msg hidden"; msg.textContent = ""; }
}

function showFormMsg(modal, message, type = "success") {
  const msg = modal.querySelector(".form-msg");
  if (!msg) return;
  msg.className = `form-msg ${type}`;
  msg.textContent = message;
  show(msg);
}

// Missing product photo flow
let _missingStream = null;

async function startMissingCamera() {
  if (_missingStream) return;  // already started
  try {
    _missingStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    el.missingVideo.srcObject = _missingStream;
    el.missingVideo.play().catch(() => {});
    show(el.missingVideo);
  } catch (err) {
    // Camera not available — show upload-only mode
    hide(el.missingVideo);
    reportClientEvent("camera_error", { error_msg: "missing_modal_" + (err?.name || "unknown") });
  }
}

function stopMissingCamera() {
  if (_missingStream) {
    _missingStream.getTracks().forEach(t => t.stop());
    _missingStream = null;
  }
  if (el.missingVideo) el.missingVideo.srcObject = null;
}

function captureFromMissingCamera() {
  if (!el.missingVideo || !el.missingCanvas) return;
  const v = el.missingVideo;
  const c = el.missingCanvas;
  c.width = v.videoWidth || 640;
  c.height = v.videoHeight || 480;
  c.getContext("2d").drawImage(v, 0, 0);
  const dataUrl = c.toDataURL("image/jpeg", 0.7);
  setMissingPhoto(dataUrl);
}

function setMissingPhoto(dataUrl) {
  // Validate size before accepting — backend rejects > 1.5 MB decoded
  const b64Part = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const decodedSize = Math.ceil(b64Part.length * 3 / 4);
  if (decodedSize > 1_600_000) {
    showFormMsg(el.missingModal, "Photo is too large (max 1.5 MB). Try a lower resolution or crop the image.", "error");
    return;
  }
  state.missingPhotoData = dataUrl;
  if (el.missingPreviewImg) el.missingPreviewImg.src = dataUrl;
  show(el.missingPreview);
  hide(el.missingVideo);
  // Hide ingredient guide overlay when showing captured photo
  const guideOverlay = document.querySelector(".ingredient-guide-overlay");
  if (guideOverlay) guideOverlay.style.display = "none";
  stopMissingCamera();
  // Enable submit
  if (el.missingSubmitBtn) el.missingSubmitBtn.disabled = false;
  if (el.missingSubmitLabel) el.missingSubmitLabel.textContent = "Submit Photo";
}

async function handleMissingSubmit(e) {
  if (e) e.preventDefault();
  if (!state.missingPhotoData) {
    showFormMsg(el.missingModal, "Please capture or upload a photo first.", "error");
    return;
  }
  el.missingSubmitBtn.disabled = true;
  if (el.missingSubmitLabel) el.missingSubmitLabel.textContent = "Submitting\u2026";
  showFormMsg(el.missingModal, "Submitting photo\u2026", "info");

  try {
    const resp = await fetchWithTimeout(
      `${getApiBase()}${ENDPOINTS.submit_missing_photo}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": getClientId(),
          ...(Auth.getAccessToken() ? { "Authorization": `Bearer ${Auth.getAccessToken()}` } : {}),
        },
        body: JSON.stringify({
          barcode: el.missingBarcode?.value || state.currentBarcode || "",
          product_name: el.missingName?.value?.trim() || "",
          photo_b64: state.missingPhotoData.split(",")[1],  // strip data:image/jpeg;base64,
        }),
      },
      15000,
    );
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      showFormMsg(el.missingModal, "Thank you for uploading! Our team reviews submissions daily and will add this product to the database.", "success");
      setTimeout(() => closeModal(el.missingModal), 2500);
    } else {
      const msg = data.message || "Submission failed. Please try again.";
      showFormMsg(el.missingModal, msg, "error");
      el.missingSubmitBtn.disabled = false;
      if (el.missingSubmitLabel) el.missingSubmitLabel.textContent = "Submit Photo";
      reportClientEvent("submission_failed", { error_msg: msg });
    }
  } catch (err) {
    const msg = "Network error \u2014 please check your connection and try again.";
    showFormMsg(el.missingModal, msg, "error");
    el.missingSubmitBtn.disabled = false;
    if (el.missingSubmitLabel) el.missingSubmitLabel.textContent = "Submit Photo";
    reportClientEvent("submission_failed", { error_msg: err?.message || "network" });
  }
}

// ─── Event binding ────────────────────────────────────────────────────────────

function bindEvents() {
  // Manual input
  el.manualInput.addEventListener("input",  updateManualState);
  el.manualInput.addEventListener("blur",   updateManualState);
  el.manualInput.addEventListener("paste",  () => setTimeout(updateManualState, 0));

  // Manual form submit
  el.manualForm.addEventListener("submit", e => {
    e.preventDefault();
    if (state.inFlight || state.scanLocked) return;
    if (!updateManualState()) {
      showMessage({ variant: "error", message: MESSAGES.invalidBarcode });
      return;
    }
    stopScanning();
    hide(el.cameraArea);
    state.scanLocked = true;
    fetchVerdict(el.manualInput.value);
  });

  // Camera start
  el.startCameraBtn.addEventListener("click", () => {
    hideResult();
    clearMessage();
    setLoading(false);
    startScanning();
  });

  // Camera stop
  el.stopCameraBtn?.addEventListener("click", () => {
    stopScanning();
    hide(el.cameraArea);
    show(el.scanTriggerArea);
    el.scanStatus && (el.scanStatus.textContent = "Camera stopped.");
  });

  // New scan
  el.newScanBtn.addEventListener("click", () => {
    clearMessage();
    hideResult();
    setLoading(false);
    hide(el.newScanBtn);
    show(el.scanTriggerArea);
    el.manualInput.value = "";
    updateManualState();
    el.manualInput.focus();
  });

  // Torch
  el.torchBtn?.addEventListener("click", () => applyTorch(!state.torchOn));

  // Community feedback buttons
  el.feedbackCorrectBtn?.addEventListener("click", () => {
    if (state.currentBarcode) submitFeedback(state.currentBarcode, "correct");
  });
  el.feedbackIncorrectBtn?.addEventListener("click", () => {
    if (state.currentBarcode) submitFeedback(state.currentBarcode, "incorrect");
  });

  // Clear history
  el.clearHistoryBtn?.addEventListener("click", () => {
    historySave([]);
    renderHistory();
  });

  // Share button
  el.shareBtn?.addEventListener("click", () => {
    const { barcode, status, name, brand, reasons, explain } = el.shareBtn.dataset;
    if (barcode) handleShare(barcode, status, name, brand, JSON.parse(reasons || "[]"), explain);
  });

  // Not found - report missing
  document.getElementById("reportMissingBtn")?.addEventListener("click", () => {
    if (el.missingBarcode) el.missingBarcode.value = state.currentBarcode || "";
    if (el.missingName) el.missingName.value = "";
    state.missingPhotoData = null;
    if (el.missingSubmitBtn) el.missingSubmitBtn.disabled = true;
    if (el.missingSubmitLabel) el.missingSubmitLabel.textContent = "Capture a photo first";
    hide(el.missingPreview);
    clearFormMsg(el.missingModal);
    startMissingCamera();
    openModal(el.missingModal);
  });

  // Missing modal camera/photo controls
  el.missingCaptureBtn?.addEventListener("click", captureFromMissingCamera);
  el.missingRetakeBtn?.addEventListener("click", () => {
    state.missingPhotoData = null;
    hide(el.missingPreview);
    // Restore ingredient guide overlay for retake
    const guideOverlay = document.querySelector(".ingredient-guide-overlay");
    if (guideOverlay) guideOverlay.style.display = "";
    startMissingCamera();
    if (el.missingSubmitBtn) el.missingSubmitBtn.disabled = true;
    if (el.missingSubmitLabel) el.missingSubmitLabel.textContent = "Capture a photo first";
  });
  el.missingFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5 MB (must match backend limit)
    if (file.size > MAX_FILE_SIZE) {
      showMessage({ message: "Image too large — please choose a file under 1.5 MB.", variant: "warn" });
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setMissingPhoto(ev.target.result);
    reader.readAsDataURL(file);
    // Reset so re-selecting the same file triggers change event
    e.target.value = "";
  });
  el.missingCloseBtn?.addEventListener("click", () => {
    stopMissingCamera();
    state.missingPhotoData = null;
    hide(el.missingPreview);
    if (el.missingSubmitBtn) el.missingSubmitBtn.disabled = true;
    clearFormMsg(el.missingModal);
    closeModal(el.missingModal);
  });
  el.missingSubmitBtn?.addEventListener("click", handleMissingSubmit);

  // Not found - try another
  document.getElementById("tryAnotherBtn")?.addEventListener("click", () => {
    clearMessage();
    hideResult();
    hide(el.newScanBtn);
    show(el.scanTriggerArea);
    el.manualInput.value = "";
    updateManualState();
    el.manualInput.focus();
  });

  // Close modals on backdrop click
  el.missingModal?.addEventListener("click", e => {
    if (e.target === el.missingModal) { stopMissingCamera(); closeModal(el.missingModal); }
  });

  // Clean up cameras on unload
  window.addEventListener("beforeunload", () => { stopScanning(); stopMissingCamera(); });

  // Offline / online detection
  if (!navigator.onLine) {
    show(el.offlineBanner);
    if (el.startCameraBtn) el.startCameraBtn.disabled = true;
    if (el.checkBtn) el.checkBtn.disabled = true;
  }
  window.addEventListener("offline", () => {
    show(el.offlineBanner);
    if (el.startCameraBtn) el.startCameraBtn.disabled = true;
    if (el.checkBtn) el.checkBtn.disabled = true;
  });
  window.addEventListener("online", () => {
    hide(el.offlineBanner);
    if (el.startCameraBtn) el.startCameraBtn.disabled = false;
    updateManualState();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// ─── Auth UI ──────────────────────────────────────────────────────────────────

function openAuthModal(subtitle) {
  openModal(el.authModal);
  // Always show sign-in buttons when opening auth modal
  const btns = el.authModal?.querySelector(".auth-buttons");
  if (btns) btns.classList.remove("hidden");
  hide(el.authModalError);
  // Update subtitle if provided (e.g. "Sign in to continue scanning")
  const sub = el.authModal?.querySelector(".auth-modal-sub");
  if (sub && subtitle) sub.textContent = subtitle;
}

function toggleUserDropdown() {
  if (!el.userDropdown) return;
  const isOpen = !el.userDropdown.classList.contains("hidden");
  if (isOpen) {
    el.userDropdown.classList.add("hidden");
    el.userMenuBtn?.setAttribute("aria-expanded", "false");
  } else {
    const user = Auth.getUser();
    if (el.userDropdownEmail) el.userDropdownEmail.textContent = user?.email || "";
    el.userDropdown.classList.remove("hidden");
    el.userMenuBtn?.setAttribute("aria-expanded", "true");
    // Load current email preference when dropdown opens
    _loadEmailPref();
  }
}

async function _loadEmailPref() {
  if (!el.emailPrefCheckbox) return;
  try {
    const resp = await Auth.authFetch(`${getApiBase()}/v1/email/preferences`);
    if (resp.ok) {
      const prefs = await resp.json();
      el.emailPrefCheckbox.checked = prefs.weekly_digest !== false;
    }
  } catch { /* keep default checked state */ }
}

async function _toggleEmailPref(value) {
  try {
    await Auth.authFetch(`${getApiBase()}/v1/email/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekly_digest: value }),
    });
  } catch {
    // Revert on failure
    if (el.emailPrefCheckbox) el.emailPrefCheckbox.checked = !value;
  }
}

function closeUserDropdown() {
  el.userDropdown?.classList.add("hidden");
  el.userMenuBtn?.setAttribute("aria-expanded", "false");
}

function updateAuthNav(user) {
  if (user) {
    hide(el.signInBtn);
    if (el.userAvatar) el.userAvatar.src = user.avatar_url || "";
    if (el.userName) el.userName.textContent = user.display_name || user.email?.split("@")[0] || "Account";
    show(el.userMenuBtn);
  } else {
    show(el.signInBtn);
    hide(el.userMenuBtn);
    closeUserDropdown();
  }
}

function bindAuthEvents() {
  el.signInBtn?.addEventListener("click", openAuthModal);
  el.userMenuBtn?.addEventListener("click", toggleUserDropdown);

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (el.userDropdown && !el.userDropdown.classList.contains("hidden")) {
      const wrap = el.userMenuBtn?.closest(".user-menu-wrap");
      if (wrap && !wrap.contains(e.target)) {
        closeUserDropdown();
      }
    }
  });

  el.authModalClose?.addEventListener("click", () => closeModal(el.authModal));
  el.authModal?.addEventListener("click", (e) => {
    if (e.target === el.authModal) closeModal(el.authModal);
  });

  // Google sign-in button is rendered by Google Identity Services in auth.js
  // No click handler needed — Google's SDK manages the button directly

  // Email preference toggle in dropdown
  el.emailPrefCheckbox?.addEventListener("change", (e) => {
    _toggleEmailPref(e.target.checked);
  });

  el.dropdownSignOutBtn?.addEventListener("click", async () => {
    await Auth.signOut();
    closeUserDropdown();
    hideResult();
    clearMessage();
    el.newScanBtn?.classList.add("hidden");
    el.scanTriggerArea?.classList.remove("hidden");
    if (el.manualInput) el.manualInput.value = "";
    updateManualState();
  });

  // Close any open modal on Escape (consolidated handler)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (el.missingModal && !el.missingModal.classList.contains("hidden")) {
        stopMissingCamera(); closeModal(el.missingModal); return;
      }
      if (el.authModal && !el.authModal.classList.contains("hidden")) {
        closeModal(el.authModal); return;
      }
      closeUserDropdown();
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  getClientId();

  // If URL contains ?b= (shared link), honour ?p= profile override first
  const _urlParams  = new URLSearchParams(window.location.search);
  const _urlBarcode = _urlParams.get("b");
  const _urlProfile = _urlParams.get("p");
  if (_urlProfile && PROFILES.some(p => p.id === _urlProfile)) {
    setActiveProfile(_urlProfile);
  }

  initProfileSelector();
  bindEvents();
  bindAuthEvents();
  renderHistory();
  hideResult();
  clearMessage();
  updateManualState();
  hide(el.cameraArea);
  hide(el.cameraBlockedMsg);
  hide(el.newScanBtn);
  show(el.scanTriggerArea);

  // ── Initialize new modules ──
  const apiBase = getApiBase();

  // Auth
  Auth.onAuthStateChange((user) => {
    _verdictCache.clear();
    updateAuthNav(user);
    Favorites.onAuthChange();
    // Close auth modal on successful sign-in
    if (user && el.authModal && !el.authModal.classList.contains("hidden")) {
      closeModal(el.authModal);
    }
    // Clear free-scan counter on sign-in (no longer needed)
    if (user) {
      localStorage.removeItem(FREE_SCAN_KEY);
      // Remove any lingering free-scan banner
      document.getElementById("freeScanBanner")?.remove();
    }
    // Sync scan history from server when signed in
    if (user) _syncServerHistory();
  });
  await Auth.init();

  // Favorites
  Favorites.init({
    apiBase,
    getClientId,
    getProfile: getActiveProfile,
    onProductSelect: (barcode) => {
      fetchVerdict(barcode).catch(() => renderError(MESSAGES.genericError));
    },
    onSignInRequest: openAuthModal,
  });
  Favorites.onAuthChange();

  // Monetization
  Monetization.init({
    apiBase,
    getClientId,
  });

  // Update auth nav for current state
  updateAuthNav(Auth.getUser());

  // Auto-fetch if a barcode was embedded in the share URL
  if (_urlBarcode && /^\d{8}$|^\d{12,13}$/.test(_urlBarcode)) {
    // Clean URL so bookmarking / back-navigation doesn't re-trigger
    history.replaceState(null, "", window.location.pathname);
    fetchVerdict(_urlBarcode).catch(() => renderError(MESSAGES.genericError));
  }

  // Pre-warm barcode scanning libraries so first scan is instant
  // (non-blocking — failure here is fine, libs will be loaded on-demand)
  _loadBarcodeLibs().catch(() => {});
}

init();

// Global error tracking
window.onerror = (msg, src, line, col, err) => {
  reportClientEvent("js_error", { error_msg: `${msg} at ${src}:${line}:${col}` });
};
window.addEventListener("unhandledrejection", (e) => {
  reportClientEvent("js_error", { error_msg: `Unhandled: ${e.reason?.message || e.reason}` });
});
