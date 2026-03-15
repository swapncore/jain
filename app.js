import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";
import {
  DecodeHintType,
  BarcodeFormat,
} from "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/+esm";
import {
  API_BASE_PROD, API_BASE_DEV,
  REQUEST_TIMEOUT_MS, VERDICT_FAILSAFE_MS,
  PROFILES, PROFILE_DEFAULT, PROFILE_KEY,
  HISTORY_KEY, HISTORY_MAX,
  STATUS_META as _STATUS_META,
  INGREDIENT_GROUP_META, REASON_LABELS, MESSAGES,
} from "./config/shared-config.js";
import { normalizeBarcode, isValidBarcode as isValidBarcodeUtil } from "./barcode.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const SCAN_FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E];

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
  missingPhotoData:    null, // base64 string of captured image for missing modal
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

// ─── Share ────────────────────────────────────────────────────────────────────

function getShareUrl(barcode, profileId) {
  const base = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({ b: barcode });
  if (profileId && profileId !== PROFILE_DEFAULT) params.set("p", profileId);
  return `${base}?${params}`;
}

// ─── Verdict card image generation (canvas-based) ─────────────────────────────

const STATUS_COLORS = {
  GREEN:   { bg: "#f0fdf4", border: "#22c55e", text: "#166534", icon: "✓" },
  YELLOW:  { bg: "#fefce8", border: "#eab308", text: "#854d0e", icon: "◐" },
  ORANGE:  { bg: "#fff7ed", border: "#f97316", text: "#9a3412", icon: "?" },
  RED:     { bg: "#fef2f2", border: "#ef4444", text: "#991b1b", icon: "✕" },
  UNKNOWN: { bg: "#f9fafb", border: "#9ca3af", text: "#374151", icon: "—" },
};

function buildVerdictImage(barcode, status, productName, brand, reasons) {
  const W = 600, H = 340;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const col = STATUS_COLORS[status] || STATUS_COLORS.UNKNOWN;
  const label = STATUS_META[status]?.label ?? status;

  // Background
  ctx.fillStyle = col.bg;
  ctx.fillRect(0, 0, W, H);

  // Left accent bar
  ctx.fillStyle = col.border;
  ctx.fillRect(0, 0, 8, H);

  // Brand strip top-right
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("jaini", W - 28, 38);
  ctx.fillStyle = "#666";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText("jain.swapncore.com", W - 28, 56);

  // Big status icon
  ctx.fillStyle = col.border;
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(col.icon, 30, 100);

  // Status label
  ctx.fillStyle = col.text;
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.fillText(label, 30, 148);

  // Product name (truncate if needed)
  const maxNameW = W - 60;
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 20px system-ui, sans-serif";
  let displayName = productName || "Unknown product";
  while (displayName.length > 4 && ctx.measureText(displayName).width > maxNameW) {
    displayName = displayName.slice(0, -1);
  }
  if (displayName !== (productName || "Unknown product")) displayName += "…";
  ctx.fillText(displayName, 30, 188);

  // Brand
  if (brand) {
    ctx.fillStyle = "#555";
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillText(brand, 30, 212);
  }

  // Reason chips
  if (reasons && reasons.length) {
    const chipY = brand ? 238 : 224;
    ctx.font = "13px system-ui, sans-serif";
    let x = 30;
    reasons.slice(0, 5).forEach(r => {
      const label = r.replace(/_/g, " ").toLowerCase();
      const tw = ctx.measureText(label).width + 20;
      if (x + tw > W - 30) return;
      ctx.fillStyle = col.border + "30";
      ctx.strokeStyle = col.border;
      ctx.lineWidth = 1;
      const rx = x, ry = chipY - 16, rw = tw, rh = 22;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 11);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.text;
      ctx.fillText(label, rx + 10, chipY);
      x += tw + 8;
    });
  }

  // Barcode at bottom
  ctx.fillStyle = "#999";
  ctx.font = "12px monospace, system-ui";
  ctx.fillText(barcode, 30, H - 18);

  // Divider line
  ctx.strokeStyle = col.border + "40";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, H - 34); ctx.lineTo(W - 30, H - 34);
  ctx.stroke();

  return c;
}

async function handleShare(barcode, status, productName, brand, reasons) {
  const profile  = getActiveProfile();
  const url      = getShareUrl(barcode, profile);
  const verdict  = STATUS_META[status]?.label ?? "Unknown";
  const title    = `Jaini: ${productName ? productName + " — " : ""}${verdict}`;
  const text     = `${productName ? productName + " — " : ""}${verdict} (Jaini Jain dietary check)`;

  // Try to share as image first (modern browsers + mobile)
  if (navigator.share && navigator.canShare) {
    try {
      const canvas = buildVerdictImage(barcode, status, productName, brand, reasons);
      const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
      const file = new File([blob], "jaini-verdict.png", { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title, text, url, files: [file] });
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      // fall through — image share failed, try URL share
    }
  }

  // Fallback: share URL only (desktop / unsupported browsers)
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }

  // Last resort: copy URL to clipboard
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
      if (entry.verdictData) {
        // Show cached verdict instantly without API call
        clearMessage();
        hideResult();
        stopScanning();
        renderResult(entry.verdictData);
      } else {
        fetchVerdict(entry.barcode).catch(() => renderError(MESSAGES.genericError));
      }
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
  } catch { /* fire-and-forget — UI already updated optimistically */
    reportClientEvent("feedback_failed", { barcode, error_msg: "network_error" });
  }
}

// ─── Client failure telemetry ──────────────────────────────────────────────

async function reportClientEvent(eventType, opts = {}) {
  // opts: { barcode, profile, error_code, error_msg, response_ms }
  try {
    await fetchWithTimeout(`${getApiBase()}/v1/client_event`, {
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
      const label = STATUS_META[(a.status||"").toUpperCase()]?.label || a.status;
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

  // Confidence — API returns HIGH/MED/LOW; map MED→Medium for display + CSS
  const confRaw = (data.confidence || "").toUpperCase();
  const confDisplay = confRaw === "MED" ? "Medium" : capitalize(confRaw.toLowerCase());
  const confClass   = confRaw === "HIGH" ? " conf-high" : confRaw === "MED" ? " conf-medium" : confRaw === "LOW" ? " conf-low" : "";
  el.confidenceText.textContent = confDisplay ? `Confidence: ${confDisplay}` : "";
  el.confidenceText.className = `confidence-chip${confClass}`;

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
    chip.textContent = REASON_LABELS[r] || r.replace(/_/g, " ").toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
    chip.setAttribute("title", r);  // show raw code on hover for debugging
    el.reasonChips.appendChild(chip);
  });

  // Community verification section
  showCommunitySection(state.currentBarcode, data.community || null);

  // Jain-friendly alternatives (for RED/ORANGE)
  fetchAndRenderAlternatives(state.currentBarcode, data.status);

  // Persist to scan history (cache full verdict for instant replay)
  historyPush({
    barcode:      state.currentBarcode,
    status:       status,
    product_name: data.product_name || "",
    brand:        data.brand || "",
    profile:      getActiveProfile(),
    ts:           new Date().toISOString(),
    verdictData:  data,
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
  const limit = escHtml(String(data?.limit ?? "?"));
  const count = escHtml(String(data?.count ?? "?"));
  const reset = escHtml(String(data?.reset ?? "unknown"));
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
  const normalized = normalizeBarcode(rawBarcode);
  // Use expanded UPC-A for API lookup (UPC-E → 12-digit), otherwise cleaned digits
  const barcode = normalized.upc12 || normalized.ean13 || normalized.cleaned;
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

  const tStart = Date.now();

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
    reportClientEvent("camera_error", { error_msg: "permission_denied" });
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
  const dataUrl = c.toDataURL("image/jpeg", 0.85);
  setMissingPhoto(dataUrl);
}

function setMissingPhoto(dataUrl) {
  state.missingPhotoData = dataUrl;
  if (el.missingPreviewImg) el.missingPreviewImg.src = dataUrl;
  show(el.missingPreview);
  hide(el.missingVideo);
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
      `${getApiBase()}/v1/submit_missing_photo`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
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
      showFormMsg(el.missingModal, "Thanks! We received your photo and will review it shortly.", "success");
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
    const { barcode, status, name, brand, reasons } = el.shareBtn.dataset;
    if (barcode) handleShare(barcode, status, name, brand, JSON.parse(reasons || "[]"));
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
    startMissingCamera();
    if (el.missingSubmitBtn) el.missingSubmitBtn.disabled = true;
    if (el.missingSubmitLabel) el.missingSubmitLabel.textContent = "Capture a photo first";
  });
  el.missingFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setMissingPhoto(ev.target.result);
    reader.readAsDataURL(file);
    // Reset so re-selecting the same file triggers change event
    e.target.value = "";
  });
  el.missingCloseBtn?.addEventListener("click", () => {
    stopMissingCamera();
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

  // Report modal
  document.getElementById("reportModalClose")?.addEventListener("click", () => closeModal(el.reportModal));
  document.getElementById("reportModalCancel")?.addEventListener("click", () => closeModal(el.reportModal));
  el.reportForm?.addEventListener("submit", handleReportSubmit);

  // Close modals on backdrop click
  el.reportModal?.addEventListener("click", e => {
    if (e.target === el.reportModal) closeModal(el.reportModal);
  });
  el.missingModal?.addEventListener("click", e => {
    if (e.target === el.missingModal) { stopMissingCamera(); closeModal(el.missingModal); }
  });

  // Close modals on Escape
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (el.reportModal && !el.reportModal.classList.contains("hidden")) closeModal(el.reportModal);
      if (el.missingModal && !el.missingModal.classList.contains("hidden")) { stopMissingCamera(); closeModal(el.missingModal); }
    }
  });

  // Clean up cameras on unload
  window.addEventListener("beforeunload", () => { stopScanning(); stopMissingCamera(); });

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
