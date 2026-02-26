import { BrowserMultiFormatReader } from "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";
import {
  DecodeHintType,
  BarcodeFormat,
} from "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/+esm";

const STORAGE_KEYS = {
  apiBase: "JAIN_API_BASE_URL",
  clientId: "JAIN_CLIENT_ID",
};

const DEFAULTS = {
  prodApi: "https://api.swapncore.com",
  devApi: "http://localhost:8000",
};

const LEGACY_PROD_APIS = new Set([
  "https://api.jain.swapncore.com",
  "http://api.jain.swapncore.com",
]);

const STATUS_COLORS = ["GREEN", "YELLOW", "ORANGE", "RED", "UNKNOWN"];
const INGREDIENT_ROW_ORDER = ["RED", "ORANGE", "YELLOW", "GREEN"];
const SCAN_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_8,
];
const REQUEST_TIMEOUT_MS = 9000;
const VERDICT_FAILSAFE_MS = 6500;

const el = {
  settingsBtn: document.getElementById("settingsBtn"),
  newScanBtn: document.getElementById("newScanBtn"),
  video: document.getElementById("videoPreview"),
  scanStatus: document.getElementById("scanStatus"),
  manualForm: document.getElementById("manualForm"),
  manualInput: document.getElementById("manualBarcode"),
  resultSection: document.getElementById("resultSection"),
  verdictCard: document.getElementById("verdictCard"),
  statusLabel: document.getElementById("statusLabel"),
  explainText: document.getElementById("explainText"),
  confidenceText: document.getElementById("confidenceText"),
  reasonChips: document.getElementById("reasonChips"),
  ingredientRows: document.getElementById("ingredientRows"),
  barcodeInfo: document.getElementById("barcodeInfo"),
  errorArea: document.getElementById("errorArea"),
  settingsModal: document.getElementById("settingsModal"),
  settingsForm: document.getElementById("settingsForm"),
  apiBaseInput: document.getElementById("apiBaseInput"),
  resetApiBtn: document.getElementById("resetApiBtn"),
  cancelSettingsBtn: document.getElementById("cancelSettingsBtn"),
  clientIdText: document.getElementById("clientIdText"),
};

const state = {
  controls: null,
  reader: null,
  lastScanAt: 0,
  lastBarcode: "",
  inFlight: false,
  scanLocked: false,
  verdictFailsafeTimer: null,
};

function defaultApiBaseUrl() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return DEFAULTS.devApi;
  }
  return DEFAULTS.prodApi;
}

function normalizeApiBase(input) {
  const value = (input || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return "";
  }
}

function saveApiBaseUrl(value) {
  if (!value) {
    localStorage.removeItem(STORAGE_KEYS.apiBase);
    return;
  }
  localStorage.setItem(STORAGE_KEYS.apiBase, value);
}

function getStoredApiOverride() {
  const stored = normalizeApiBase(localStorage.getItem(STORAGE_KEYS.apiBase));
  if (!stored) {
    return "";
  }

  if (LEGACY_PROD_APIS.has(stored)) {
    const replacement = DEFAULTS.prodApi;
    if (replacement === defaultApiBaseUrl()) {
      saveApiBaseUrl("");
      return "";
    }
    saveApiBaseUrl(replacement);
    return replacement;
  }

  return stored;
}

function getApiBaseUrl() {
  return getStoredApiOverride() || defaultApiBaseUrl();
}

function getApiBaseCandidates() {
  const candidates = [];
  const add = (value) => {
    const normalized = normalizeApiBase(value);
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  const override = getStoredApiOverride();
  const defaultBase = defaultApiBaseUrl();

  add(override);
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
  if (!el.newScanBtn) {
    return;
  }
  el.newScanBtn.classList.toggle("hidden", !show);
}

function clearVerdictFailsafe() {
  if (state.verdictFailsafeTimer) {
    window.clearTimeout(state.verdictFailsafeTimer);
    state.verdictFailsafeTimer = null;
  }
}

function startVerdictFailsafe() {
  clearVerdictFailsafe();
  state.verdictFailsafeTimer = window.setTimeout(() => {
    if (!state.inFlight) {
      return;
    }
    state.inFlight = false;
    renderGenericError("Scan captured, but lookup stalled. Tap NEW SCAN and try again.");
    el.scanStatus.textContent = "Lookup stalled.";
  }, VERDICT_FAILSAFE_MS);
}

function renderIngredientRows(categories) {
  el.ingredientRows.innerHTML = "";
  INGREDIENT_ROW_ORDER.forEach((level) => {
    const row = document.createElement("div");
    row.className = "ingredient-row";

    const label = document.createElement("div");
    label.className = `ingredient-label ingredient-label-${level}`;
    label.textContent = level;

    const value = document.createElement("div");
    value.className = "ingredient-values";
    const items = Array.isArray(categories?.[level]) ? categories[level] : [];
    value.textContent = items.length > 0 ? items.join(", ") : "—";

    row.appendChild(label);
    row.appendChild(value);
    el.ingredientRows.appendChild(row);
  });
}

function presentOutcome() {
  stopScanning();
  clearVerdictFailsafe();
  showNewScanButton(true);
}

function renderResult(data) {
  const status = STATUS_COLORS.includes(data.status) ? data.status : "UNKNOWN";
  el.resultSection.classList.remove("hidden");

  el.verdictCard.className = "verdict";
  el.verdictCard.classList.add(`verdict-${status}`);
  el.statusLabel.textContent = status;
  el.explainText.textContent = data.explain || "No explanation available.";
  el.confidenceText.textContent = `Confidence: ${data.confidence || "--"}`;

  el.reasonChips.innerHTML = "";
  const reasons = Array.isArray(data.reasons) ? data.reasons : [];
  if (reasons.length === 0) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "No reason codes";
    el.reasonChips.appendChild(chip);
  } else {
    reasons.forEach((reason) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = reason;
      el.reasonChips.appendChild(chip);
    });
  }

  renderIngredientRows(data.ingredient_categories);
  const productName = data.product_name ? `Product: ${data.product_name}` : "Product: Unknown";
  const brand = data.brand ? `Brand: ${data.brand}` : "Brand: Unknown";
  el.barcodeInfo.textContent = `${productName} | ${brand} | Matched barcode: ${data.barcode} | Profile: ${data.profile}`;
  el.errorArea.innerHTML = "";
  presentOutcome();
}

function renderNotFound(errorJson, requestedBarcode) {
  el.resultSection.classList.remove("hidden");
  el.verdictCard.className = "verdict verdict-UNKNOWN";
  el.statusLabel.textContent = "NOT_FOUND";
  el.explainText.textContent = "No precomputed verdict found for this barcode.";
  el.confidenceText.textContent = "Confidence: --";
  el.reasonChips.innerHTML = "";
  renderIngredientRows(null);

  const attempts = Array.isArray(errorJson?.attempts) ? errorJson.attempts.join(", ") : requestedBarcode;
  el.barcodeInfo.textContent = `Lookup attempts: ${attempts}`;

  el.errorArea.innerHTML = `
    <div class="error-card">
      <h3>404 NOT_FOUND</h3>
      <p>This barcode is not in the dataset yet.</p>
    </div>
  `;
  presentOutcome();
}

function renderRateLimit(errorJson) {
  el.resultSection.classList.remove("hidden");
  el.verdictCard.className = "verdict verdict-UNKNOWN";
  el.statusLabel.textContent = "RATE_LIMIT";
  el.explainText.textContent = "Daily free scan limit reached.";
  el.confidenceText.textContent = "Confidence: --";
  el.reasonChips.innerHTML = "";
  renderIngredientRows(null);
  el.barcodeInfo.textContent = "";

  const limit = errorJson?.limit ?? "?";
  const count = errorJson?.count ?? "?";
  const reset = errorJson?.reset ?? "unknown";

  el.errorArea.innerHTML = `
    <div class="error-card">
      <h3>429 RATE_LIMIT</h3>
      <p>Limit: ${limit}, current count: ${count}, reset: ${reset}</p>
      <div class="row">
        <button type="button" id="upgradeBtn">Upgrade</button>
      </div>
    </div>
  `;

  document.getElementById("upgradeBtn")?.addEventListener("click", () => {
    window.alert("Upgrade flow placeholder.");
  });
  presentOutcome();
}

function renderGenericError(message) {
  el.resultSection.classList.remove("hidden");
  el.verdictCard.className = "verdict verdict-UNKNOWN";
  el.statusLabel.textContent = "ERROR";
  el.explainText.textContent = message || "Unexpected error occurred.";
  el.confidenceText.textContent = "Confidence: --";
  el.reasonChips.innerHTML = "";
  renderIngredientRows(null);
  el.barcodeInfo.textContent = "";
  el.errorArea.innerHTML = "";
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
  if (!barcode) {
    renderGenericError("Please enter or scan a valid numeric barcode.");
    return;
  }
  if (state.inFlight) {
    return;
  }

  state.inFlight = true;
  el.scanStatus.textContent = "Checking verdict...";
  startVerdictFailsafe();

  try {
    const override = getStoredApiOverride();
    const candidates = getApiBaseCandidates();
    let sawTimeout = false;

    for (const baseUrl of candidates) {
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
        if (err?.name === "AbortError") {
          sawTimeout = true;
        }
        continue;
      }

      const data = await response.json().catch(() => ({}));
      const switchedFromStaleOverride = Boolean(override) && baseUrl !== override;
      if (switchedFromStaleOverride) {
        saveApiBaseUrl("");
      }

      if (response.ok) {
        renderResult(data);
        el.scanStatus.textContent = switchedFromStaleOverride
          ? `Last scan OK: ${barcode} (auto-switched API)`
          : `Last scan OK: ${barcode}`;
        return;
      }

      if (response.status === 404 && data.error === "NOT_FOUND") {
        renderNotFound(data, barcode);
        el.scanStatus.textContent = `No verdict for ${barcode}`;
        return;
      }

      if (response.status === 429 && data.error === "RATE_LIMIT") {
        renderRateLimit(data);
        el.scanStatus.textContent = "Rate limit reached.";
        return;
      }

      if (response.status >= 500 && response.status <= 599) {
        continue;
      }

      const err = data?.error ? `${data.error}` : `HTTP ${response.status}`;
      renderGenericError(`API error: ${err}`);
      el.scanStatus.textContent = "Scan failed.";
      return;
    }

    if (sawTimeout) {
      renderGenericError("Lookup timed out. Check API reachability and try NEW SCAN.");
      el.scanStatus.textContent = "Lookup timed out.";
    } else {
      renderGenericError("Network error. Check backend/tunnel and API settings.");
      el.scanStatus.textContent = "Network error.";
    }
  } catch {
    renderGenericError("Network error. Check backend/tunnel and API settings.");
    el.scanStatus.textContent = "Network error.";
  } finally {
    clearVerdictFailsafe();
    state.inFlight = false;
    state.scanLocked = false;
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
  if (state.scanLocked || state.inFlight) {
    return;
  }

  const digits = onlyDigits(decodedText);
  const now = Date.now();

  if (!digits || digits.length < 8) {
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
    renderGenericError("Unexpected lookup failure. Tap NEW SCAN and retry.");
    el.scanStatus.textContent = "Lookup failed.";
  });
}

async function startScanning() {
  if (state.controls) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    renderGenericError("This browser does not support camera scanning.");
    el.scanStatus.textContent = "Camera API unavailable.";
    return;
  }

  showNewScanButton(false);
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

    el.scanStatus.textContent = "Scanner live. Point camera at barcode.";
  } catch {
    renderGenericError("Camera access failed. Allow camera permission and retry.");
    el.scanStatus.textContent = "Unable to start camera.";
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

function openSettings() {
  el.apiBaseInput.value = getApiBaseUrl();
  el.clientIdText.textContent = `Client ID: ${getClientId()}`;
  el.settingsModal.showModal();
}

function closeSettings() {
  el.settingsModal.close();
}

function bindEvents() {
  el.manualForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.scanLocked = true;
    fetchVerdict(el.manualInput.value);
  });

  el.newScanBtn.addEventListener("click", () => {
    el.resultSection.classList.add("hidden");
    el.errorArea.innerHTML = "";
    startScanning();
  });

  el.settingsBtn.addEventListener("click", openSettings);

  el.cancelSettingsBtn.addEventListener("click", closeSettings);

  el.resetApiBtn.addEventListener("click", () => {
    el.apiBaseInput.value = defaultApiBaseUrl();
  });

  el.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const normalized = normalizeApiBase(el.apiBaseInput.value);
    if (!normalized) {
      window.alert("Please enter a valid API base URL like https://api.swapncore.com");
      return;
    }
    if (normalized === defaultApiBaseUrl()) {
      saveApiBaseUrl("");
    } else {
      saveApiBaseUrl(normalized);
    }
    closeSettings();
    el.scanStatus.textContent = `API base set to ${getApiBaseUrl()}`;
  });

  window.addEventListener("beforeunload", () => {
    stopScanning();
  });
}

function init() {
  getClientId();
  bindEvents();
  renderIngredientRows(null);
  showNewScanButton(false);
  el.scanStatus.textContent = `Starting camera... API: ${getApiBaseUrl()}`;

  // Auto-start camera to reduce friction on mobile.
  startScanning();
}

init();
