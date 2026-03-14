import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";
import {
  DecodeHintType,
  BarcodeFormat,
} from "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/+esm";

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE_PROD = "https://web-production-31034.up.railway.app";
const API_BASE_DEV  = "http://localhost:8000";
const REQUEST_TIMEOUT_MS   = 9000;
const VERDICT_FAILSAFE_MS  = 9500;
const SCAN_FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A];

// ─── Profiles ─────────────────────────────────────────────────────────────────

const PROFILES = [
  {
    id:    "everyday_jain",
    label: "Everyday",
    desc:  "Standard Jain — avoids meat, fish, eggs, alliums & root vegetables",
  },
  {
    id:    "temple_mode",
    label: "Temple",
    desc:  "Temple / puja strictness — honey also restricted",
  },
  {
    id:    "paryushan_mode",
    label: "Paryushan",
    desc:  "Paryushan strictness — also restricts greens, sprouts & fungi",
  },
  {
    id:    "greens_sensitive_mode",
    label: "Greens+",
    desc:  "Everyday + extra caution around green vegetables",
  },
];
const PROFILE_KEY     = "JAIN_PROFILE";
const PROFILE_DEFAULT = "everyday_jain";

const HISTORY_KEY     = "JAIN_HISTORY";
const HISTORY_MAX     = 20;

const STATUS_META = {
  GREEN:   {
    label: "Likely Jain-friendly",
    icon:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    ariaPrefix: "Likely Jain-friendly:",
  },
  YELLOW:  {
    label: "Contains Jain-restricted vegetables",
    icon:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    ariaPrefix: "Contains Jain-restricted vegetables:",
  },
  ORANGE:  {
    label: "Needs verification",
    icon:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    ariaPrefix: "Needs verification:",
  },
  RED:     {
    label: "Not Jain-friendly",
    icon:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    ariaPrefix: "Not Jain-friendly:",
  },
  UNKNOWN: {
    label: "Not enough data",
    icon:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    ariaPrefix: "Not enough data:",
  },
};

const INGREDIENT_GROUP_META = {
  RED:    { label: "Not Jain-friendly",                reason: "Clearly not Jain-friendly ingredient" },
  ORANGE: { label: "Needs verification",               reason: "May be animal-derived or ambiguous" },
  YELLOW: { label: "Jain-restricted vegetables",       reason: "Onion, garlic, or root vegetable" },
  GREEN:  { label: "Allowed / no concern found",       reason: "No Jain concern detected" },
};

const MESSAGES = {
  invalidBarcode:   "Enter a 12-digit UPC or 13-digit EAN barcode.",
  network:          "We couldn't reach the server. Please check your connection and try again.",
  timeout:          "This request took too long. Please try again.",
  cameraPermission: "We couldn't access your camera. Enable camera permission in your browser settings for this site, or enter the barcode manually.",
  cameraUnsupported:"Camera scanning isn't supported in this browser. Please enter the barcode manually.",
  scannerStalled:   "The scan was captured but the lookup stalled. Please try again.",
  genericError:     "Something went wrong. Please try again.",
};

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
  confidenceText:    document.getElementById("confidenceText"),
  productDetails:    document.getElementById("productDetails"),
  productNameText:   document.getElementById("productNameText"),
  brandText:         document.getElementById("brandText"),
  barcodeInfo:       document.getElementById("barcodeInfo"),
  reasonChips:       document.getElementById("reasonChips"),
  savedNote:         document.getElementById("savedNote"),
  shareBtn:          document.getElementById("shareBtn"),
  shareToast:        document.getElementById("shareToast"),
  reportIssueBtn:    document.getElementById("reportIssueBtn"),
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
  reportModal:       document.getElementById("reportModal"),
  reportForm:        document.getElementById("reportForm"),
  reportBarcode:     document.getElementById("reportBarcode"),
  reportWrong:       document.getElementById("reportWrong"),
  reportIngredients: document.getElementById("reportIngredients"),
  reportEmail:       document.getElementById("reportEmail"),
  reportFormMsg:     document.getElementById("reportFormMsg"),
  reportSubmitBtn:   document.getElementById("reportSubmitBtn"),

  missingModal:      document.getElementById("missingModal"),
  missingForm:       document.getElementById("missingForm"),
  missingBarcode:    document.getElementById("missingBarcode"),
  missingName:       document.getElementById("missingName"),
  missingBrand:      document.getElementById("missingBrand"),
  missingIngredients:document.getElementById("missingIngredients"),
  missingEmail:      document.getElementById("missingEmail"),
  missingFormMsg:    document.getElementById("missingFormMsg"),
  missingSubmitBtn:  document.getElementById("missingSubmitBtn"),
};

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
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function onlyDigits(v) { return (v || "").replace(/\D/g, ""); }

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
    btn.addEventListener("click", () => setActiveProfile(p.id));
    bar.appendChild(btn);
  });
}

// ─── Share ────────────────────────────────────────────────────────────────────

function getShareUrl(barcode, profileId) {
  const base = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({ b: barcode });
  if (profileId && profileId !== PROFILE_DEFAULT) params.set("p", profileId);
  return `${base}?${params}`;
}

async function handleShare(barcode, status, productName) {
  const profile  = getActiveProfile();
  const url      = getShareUrl(barcode, profile);
  const verdict  = STATUS_META[status]?.label ?? "Unknown";
  const name     = productName ? `${productName} — ` : "";
  const title    = `Jaini: ${name}${verdict}`;
  const text     = `${name}${verdict} (Jaini Jain dietary check)`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;   // user dismissed
      // fall through to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    showShareToast("Link copied to clipboard");
  } catch {
    showShareToast("Share: " + url, 8000);
  }
}

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

// ─── Scan history ────────────────────────────────────────────────────────────

function historyLoad() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function historySave(entries) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch {}
}

function historyPush(entry) {
  // entry: {barcode, status, product_name, brand, profile, ts}
  const entries = historyLoad().filter(e => e.barcode !== entry.barcode);
  entries.unshift(entry);
  historySave(entries.slice(0, HISTORY_MAX));
  renderHistory();
}

function renderHistory() {
  const entries = historyLoad();
  if (!el.historySection || !el.historyList) return;

  if (entries.length === 0) {
    hide(el.historySection);
    return;
  }

  show(el.historySection);
  el.historyList.innerHTML = "";

  entries.forEach(entry => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.setAttribute("role", "listitem");

    // Status dot
    const dot = document.createElement("span");
    dot.className = `history-dot history-dot--${(entry.status || "UNKNOWN").toLowerCase()}`;
    dot.setAttribute("aria-hidden", "true");

    // Name / barcode
    const name = document.createElement("span");
    name.className = "history-name";
    name.textContent = entry.product_name || entry.barcode;

    // Time ago
    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = timeAgo(entry.ts);

    // Re-scan button
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-rescan";
    btn.dataset.barcode = entry.barcode;
    btn.setAttribute("aria-label", `Re-scan ${entry.product_name || entry.barcode}`);
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.62"/></svg>`;
    btn.addEventListener("click", () => {
      if (state.inFlight || state.scanLocked) return;
      fetchVerdict(entry.barcode).catch(() => renderError(MESSAGES.genericError));
    });

    li.appendChild(dot);
    li.appendChild(name);
    li.appendChild(time);
    li.appendChild(btn);
    el.historyList.appendChild(li);
  });
}

function timeAgo(isoString) {
  if (!isoString) return "";
  const diffMs  = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH   = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  const diffD   = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// ─── Community verification ───────────────────────────────────────────────────

const FEEDBACK_KEY = "JAIN_FEEDBACK";   // {barcode: signal} voted barcodes

function feedbackLoadVoted() {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "{}"); }
  catch { return {}; }
}

function feedbackMarkVoted(barcode, signal) {
  const voted = feedbackLoadVoted();
  voted[barcode] = signal;
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
  const icon = correct_pct >= 70
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const label = correct_pct >= 70
    ? `${correct} of ${total} users confirmed`
    : `${total - correct} of ${total} users flagged`;
  el.communityBadge.innerHTML = `${icon} <span>${label}</span>`;
  el.communityBadge.className = `community-badge community-badge--${correct_pct >= 70 ? "confirmed" : "flagged"}`;
  show(el.communityBadge);
}

function showCommunitySection(barcode, community) {
  if (!el.communitySection) return;

  // Show badge if community data exists
  renderCommunityBadge(community);

  // Show feedback prompt if not yet voted
  const voted = feedbackLoadVoted();
  if (barcode && !voted[barcode]) {
    show(el.feedbackPrompt);
    hide(el.feedbackThanks);
  } else {
    hide(el.feedbackPrompt);
    if (voted[barcode]) {
      el.feedbackThanks.textContent = voted[barcode] === "correct"
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
      `${getApiBase()}/v1/feedback`,
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
    }
  } catch { /* fire-and-forget — UI already updated optimistically */ }
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
  if (el.alternativesList) el.alternativesList.innerHTML = "";
  if (el.alternativesBrand) el.alternativesBrand.textContent = "";
}

async function fetchAndRenderAlternatives(barcode, status) {
  if (status !== "RED" && status !== "ORANGE") { hideAlternatives(); return; }
  if (!el.alternativesSection) return;
  const reqId = state.requestId;   // capture NOW before any await

  const profile = getActiveProfile();
  const url = new URL(`${getApiBase()}/v1/alternatives`);
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

    el.alternativesList.innerHTML = alts.map(a => {
      const safeStatus = ["green","yellow"].includes((a.status||"").toLowerCase()) ? a.status.toLowerCase() : "unknown";
      const label = safeStatus === "green" ? "Green" : safeStatus === "yellow" ? "Yellow" : a.status;
      return `
        <li class="alternatives-item">
          <button type="button" class="alt-scan-btn" data-barcode="${escHtml(a.barcode)}" aria-label="Scan ${escHtml(a.product_name)}">
            <span class="alt-badge alt-badge--${safeStatus}">${label}</span>
            <span class="alt-name">${escHtml(a.product_name)}</span>
            ${a.brand ? `<span class="alt-brand">${escHtml(a.brand)}</span>` : ""}
          </button>
        </li>
      `;
    }).join("");

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
  el.messageBox.innerHTML = "";
}

function showMessage({ message, variant = "info" }) {
  el.messageBox.className = `notice notice-${variant}`;

  const iconMap = {
    error: `<svg class="notice-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warn:  `<svg class="notice-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:  `<svg class="notice-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  el.messageBox.innerHTML = `${iconMap[variant] || iconMap.info}<div><p>${message}</p></div>`;
  show(el.messageBox);
}

function hideResult() {
  hide(el.resultSection);
  hide(el.notFoundState);
  hide(el.ingredientSection);
  hide(el.productDetails);
  hide(el.reportIssueBtn);
  hide(el.shareBtn);
  hideCommunitySection();
  hideAlternatives();
  el.reasonChips.innerHTML = "";
  el.savedNote.textContent = "";
  state.currentBarcode = "";
}

// ─── Manual input validation ─────────────────────────────────────────────────

function isManualValid() {
  const d = onlyDigits(el.manualInput.value);
  return d.length === 12 || d.length === 13;
}

function updateManualState() {
  const raw = el.manualInput.value;
  const digits = onlyDigits(raw);
  const hadNonNumeric = raw !== digits;

  el.manualInput.value = digits;

  let help = "Enter a 12-digit UPC or 13-digit EAN barcode.";
  let isError = false;

  if (hadNonNumeric) {
    help = "Only numbers are allowed. Spaces and hyphens are removed automatically.";
    isError = true;
  } else if (digits.length > 13) {
    help = `Too many digits (${digits.length}). Barcodes are 12 or 13 digits.`;
    isError = true;
  } else if (digits.length > 0 && digits.length < 12) {
    const need = 12 - digits.length;
    help = `Enter ${need} more digit${need === 1 ? "" : "s"} (need 12 or 13 total).`;
    isError = false; // not an error, just incomplete
  } else if (digits.length === 12) {
    help = "UPC-A detected. 12 digits ✓";
  } else if (digits.length === 13) {
    help = "EAN-13 detected. 13 digits ✓";
  }

  el.manualHelp.textContent = help;
  el.manualHelp.classList.toggle("field-help-error", isError && digits.length > 0);
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
  }, VERDICT_FAILSAFE_MS);
}

// ─── Result rendering ─────────────────────────────────────────────────────────

function renderIngredientRows(categories) {
  el.ingredientRows.innerHTML = "";
  const order = ["RED", "ORANGE", "YELLOW", "GREEN"];

  order.forEach(level => {
    const items = Array.isArray(categories?.[level]) ? categories[level] : [];
    const meta  = INGREDIENT_GROUP_META[level];

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

function renderResult(data) {
  clearMessage();
  setLoading(false);
  hideResult();

  const status = STATUS_META[data.status] ? data.status : "UNKNOWN";
  const meta   = STATUS_META[status];
  state.currentBarcode = data.barcode || "";

  // Verdict block
  show(el.resultSection);
  el.verdictCard.className = `verdict verdict-${status}`;
  el.verdictCard.setAttribute("aria-label", `${meta.ariaPrefix} ${data.explain || ""}`);
  el.verdictIcon.innerHTML  = meta.icon;
  el.statusLabel.textContent = meta.label;
  el.explainText.textContent = data.explain || "No explanation available.";

  // Confidence
  const conf = (data.confidence || "").toLowerCase();
  el.confidenceText.textContent = conf ? `Confidence: ${capitalize(conf)}` : "";
  el.confidenceText.className = `confidence-chip${conf === "high" ? " conf-high" : conf === "medium" ? " conf-medium" : conf === "low" ? " conf-low" : ""}`;

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
  el.reasonChips.innerHTML = "";
  reasons.forEach(r => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.setAttribute("role", "listitem");
    chip.textContent = r;
    el.reasonChips.appendChild(chip);
  });

  // Community verification section
  showCommunitySection(state.currentBarcode, data.community || null);

  // Jain-friendly alternatives (for RED/ORANGE)
  fetchAndRenderAlternatives(state.currentBarcode, data.status);

  // Persist to scan history
  historyPush({
    barcode:      state.currentBarcode,
    status:       status,
    product_name: data.product_name || "",
    brand:        data.brand || "",
    profile:      getActiveProfile(),
    ts:           new Date().toISOString(),
  });

  // Saved banner
  el.savedNote.textContent = data.saved ? "✓ Saved for future scans" : "";

  // Share button — store barcode + status on element for click handler
  if (el.shareBtn && state.currentBarcode) {
    el.shareBtn.dataset.barcode = state.currentBarcode;
    el.shareBtn.dataset.status  = status;
    el.shareBtn.dataset.name    = data.product_name || "";
    show(el.shareBtn);
  }

  // Report link
  show(el.reportIssueBtn);

  // Ingredients
  show(el.ingredientSection);
  el.ingredientsText.textContent = data.ingredients_text || "Ingredient text not available.";
  renderIngredientRows(data.ingredient_categories);

  presentOutcome();
}

function renderNotFound(barcode) {
  clearMessage();
  setLoading(false);
  hideResult();

  state.currentBarcode = barcode;
  show(el.resultSection);
  el.verdictCard.className = "verdict verdict-UNKNOWN";
  el.verdictIcon.innerHTML  = STATUS_META.UNKNOWN.icon;
  el.statusLabel.textContent = STATUS_META.UNKNOWN.label;
  el.explainText.textContent = "";
  el.confidenceText.textContent = "";

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
  const limit = data?.limit ?? "?";
  const count = data?.count ?? "?";
  const reset = data?.reset ?? "unknown";
  showMessage({
    variant: "warn",
    message: `You've used ${count} of ${limit} free lookups today. Your limit resets on ${reset}. Contact <a href="mailto:hello@swapncore.com">hello@swapncore.com</a> to request an increase.`,
  });
  presentOutcome();
}

function renderError(message) {
  clearMessage();
  setLoading(false);
  hideResult();
  showMessage({ variant: "error", message: message || MESSAGES.genericError });
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
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }

// ─── Network ──────────────────────────────────────────────────────────────────

async function fetchVerdict(rawBarcode) {
  const barcode = onlyDigits(rawBarcode);
  if (barcode.length !== 12 && barcode.length !== 13) {
    updateManualState();
    showMessage({ variant: "error", message: MESSAGES.invalidBarcode });
    return;
  }

  const reqId = ++state.requestId;
  state.inFlight  = true;
  state.scanLocked = true;

  clearMessage();
  hideResult();
  setLoading(true, `Looking up barcode ${barcode}…`);
  el.scanStatus && (el.scanStatus.textContent = `Looking up ${barcode}…`);
  startFailsafe(reqId);

  try {
    const url = new URL(`${getApiBase()}/v1/verdict`);
    url.searchParams.set("barcode", barcode);
    url.searchParams.set("profile", getActiveProfile());

    let resp;
    try {
      resp = await fetchWithTimeout(url.toString(), {
        method: "GET",
        headers: { "X-Client-Id": getClientId() },
      }, REQUEST_TIMEOUT_MS);
    } catch (err) {
      if (reqId !== state.requestId) return;
      renderError(err?.name === "AbortError" ? MESSAGES.timeout : MESSAGES.network);
      el.scanStatus && (el.scanStatus.textContent = err?.name === "AbortError" ? "Request timed out." : "Network error.");
      return;
    }

    if (reqId !== state.requestId) return;
    const data = await resp.json().catch(() => ({}));
    if (reqId !== state.requestId) return;

    if (resp.ok) {
      renderResult(data);
      el.scanStatus && (el.scanStatus.textContent = `Scan complete: ${barcode}`);
      if (el.reportBarcode) el.reportBarcode.value = barcode;
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
  const digits = onlyDigits(text);
  if (digits.length !== 12 && digits.length !== 13) return;

  const now = Date.now();
  if (digits === state.lastBarcode && now - state.lastScanAt < 2200) return;

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
    const devs  = await navigator.mediaDevices.enumerateDevices();
    const vids  = devs.filter(d => d.kind === "videoinput");
    const back  = vids.find(d => /back|rear|environment/i.test(d.label || ""));
    return (back || vids[0])?.deviceId || null;
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

async function startScanning() {
  if (state.controls) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    hide(el.cameraArea);
    show(el.cameraBlockedMsg);
    return;
  }

  clearMessage();
  hide(el.cameraBlockedMsg);
  hide(el.newScanBtn);
  show(el.cameraArea);
  hide(el.scanTriggerArea);
  state.scanLocked = false;

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);

  state.reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 50,
    delayBetweenScanSuccess: 600,
  });

  const onResult = r => { if (r) onDecodedText(r.getText()); };

  try {
    const deviceId = await pickBackCamera();
    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId }, focusMode: { ideal: "continuous" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: "environment" }, focusMode: { ideal: "continuous" }, width: { ideal: 1920 }, height: { ideal: 1080 } };

    try {
      state.controls = await state.reader.decodeFromConstraints(
        { audio: false, video: videoConstraints }, el.video, onResult);
    } catch {
      state.controls = await state.reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } }, el.video, onResult);
    }

    await setupTorch();
    el.scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
  } catch {
    hide(el.cameraArea);
    show(el.cameraBlockedMsg);
    show(el.scanTriggerArea);
    show(el.newScanBtn);
    el.scanStatus.textContent = "Camera access needed.";
  }
}

function stopScanning() {
  state.pendingBarcode = "";
  state.pendingCount   = 0;
  resetTorch();
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

function handleReportSubmit(e) {
  e.preventDefault();
  const wrong = el.reportWrong.value.trim();
  if (!wrong) {
    el.reportWrong.focus();
    showFormMsg(el.reportModal, "Please describe what seems wrong.", "error");
    return;
  }

  const subject = encodeURIComponent(`Jaini classification report: ${el.reportBarcode.value}`);
  const body = encodeURIComponent(
    `Barcode: ${el.reportBarcode.value}\n\nWhat seems wrong:\n${wrong}\n\n` +
    (el.reportIngredients.value ? `Corrected ingredients:\n${el.reportIngredients.value}\n\n` : "") +
    (el.reportEmail.value ? `Reply to: ${el.reportEmail.value}` : "")
  );
  window.open(`mailto:hello@swapncore.com?subject=${subject}&body=${body}`, "_blank");
  showFormMsg(el.reportModal, "Thanks. Your report helps improve Jaini. You can close this window.", "success");
  el.reportSubmitBtn.disabled = true;
}

async function handleMissingSubmit(e) {
  e.preventDefault();
  const ingr = el.missingIngredients.value.trim();
  if (!ingr) {
    el.missingIngredients.focus();
    showFormMsg(el.missingModal, "Please enter the ingredient text from the product label.", "error");
    return;
  }

  el.missingSubmitBtn.disabled = true;
  showFormMsg(el.missingModal, "Submitting…", "info");

  try {
    const resp = await fetchWithTimeout(
      `${getApiBase()}/v1/submit_missing`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": getClientId(),
        },
        body: JSON.stringify({
          barcode:          el.missingBarcode.value,
          product_name:     el.missingName.value.trim(),
          brand:            el.missingBrand.value.trim(),
          ingredients_text: ingr,
          profile:          getActiveProfile(),
          email:            el.missingEmail.value.trim(),
        }),
      },
      REQUEST_TIMEOUT_MS,
    );

    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data.saved) {
      closeModal(el.missingModal);
      renderResult(data);
      if (el.reportBarcode) el.reportBarcode.value = el.missingBarcode.value;
    } else {
      const msg = data.message || "Submission failed. Please try again.";
      showFormMsg(el.missingModal, msg, "error");
      el.missingSubmitBtn.disabled = false;
    }
  } catch (err) {
    const msg = err?.name === "AbortError"
      ? "Request timed out. Please try again."
      : "Network error. Please check your connection and try again.";
    showFormMsg(el.missingModal, msg, "error");
    el.missingSubmitBtn.disabled = false;
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
    const { barcode, status, name } = el.shareBtn.dataset;
    if (barcode) handleShare(barcode, status, name);
  });

  // Report issue button (in result card)
  el.reportIssueBtn?.addEventListener("click", () => {
    if (el.reportBarcode) el.reportBarcode.value = state.currentBarcode;
    el.reportWrong.value = "";
    el.reportIngredients.value = "";
    el.reportEmail.value = "";
    el.reportSubmitBtn.disabled = false;
    clearFormMsg(el.reportModal);
    openModal(el.reportModal);
  });

  // Not found - report missing
  document.getElementById("reportMissingBtn")?.addEventListener("click", () => {
    if (el.missingBarcode) el.missingBarcode.value = state.currentBarcode;
    el.missingName.value = "";
    el.missingBrand.value = "";
    el.missingIngredients.value = "";
    el.missingEmail.value = "";
    el.missingSubmitBtn.disabled = false;
    clearFormMsg(el.missingModal);
    openModal(el.missingModal);
  });

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

  // Report modal
  document.getElementById("reportModalClose")?.addEventListener("click", () => closeModal(el.reportModal));
  document.getElementById("reportModalCancel")?.addEventListener("click", () => closeModal(el.reportModal));
  el.reportForm?.addEventListener("submit", handleReportSubmit);

  // Missing modal
  document.getElementById("missingModalClose")?.addEventListener("click", () => closeModal(el.missingModal));
  document.getElementById("missingModalCancel")?.addEventListener("click", () => closeModal(el.missingModal));
  el.missingForm?.addEventListener("submit", handleMissingSubmit);

  // Close modals on backdrop click
  [el.reportModal, el.missingModal].forEach(modal => {
    modal?.addEventListener("click", e => {
      if (e.target === modal) closeModal(modal);
    });
  });

  // Close modals on Escape
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (el.reportModal && !el.reportModal.classList.contains("hidden")) closeModal(el.reportModal);
      if (el.missingModal && !el.missingModal.classList.contains("hidden")) closeModal(el.missingModal);
    }
  });

  // Clean up camera on unload
  window.addEventListener("beforeunload", stopScanning);

  // Offline / online detection
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

function init() {
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
  renderHistory();
  hideResult();
  clearMessage();
  updateManualState();
  hide(el.cameraArea);
  hide(el.cameraBlockedMsg);
  hide(el.newScanBtn);
  show(el.scanTriggerArea);

  // Auto-fetch if a barcode was embedded in the share URL
  if (_urlBarcode && /^\d{12,13}$/.test(_urlBarcode)) {
    // Clean URL so bookmarking / back-navigation doesn't re-trigger
    history.replaceState(null, "", window.location.pathname);
    fetchVerdict(_urlBarcode).catch(() => renderError(MESSAGES.genericError));
  }
}

init();
