/**
 * app.js — Thin entry point for the Jaini web app.
 *
 * Imports all modules, wires up event listeners, and initializes the app.
 * Business logic lives in the src/ modules.
 */

import { initProfileSelector, getActiveProfile, setActiveProfile, PROFILES } from "./src/profile.js";
import { startScanning, stopScanning, bindTorchEvent, preWarmBarcodeLibs } from "./src/scanner.js";
import {
  initVerdict, fetchVerdict, renderError, hideResult,
  updateManualState, isManualValid, clearVerdictCache, displayVerdictData,
  bindShareEvent, FREE_SCAN_KEY,
} from "./src/verdict.js";
import { renderHistory, syncServerHistory, clearHistory } from "./src/history.js";
import { bindFeedbackEvents } from "./src/community.js";
import { bindMissingEvents, stopMissingCameraExport } from "./src/missing.js";
import { show, hide, setLoading, clearMessage, showMessage, openModal, closeModal } from "./src/ui.js";
import { getApiBase, getClientId, reportClientEvent } from "./src/api.js";
import { MESSAGES } from "./src/config.js";

import * as Auth from "./auth.js";
import * as Favorites from "./favorites.js";
import * as Monetization from "./monetization.js";

// ── Auth modal: magic link form helpers ──────────────────────────────────────

// true when the page was opened from a magic-link and we need the user to
// confirm their email address (cross-device case — no localStorage entry)
let _confirmingMagicLink = false;

function _showEmailStep() {
  document.getElementById("authEmailStep")?.classList.remove("hidden");
  document.getElementById("authSentStep")?.classList.add("hidden");
}

function _showSentStep(email) {
  document.getElementById("authEmailStep")?.classList.add("hidden");
  const sentStep = document.getElementById("authSentStep");
  sentStep?.classList.remove("hidden");
  const sentEmail = document.getElementById("authSentEmail");
  if (sentEmail) sentEmail.textContent = email;
}

function _setMagicLinkLoading(on) {
  const btn = document.getElementById("magicLinkBtn");
  const txt = document.getElementById("magicLinkBtnText");
  const spinner = document.getElementById("magicLinkBtnSpinner");
  if (btn) btn.disabled = on;
  if (txt) {
    if (on) {
      txt.textContent = _confirmingMagicLink ? "Signing you in…" : "Sending…";
    } else {
      txt.textContent = _confirmingMagicLink ? "Confirm & sign in" : "Send me a sign-in link";
    }
  }
  spinner?.classList.toggle("hidden", !on);
}

function _enterConfirmMagicLinkMode() {
  _confirmingMagicLink = true;
  const title = document.getElementById("auth-modal-title");
  const sub = document.getElementById("authModalSub");
  const btn = document.getElementById("magicLinkBtnText");
  if (title) title.textContent = "Confirm your email";
  if (sub) sub.textContent = "Enter the email address you used to request the sign-in link.";
  if (btn) btn.textContent = "Confirm & sign in";
}

function _exitConfirmMagicLinkMode() {
  _confirmingMagicLink = false;
  const title = document.getElementById("auth-modal-title");
  const sub = document.getElementById("authModalSub");
  const btn = document.getElementById("magicLinkBtnText");
  if (title) title.textContent = "Sign in to Jaini";
  if (sub) sub.textContent = "Enter your email — we'll send you a one-tap sign-in link. No password needed.";
  if (btn) btn.textContent = "Send me a sign-in link";
}

function _showMagicLinkError(msg) {
  const el = document.getElementById("authModalError");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function _clearMagicLinkError() {
  const el = document.getElementById("authModalError");
  if (el) { el.textContent = ""; el.classList.add("hidden"); }
}

// ── Shared app state ────────────────────────────────────────────────────────

const state = {
  inFlight:             false,
  scanLocked:           false,
  requestId:            0,
  verdictFailsafeTimer: null,
  lastBarcode:          "",
  lastScanAt:           0,
  pendingBarcode:       "",
  pendingCount:         0,
  currentBarcode:       "",
};

// ── Auth UI helpers ─────────────────────────────────────────────────────────

function openAuthModal(subtitle) {
  const authModal = document.getElementById("authModal");
  _showEmailStep();
  _clearMagicLinkError();
  const sub = document.getElementById("authModalSub");
  if (sub && subtitle) sub.textContent = subtitle;
  openModal(authModal);
  setTimeout(() => document.getElementById("magicLinkEmail")?.focus(), 80);
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

  document.getElementById("authModalClose")?.addEventListener("click", () => {
    closeModal(authModal);
    _showEmailStep();
    _clearMagicLinkError();
    _exitConfirmMagicLinkMode();
  });

  // Magic link form submit
  document.getElementById("magicLinkForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    _clearMagicLinkError();
    const email = document.getElementById("magicLinkEmail")?.value?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      _showMagicLinkError("Please enter a valid email address.");
      return;
    }
    _setMagicLinkLoading(true);

    if (_confirmingMagicLink) {
      // Cross-device: user confirmed their email, complete sign-in now
      try {
        await Auth.completeMagicLinkWithEmail(email);
        _exitConfirmMagicLinkMode();
        // onAuthStateChange will close the modal
      } catch (err) {
        _exitConfirmMagicLinkMode();
        if (err?.code === "auth/invalid-action-code" || err?.code === "auth/expired-action-code") {
          _showMagicLinkError("This sign-in link has expired or already been used. Enter your email to get a fresh one.");
        } else {
          _showMagicLinkError("Could not sign in. Please try again or request a new link.");
        }
      } finally {
        _setMagicLinkLoading(false);
      }
      return;
    }

    // Normal flow: send a new magic link
    try {
      await Auth.sendMagicLink(email);
      _showSentStep(email);
    } catch (err) {
      const msg = err?.code === "auth/too-many-requests"
        ? "Too many attempts. Please wait a moment and try again."
        : "Couldn't send the link. Please check your email and try again.";
      _showMagicLinkError(msg);
    } finally {
      _setMagicLinkLoading(false);
    }
  });

  // Resend link
  document.getElementById("magicLinkResendBtn")?.addEventListener("click", async () => {
    const email = document.getElementById("magicLinkEmail")?.value?.trim()
      || localStorage.getItem("JAINI_MAGIC_EMAIL");
    if (!email) { _showEmailStep(); return; }
    try {
      await Auth.sendMagicLink(email);
      // Brief confirmation
      const btn = document.getElementById("magicLinkResendBtn");
      if (btn) { const orig = btn.textContent; btn.textContent = "Sent!"; btn.disabled = true; setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000); }
    } catch { /* silent */ }
  });

  // Use different email
  document.getElementById("magicLinkChangeBtn")?.addEventListener("click", () => {
    _showEmailStep();
    document.getElementById("magicLinkEmail")?.focus();
  });
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

  // Magic link completion — MUST run after Auth.init() so _auth is set
  if (Auth.isMagicLinkUrl()) {
    const mlResult = await Auth.completeMagicLinkIfPresent();
    if (mlResult === "done") {
      // onAuthStateChange will update the UI and close any open modal
    } else if (mlResult === "needs-email") {
      // Opened on a different device — ask user to confirm their email
      openAuthModal();
      _enterConfirmMagicLinkMode();
    } else if (mlResult === "error") {
      openAuthModal();
      _showMagicLinkError("This sign-in link has expired or already been used. Enter your email to get a fresh one.");
    }
  }

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
