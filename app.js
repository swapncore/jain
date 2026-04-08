/**
 * app.js — Thin entry point for the Jaini web app.
 *
 * Imports all modules, wires up event listeners, and initializes the app.
 * Business logic lives in the src/ modules.
 */

import { initProfileSelector, getActiveProfile, setActiveProfile, PROFILES } from "./src/profile.js";
import { startScanning, stopScanning, bindTorchEvent, preWarmBarcodeLibs } from "./src/scanner.js";
import {
  initVerdict, fetchVerdict, renderError, hideResult, triggerManualBarcode,
  updateManualState, isManualValid, clearVerdictCache, displayVerdictData,
  bindShareEvent, FREE_SCAN_KEY,
} from "./src/verdict.js";
import { renderHistory, syncServerHistory, clearHistory, historyPush } from "./src/history.js";
import { bindFeedbackEvents } from "./src/community.js";
import { bindMissingEvents, stopMissingCameraExport } from "./src/missing.js";
import { show, hide, setLoading, clearMessage, showMessage, openModal, closeModal } from "./src/ui.js";
import { getApiBase, getClientId, reportClientEvent } from "./src/api.js";
import { MESSAGES } from "./src/config.js";

import * as Auth from "./auth.js";
import * as Favorites from "./favorites.js";
import * as Monetization from "./monetization.js";

// ── Shared app state ────────────────────────────────────────────────────────

const state = {
  reader:               null,
  controls:             null,
  torchOn:              false,
  inFlight:             false,
  scanLocked:           false,
  requestId:            0,
  verdictFailsafeTimer: null,
  lastBarcode:          "",
  lastScanAt:           0,
  pendingBarcode:       "",
  pendingCount:         0,
  currentBarcode:       "",
  missingPhotoData:     null,
};

// ── Auth UI helpers ─────────────────────────────────────────────────────────

function openAuthModal(subtitle) {
  const authModal = document.getElementById("authModal");
  openModal(authModal);
  const btns = authModal?.querySelector(".auth-buttons");
  if (btns) btns.classList.remove("hidden");
  hide(document.getElementById("authModalError"));
  const sub = authModal?.querySelector(".auth-modal-sub");
  if (sub && subtitle) sub.textContent = subtitle;
}

function toggleUserDropdown() {
  const userDropdown = document.getElementById("userDropdown");
  const userMenuBtn = document.getElementById("userMenuBtn");
  if (!userDropdown) return;
  const isOpen = !userDropdown.classList.contains("hidden");
  if (isOpen) {
    userDropdown.classList.add("hidden");
    userMenuBtn?.setAttribute("aria-expanded", "false");
  } else {
    const user = Auth.getUser();
    const userDropdownEmail = document.getElementById("userDropdownEmail");
    if (userDropdownEmail) userDropdownEmail.textContent = user?.email || "";
    userDropdown.classList.remove("hidden");
    userMenuBtn?.setAttribute("aria-expanded", "true");
    _loadEmailPref();
  }
}

async function _loadEmailPref() {
  const emailPrefCheckbox = document.getElementById("emailPrefCheckbox");
  if (!emailPrefCheckbox) return;
  try {
    const resp = await Auth.authFetch(`${getApiBase()}/v1/email/preferences`);
    if (resp.ok) {
      const prefs = await resp.json();
      emailPrefCheckbox.checked = prefs.weekly_digest !== false;
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
    const emailPrefCheckbox = document.getElementById("emailPrefCheckbox");
    if (emailPrefCheckbox) emailPrefCheckbox.checked = !value;
  }
}

function closeUserDropdown() {
  document.getElementById("userDropdown")?.classList.add("hidden");
  document.getElementById("userMenuBtn")?.setAttribute("aria-expanded", "false");
}

function updateAuthNav(user) {
  const signInBtn = document.getElementById("signInBtn");
  const userMenuBtn = document.getElementById("userMenuBtn");
  const userAvatar = document.getElementById("userAvatar");
  const userName = document.getElementById("userName");

  if (user) {
    hide(signInBtn);
    if (userAvatar) userAvatar.src = user.avatar_url || "";
    if (userName) userName.textContent = user.display_name || user.email?.split("@")[0] || "Account";
    show(userMenuBtn);
  } else {
    show(signInBtn);
    hide(userMenuBtn);
    closeUserDropdown();
  }
}

// ── Render history wrapper ──────────────────────────────────────────────────

function doRenderHistory() {
  renderHistory({
    state,
    onRescan: (barcode, verdictData, entryProfile) => {
      if (verdictData && entryProfile === getActiveProfile()) {
        clearMessage();
        hideResult();
        stopScanning(state);
        displayVerdictData(verdictData, barcode, true);
      } else {
        fetchVerdict(barcode).catch(() => renderError(MESSAGES.genericError));
      }
    },
  });
}

// ── Event binding ───────────────────────────────────────────────────────────

function bindEvents() {
  const manualInput = document.getElementById("manualBarcode");
  const manualForm = document.getElementById("manualForm");
  const startCameraBtn = document.getElementById("startCameraBtn");
  const stopCameraBtn = document.getElementById("stopCameraBtn");
  const newScanBtn = document.getElementById("newScanBtn");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const cameraArea = document.getElementById("cameraArea");
  const scanTriggerArea = document.getElementById("scanTriggerArea");
  const scanStatus = document.getElementById("scanStatus");
  const offlineBanner = document.getElementById("offlineBanner");
  const checkBtn = document.getElementById("checkBtn");

  // Manual input
  manualInput.addEventListener("input", updateManualState);
  manualInput.addEventListener("blur", updateManualState);
  manualInput.addEventListener("paste", () => setTimeout(updateManualState, 0));

  // Manual form submit
  manualForm.addEventListener("submit", e => {
    e.preventDefault();
    if (state.inFlight || state.scanLocked) return;
    if (!updateManualState()) {
      showMessage({ variant: "error", message: MESSAGES.invalidBarcode });
      return;
    }
    stopScanning(state);
    hide(cameraArea);
    state.scanLocked = true;
    fetchVerdict(manualInput.value);
  });

  // Camera start
  startCameraBtn.addEventListener("click", () => {
    hideResult();
    clearMessage();
    setLoading(false, "Looking up product\u2026", isManualValid);
    startScanning(state, fetchVerdict, renderError, showMessage);
  });

  // Camera stop
  stopCameraBtn?.addEventListener("click", () => {
    stopScanning(state);
    hide(cameraArea);
    show(scanTriggerArea);
    if (scanStatus) scanStatus.textContent = "Camera stopped.";
  });

  // New scan
  newScanBtn.addEventListener("click", () => {
    clearMessage();
    hideResult();
    setLoading(false, "Looking up product\u2026", isManualValid);
    hide(newScanBtn);
    manualInput.value = "";
    updateManualState();
    startScanning(state, fetchVerdict, renderError, showMessage);
  });

  // Try another barcode (from not-found state)
  document.getElementById("tryAnotherBtn")?.addEventListener("click", () => {
    clearMessage();
    hideResult();
    hide(newScanBtn);
    manualInput.value = "";
    updateManualState();
    startScanning(state, fetchVerdict, renderError, showMessage);
  });

  // Clear history
  clearHistoryBtn?.addEventListener("click", () => {
    clearHistory(doRenderHistory);
  });

  // Torch
  bindTorchEvent();

  // Community feedback
  bindFeedbackEvents(() => state.currentBarcode);

  // Missing product
  bindMissingEvents(() => state.currentBarcode);

  // Share
  bindShareEvent();

  // Clean up cameras on unload
  window.addEventListener("beforeunload", () => { stopScanning(state); stopMissingCameraExport(); });

  // Offline / online detection
  if (!navigator.onLine) {
    show(offlineBanner);
    if (startCameraBtn) startCameraBtn.disabled = true;
    if (checkBtn) checkBtn.disabled = true;
  }
  window.addEventListener("offline", () => {
    show(offlineBanner);
    if (startCameraBtn) startCameraBtn.disabled = true;
    if (checkBtn) checkBtn.disabled = true;
  });
  window.addEventListener("online", () => {
    hide(offlineBanner);
    if (startCameraBtn) startCameraBtn.disabled = false;
    updateManualState();
  });
}

// ── Theme toggle ────────────────────────────────────────────────────────────

function bindThemeToggle() {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("JAIN_THEME", next); } catch (e) {}
  });
}

function bindAuthEvents() {
  const authModal = document.getElementById("authModal");
  const missingModal = document.getElementById("missingModal");

  document.getElementById("signInBtn")?.addEventListener("click", () => openAuthModal());
  document.getElementById("userMenuBtn")?.addEventListener("click", toggleUserDropdown);

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    const userDropdown = document.getElementById("userDropdown");
    if (userDropdown && !userDropdown.classList.contains("hidden")) {
      const wrap = document.getElementById("userMenuBtn")?.closest(".user-menu-wrap");
      if (wrap && !wrap.contains(e.target)) {
        closeUserDropdown();
      }
    }
  });

  document.getElementById("authModalClose")?.addEventListener("click", () => closeModal(authModal));
  authModal?.addEventListener("click", (e) => {
    if (e.target === authModal) closeModal(authModal);
  });

  // Email preference toggle
  document.getElementById("emailPrefCheckbox")?.addEventListener("change", (e) => {
    _toggleEmailPref(e.target.checked);
  });

  document.getElementById("dropdownSignOutBtn")?.addEventListener("click", async () => {
    await Auth.signOut();
    closeUserDropdown();
    hideResult();
    clearMessage();
    document.getElementById("newScanBtn")?.classList.add("hidden");
    document.getElementById("scanTriggerArea")?.classList.remove("hidden");
    const manualInput = document.getElementById("manualBarcode");
    if (manualInput) manualInput.value = "";
    updateManualState();
  });

  // Close modals on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (missingModal && !missingModal.classList.contains("hidden")) {
        stopMissingCameraExport(); closeModal(missingModal); return;
      }
      if (authModal && !authModal.classList.contains("hidden")) {
        closeModal(authModal); return;
      }
      closeUserDropdown();
    }
  });
}

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  getClientId();

  // Initialize verdict module with shared state
  initVerdict({
    state,
    openAuthModal,
    renderHistory: doRenderHistory,
  });

  // URL params for shared links
  const _urlParams = new URLSearchParams(window.location.search);
  const _urlBarcode = _urlParams.get("b");
  const _urlProfile = _urlParams.get("p");
  if (_urlProfile && PROFILES.some(p => p.id === _urlProfile)) {
    setActiveProfile(_urlProfile);
  }

  // Profile selector with re-fetch on change
  initProfileSelector({
    onProfileChange: (newProfile, prevProfile) => {
      const resultSection = document.getElementById("resultSection");
      if (state.lastBarcode && resultSection && !resultSection.classList.contains("hidden")) {
        fetchVerdict(state.lastBarcode);
      }
    },
  });

  bindEvents();
  bindAuthEvents();
  bindThemeToggle();
  doRenderHistory();
  hideResult();
  clearMessage();
  updateManualState();
  hide(document.getElementById("cameraArea"));
  hide(document.getElementById("cameraBlockedMsg"));
  hide(document.getElementById("newScanBtn"));
  show(document.getElementById("scanTriggerArea"));

  // Auth
  const apiBase = getApiBase();

  Auth.onAuthStateChange((user) => {
    clearVerdictCache();
    updateAuthNav(user);
    Favorites.onAuthChange();
    const authModal = document.getElementById("authModal");
    if (user && authModal && !authModal.classList.contains("hidden")) {
      closeModal(authModal);
    }
    if (user) {
      localStorage.removeItem(FREE_SCAN_KEY);
      document.getElementById("freeScanBanner")?.remove();
    }
    if (user) syncServerHistory(doRenderHistory);
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

  // Update auth nav
  updateAuthNav(Auth.getUser());

  // Auto-fetch shared barcode
  if (_urlBarcode && /^\d{8}$|^\d{12,13}$/.test(_urlBarcode)) {
    history.replaceState(null, "", window.location.pathname);
    fetchVerdict(_urlBarcode).catch(() => renderError(MESSAGES.genericError));
  }

  // Pre-warm barcode libs
  preWarmBarcodeLibs();
}

init();

// ── Service worker registration ─────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ── App store link detection ────────────────────────────────────────────────
(function () {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(navigator.userAgentData?.platform || navigator.platform || "") && navigator.maxTouchPoints > 1);
  const link = document.getElementById("getAppLink");
  if (link) {
    link.href = isIOS
      ? "https://apps.apple.com/app/id6760580801"
      : "https://play.google.com/store/apps/details?id=com.swapncore.jaini";
  }
})();

// Global error tracking
window.onerror = (msg, src, line, col, err) => {
  reportClientEvent("js_error", { error_msg: `${msg} at ${src}:${line}:${col}` });
};
window.addEventListener("unhandledrejection", (e) => {
  reportClientEvent("js_error", { error_msg: `Unhandled: ${e.reason?.message || e.reason}` });
});
