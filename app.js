import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";
import {
  DecodeHintType,
  BarcodeFormat,
} from "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/+esm";

const STORAGE_KEYS = {
  clientId: "JAIN_CLIENT_ID",
};

const DEFAULTS = {
  prodApi: "https://web-production-31034.up.railway.app",
  devApi: "http://localhost:8000",
};

const STATUS_COLORS = ["GREEN", "YELLOW", "ORANGE", "RED", "UNKNOWN"];
const INGREDIENT_ROW_ORDER = ["RED", "ORANGE", "YELLOW", "GREEN"];
const CATEGORY_META = {
  RED: { label: "Not allowed" },
  ORANGE: { label: "Verify with maker" },
  YELLOW: { label: "Strict Jain" },
  GREEN: { label: "Allowed" },
};

const SCAN_FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A];
const REQUEST_TIMEOUT_MS = 9000;
const VERDICT_FAILSAFE_MS = 8500; // just under request timeout; only fires if fetch truly stalls

const FRIENDLY_MESSAGES = {
  invalidBarcode: "Please enter a valid 12 or 13 digit barcode.",
  network: "We couldn't retrieve product data. Please check your connection or try again later.",
  timeout: "This request took too long. Please try again.",
  cameraPermission: "We couldn't access your camera. Please allow camera access and try again.",
  cameraUnsupported: "Camera scanning isn't supported in this browser.",
  scannerStalled: "The scan was captured, but we couldn't finish the lookup. Please try again.",
};

const el = {
  newScanBtn: document.getElementById("newScanBtn"),
  videoWrap: document.getElementById("videoWrap") || document.querySelector(".video-wrap"),
  video: document.getElementById("videoPreview"),
  scanStatus: document.getElementById("scanStatus"),
  progressWrap: document.getElementById("progressWrap"),
  progressText: document.getElementById("progressText"),
  messageBox: document.getElementById("messageBox"),
  manualForm: document.getElementById("manualForm"),
  manualInput: document.getElementById("manualBarcode"),
  manualHelp: document.getElementById("manualHelp"),
  checkBtn: document.getElementById("checkBtn"),
  resultSection: document.getElementById("resultSection"),
  verdictCard: document.getElementById("verdictCard"),
  statusLabel: document.getElementById("statusLabel"),
  explainText: document.getElementById("explainText"),
  confidenceText: document.getElementById("confidenceText"),
  reasonChips: document.getElementById("reasonChips"),
  savedNote: document.getElementById("savedNote"),
  reportIssueLink: document.getElementById("reportIssueLink"),
  ingredientsPanel: document.getElementById("ingredientsPanel"),
  ingredientsText: document.getElementById("ingredientsText"),
  ingredientSection: document.getElementById("ingredientSection"),
  ingredientRows: document.getElementById("ingredientRows"),
  barcodeInfo: document.getElementById("barcodeInfo"),
};

const state = {
  controls: null,
  reader: null,
  lastScanAt: 0,
  lastBarcode: "",
  inFlight: false,
  scanLocked: false,
  requestId: 0,
  verdictFailsafeTimer: null,
};

function defaultApiBaseUrl() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return DEFAULTS.devApi;
  }
  return DEFAULTS.prodApi;
}

function getApiBaseUrl() {
  return defaultApiBaseUrl();
}

function getApiBaseCandidates() {
  const candidates = [];
  const add = (value) => {
    const cleaned = (value || "").trim().replace(/\/+$/, "");
    if (!cleaned || candidates.includes(cleaned)) return;
    candidates.push(cleaned);
  };

  const defaultBase = getApiBaseUrl();
  add(defaultBase);

  if (defaultBase === "http://localhost:8000") {
    add("http://127.0.0.1:8000");
  }
  if (defaultBase === "http://127.0.0.1:8000") {
    add("http://localhost:8000");
  }

  return candidates;
}

function makeFallbackId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getClientId() {
  const existing = localStorage.getItem(STORAGE_KEYS.clientId);
  if (existing) return existing;
  const id = window.crypto?.randomUUID ? window.crypto.randomUUID() : makeFallbackId();
  localStorage.setItem(STORAGE_KEYS.clientId, id);
  return id;
}

function onlyDigits(value) {
  return (value || "").replace(/\D/g, "");
}

function showNewScanButton(show) {
  if (!el.newScanBtn) return;
  el.newScanBtn.classList.toggle("hidden", !show);
}

function showCameraPanel(show) {
  if (!el.videoWrap) return;
  el.videoWrap.classList.toggle("hidden", !show);
}

function setLoading(active, text = "Looking up product details...") {
  el.progressWrap.classList.toggle("hidden", !active);
  el.progressText.textContent = text;
  if (el.checkBtn) {
    el.checkBtn.disabled = active || !isManualBarcodeValid();
  }
}

function clearMessage() {
  el.messageBox.className = "message-box hidden";
  el.messageBox.innerHTML = "";
}

function showMessage({ title, message, variant = "info", extraHtml = "" }) {
  el.messageBox.className = variant === "error" ? "message-box message-error" : "message-box";
  el.messageBox.textContent = "";
  if (title) {
    const h = document.createElement("h3");
    h.textContent = title;
    el.messageBox.appendChild(h);
  }
  if (message) {
    const p = document.createElement("p");
    p.textContent = message;
    el.messageBox.appendChild(p);
  }
  if (extraHtml) {
    const div = document.createElement("div");
    div.innerHTML = extraHtml; // static trusted markup (e.g. upgrade button)
    el.messageBox.appendChild(div);
  }
  el.messageBox.classList.remove("hidden");
}

function setSavedBanner(text) {
  el.savedNote.textContent = text || "";
}

function showReportIssue(show) {
  el.reportIssueLink.classList.toggle("hidden", !show);
}

function hideResult() {
  el.resultSection.classList.add("hidden");
  el.ingredientSection.classList.add("hidden");
  el.ingredientsPanel.classList.add("hidden");
  el.reasonChips.classList.remove("hidden");
  el.reasonChips.innerHTML = "";
  showReportIssue(false);
  setSavedBanner("");
}

function clearVerdictFailsafe() {
  if (state.verdictFailsafeTimer) {
    window.clearTimeout(state.verdictFailsafeTimer);
    state.verdictFailsafeTimer = null;
  }
}

function startVerdictFailsafe(requestId) {
  clearVerdictFailsafe();
  state.verdictFailsafeTimer = window.setTimeout(() => {
    if (requestId !== state.requestId || !state.inFlight) return;
    state.inFlight = false;
    renderGenericError(FRIENDLY_MESSAGES.scannerStalled);
    el.scanStatus.textContent = "Lookup stalled.";
  }, VERDICT_FAILSAFE_MS);
}

function presentOutcome() {
  stopScanning();
  clearVerdictFailsafe();
  setLoading(false);
  showCameraPanel(false);
  showNewScanButton(true);
  updateManualInputState();
}

function isManualBarcodeValid() {
  const digits = onlyDigits(el.manualInput.value);
  return digits.length === 12 || digits.length === 13;
}

function updateManualInputState() {
  const raw = el.manualInput.value;
  const allDigits = onlyDigits(raw);
  const hadNonNumeric = raw !== allDigits;

  // Strip non-digits but don't truncate — show an explicit error for >13
  el.manualInput.value = allDigits;

  let helpText = "Enter 12 or 13 digits.";
  let isError = false;

  if (hadNonNumeric) {
    helpText = "Only numbers are allowed.";
    isError = true;
  } else if (allDigits.length > 13) {
    helpText = `Too many digits (${allDigits.length}). Barcodes are 12 or 13 digits.`;
    isError = true;
  } else if (allDigits.length > 0 && allDigits.length < 12) {
    helpText = `Enter ${12 - allDigits.length} more digit${12 - allDigits.length === 1 ? "" : "s"}.`;
    isError = true;
  } else if (allDigits.length === 12) {
    helpText = "UPC-A detected (12 digits).";
  } else if (allDigits.length === 13) {
    helpText = "EAN-13 detected (13 digits).";
  }

  el.manualHelp.textContent = helpText;
  el.manualHelp.classList.toggle("field-help-error", isError && allDigits.length > 0);
  el.manualInput.setAttribute("aria-invalid", isError ? "true" : "false");
  if (el.checkBtn) {
    el.checkBtn.disabled = !isManualBarcodeValid() || state.inFlight;
  }

  return isManualBarcodeValid();
}

function renderIngredientRows(categories) {
  el.ingredientRows.innerHTML = "";

  INGREDIENT_ROW_ORDER.forEach((level) => {
    const row = document.createElement("div");
    row.className = "ingredient-row";
    row.setAttribute("role", "listitem");

    const meta = CATEGORY_META[level] || { label: level };

    const badge = document.createElement("span");
    badge.className = `ingredient-badge ingredient-badge-${level}`;
    badge.textContent = `${level} - ${meta.label}`;
    badge.setAttribute("aria-label", `${level}: ${meta.label}`);

    const items = Array.isArray(categories?.[level]) ? categories[level] : [];

    const value = document.createElement("div");
    value.className = "ingredient-values";
    value.textContent = items.length > 0 ? items.join(", ") : "-";

    row.appendChild(badge);
    row.appendChild(value);
    el.ingredientRows.appendChild(row);
  });
}

function renderResult(data) {
  clearMessage();
  setLoading(false);

  const status = STATUS_COLORS.includes(data.status) ? data.status : "UNKNOWN";
  el.resultSection.classList.remove("hidden");
  el.ingredientSection.classList.remove("hidden");
  el.ingredientsPanel.classList.remove("hidden");

  el.verdictCard.className = "verdict";
  el.verdictCard.classList.add(`verdict-${status}`);
  el.statusLabel.textContent = status;
  el.explainText.textContent = data.explain || "No explanation available.";
  el.confidenceText.textContent = `Verdict: ${status} | Confidence: ${data.confidence || "--"}`;

  el.reasonChips.innerHTML = "";
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  if (reasons.length > 0) {
    el.reasonChips.classList.remove("hidden");
    reasons.forEach((reason) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = reason;
      el.reasonChips.appendChild(chip);
    });
  } else {
    el.reasonChips.classList.add("hidden");
  }

  setSavedBanner(data.saved ? "Saved for future scans" : "");
  showReportIssue(true);

  el.ingredientsText.textContent = data.ingredients_text || "Ingredients not available.";
  renderIngredientRows(data.ingredient_categories);
  const productName = data.product_name ? `Product: ${data.product_name}` : "Product: Unknown";
  const brand = data.brand ? `Brand: ${data.brand}` : "Brand: Unknown";
  el.barcodeInfo.textContent = `${productName} | ${brand} | Matched barcode: ${data.barcode} | Profile: ${data.profile}`;
  presentOutcome();
}

function renderNotFound(_errorJson, requestedBarcode) {
  hideResult();
  setLoading(false);

  showMessage({
    title: "Product not found",
    message: `No verdict is available yet for barcode ${onlyDigits(requestedBarcode)} in the current dataset.`,
    variant: "error",
  });

  presentOutcome();
}

function renderRateLimit(errorJson) {
  hideResult();
  setLoading(false);

  const limit = errorJson?.limit ?? "?";
  const count = errorJson?.count ?? "?";
  const reset = errorJson?.reset ?? "unknown";

  showMessage({
    title: "Daily limit reached",
    message: `You've used ${count} of ${limit} free requests today. Your limit resets on ${reset}.`,
    variant: "error",
    extraHtml: `
      <div class="message-actions">
        <button type="button" id="upgradeBtn">Upgrade</button>
      </div>
    `,
  });

  document.getElementById("upgradeBtn")?.addEventListener("click", () => {
    window.open("mailto:hello@swapncore.com?subject=JainScan%20upgrade", "_blank");
  });

  presentOutcome();
}

function renderGenericError(message) {
  hideResult();
  setLoading(false);
  showMessage({
    title: "Something went wrong",
    message: message || FRIENDLY_MESSAGES.network,
    variant: "error",
  });
  presentOutcome();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchVerdict(rawBarcode) {
  const barcode = onlyDigits(rawBarcode);
  if (!(barcode.length === 12 || barcode.length === 13)) {
    updateManualInputState();
    showMessage({
      title: "Barcode needed",
      message: FRIENDLY_MESSAGES.invalidBarcode,
      variant: "error",
    });
    hideResult();
    return;
  }

  const requestId = ++state.requestId;
  state.inFlight = true;
  state.scanLocked = true;

  clearMessage();
  hideResult();
  setLoading(true, "Checking product details...");
  el.scanStatus.textContent = "Checking verdict...";
  startVerdictFailsafe(requestId);

  try {
    const candidates = getApiBaseCandidates();
    let sawTimeout = false;

    for (const baseUrl of candidates) {
      if (requestId !== state.requestId) return;

      const url = new URL(`${baseUrl}/v1/verdict`);
      url.searchParams.set("barcode", barcode);
      url.searchParams.set("profile", "jain");

      let response;
      try {
        response = await fetchWithTimeout(
          url.toString(),
          {
            method: "GET",
            headers: {
              "X-Client-Id": getClientId(),
            },
          },
          REQUEST_TIMEOUT_MS,
        );
      } catch (err) {
        if (requestId !== state.requestId) return;
        if (err?.name === "AbortError") {
          sawTimeout = true;
        }
        continue;
      }

      if (requestId !== state.requestId) return;

      const data = await response.json().catch(() => ({}));
      if (requestId !== state.requestId) return;

      if (response.ok) {
        renderResult(data);
        el.scanStatus.textContent = `Scan complete: ${barcode}`;
        return;
      }

      if (response.status === 404 && data.error === "NOT_FOUND") {
        renderNotFound(data, barcode);
        el.scanStatus.textContent = `No result yet for ${barcode}`;
        return;
      }

      if (response.status === 429 && data.error === "RATE_LIMIT") {
        renderRateLimit(data);
        el.scanStatus.textContent = "Daily limit reached.";
        return;
      }

      if (response.status >= 500 && response.status <= 599) {
        continue;
      }

      renderGenericError(FRIENDLY_MESSAGES.network);
      el.scanStatus.textContent = "Lookup failed.";
      return;
    }

    if (requestId !== state.requestId) return;
    if (sawTimeout) {
      renderGenericError(FRIENDLY_MESSAGES.timeout);
      el.scanStatus.textContent = "Lookup timed out.";
    } else {
      renderGenericError(FRIENDLY_MESSAGES.network);
      el.scanStatus.textContent = "Network issue.";
    }
  } catch {
    if (requestId !== state.requestId) return;
    renderGenericError(FRIENDLY_MESSAGES.network);
    el.scanStatus.textContent = "Network issue.";
  } finally {
    if (requestId === state.requestId) {
      clearVerdictFailsafe();
      state.inFlight = false;
      state.scanLocked = false;
      setLoading(false);
      updateManualInputState();
    }
  }
}

async function pickBackCameraDeviceId() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return null;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter((device) => device.kind === "videoinput");
    if (videos.length === 0) return null;
    const preferred = videos.find((device) => /back|rear|environment/i.test(device.label || ""));
    return (preferred || videos[0]).deviceId || null;
  } catch {
    return null;
  }
}

function onDecodedText(decodedText) {
  if (state.scanLocked || state.inFlight) return;

  const digits = onlyDigits(decodedText);
  const now = Date.now();

  if (!(digits.length === 12 || digits.length === 13)) {
    return;
  }

  if (digits === state.lastBarcode && now - state.lastScanAt < 2200) {
    return;
  }

  state.lastBarcode = digits;
  state.lastScanAt = now;
  state.scanLocked = true;

  el.scanStatus.textContent = `Detected ${digits}. Checking...`;
  fetchVerdict(digits).catch(() => {
    renderGenericError(FRIENDLY_MESSAGES.network);
    el.scanStatus.textContent = "Lookup failed.";
  });
}

async function startScanning() {
  if (state.controls) return;

  clearMessage();
  hideResult();
  setLoading(false);

  if (!navigator.mediaDevices?.getUserMedia) {
    renderGenericError(FRIENDLY_MESSAGES.cameraUnsupported);
    el.scanStatus.textContent = "Camera not available.";
    return;
  }

  showNewScanButton(false);
  showCameraPanel(true);
  state.scanLocked = false;

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);

  state.reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 100,
    delayBetweenScanSuccess: 600,
  });

  try {
    const onResult = (result) => {
      if (result) {
        onDecodedText(result.getText());
      }
    };

    const preferredDeviceId = await pickBackCameraDeviceId();
    try {
      state.controls = await state.reader.decodeFromVideoDevice(preferredDeviceId, el.video, onResult);
    } catch {
      state.controls = await state.reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        el.video,
        onResult,
      );
    }

    el.scanStatus.textContent = "Scanner is live. Point your camera at the barcode.";
  } catch {
    renderGenericError(FRIENDLY_MESSAGES.cameraPermission);
    el.scanStatus.textContent = "Camera access needed.";
    showNewScanButton(true);
  }
}

function stopScanning() {
  try {
    if (state.controls) {
      state.controls.stop();
      state.controls = null;
    }
  } catch {
    state.controls = null;
  }

  try {
    if (state.reader) {
      state.reader.reset();
      state.reader = null;
    }
  } catch {
    state.reader = null;
  }
}

function bindEvents() {
  el.manualInput.addEventListener("input", updateManualInputState);
  el.manualInput.addEventListener("blur", updateManualInputState);

  el.manualForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!updateManualInputState()) {
      showMessage({
        title: "Barcode needed",
        message: FRIENDLY_MESSAGES.invalidBarcode,
        variant: "error",
      });
      hideResult();
      return;
    }

    stopScanning();
    showCameraPanel(false);
    state.scanLocked = true;
    fetchVerdict(el.manualInput.value);
  });

  el.newScanBtn.addEventListener("click", () => {
    clearMessage();
    hideResult();
    setLoading(false);
    startScanning();
  });

  el.reportIssueLink?.addEventListener("click", (event) => {
    event.preventDefault();
    window.open("mailto:hello@swapncore.com?subject=JainScan%20verdict%20issue", "_blank");
  });

  window.addEventListener("beforeunload", () => {
    stopScanning();
  });
}

function init() {
  getClientId();
  bindEvents();
  renderIngredientRows(null);
  hideResult();
  clearMessage();
  setSavedBanner("");
  showReportIssue(false);
  showNewScanButton(false);
  updateManualInputState();
  el.scanStatus.textContent = "Starting camera...";

  startScanning();
}

init();
