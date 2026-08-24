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
import { bindReportEvents } from "./src/report.js";
import { bindAccountEvents } from "./src/account.js";
import { show, hide, setLoading, clearMessage, showMessage, openModal, closeModal } from "./src/ui.js";
import { getApiBase, getClientId, reportClientEvent } from "./src/api.js";
import { MESSAGES, DEMO_BARCODES } from "./src/config.js";
import { historyLoad } from "./lib/history.js";
import { canScan, canLoadThirdParty } from "./src/consent.js";
import { initConsentBanner, openConsentPrompt } from "./src/consentBanner.js";

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
  if (sub) sub.textContent = "Enter your email: we'll send you a one-tap sign-in link. No password needed.";
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

// ── Consent gate ──────────────────────────────────────────────────────────────

// A scan (camera, manual, demo, favourite, shared link) processes the user's
// dietary mode = Article 9 special-category data. It may run ONLY with essential
// consent. This is the UI-side guard that stops the camera from even powering on;
// fetchVerdict() in verdict.js is the network-side backstop.
function ensureScanConsent() {
  if (canScan()) return true;
  openConsentPrompt();
  return false;
}

// ── Auth (third-party) lazy loader ────────────────────────────────────────────

// Firebase / Google Identity Services are third-party scripts. They must not
// load before the user opts in (Accept) or actively chooses to sign in (intent).
// This memoises the one-time load so both triggers converge on a single init().
let _authReadyPromise = null;
function ensureAuthReady() {
  if (!_authReadyPromise) _authReadyPromise = Auth.init();
  return _authReadyPromise;
}

// ── Auth UI helpers ─────────────────────────────────────────────────────────

function openAuthModal(subtitle) {
  const authModal = document.getElementById("authModal");
  _showEmailStep();
  _clearMagicLinkError();
  const sub = document.getElementById("authModalSub");
  if (sub && subtitle) sub.textContent = subtitle;
  openModal(authModal);
  // Opening the sign-in modal is an explicit intent to authenticate, so this is
  // the moment we're permitted to load Firebase + render Google's button.
  ensureAuthReady().catch(() => {});
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
      // Opt-in must be affirmative. `!== false` rendered the box ALREADY TICKED
      // whenever the server returned null/undefined (i.e. the user has never
      // expressed a preference) — a pre-ticked consent box, which is invalid
      // consent under GDPR (Planet49, C-673/17) and contradicts our own policy
      // wording. auth.js:143 already got this right; the two paths disagreed
      // about the same checkbox.
      emailPrefCheckbox.checked = prefs.weekly_digest === true;
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

// ── First-run experience ────────────────────────────────────────────────────

/** True once the user has at least one scan on this device. */
function hasAnyScans() {
  try { return historyLoad().length > 0; } catch { return false; }
}

// "Try these examples" chips — first run only, so a new user has something to
// tap instead of a bare form. Ported from the mobile ScanScreen.
function renderDemoChips() {
  const section = document.getElementById("demoSection");
  const grid = document.getElementById("demoChips");
  if (!section || !grid) return;

  if (hasAnyScans()) {
    hide(section);
    return;
  }

  if (!grid.childElementCount) {
    DEMO_BARCODES.forEach(d => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "demo-chip";
      btn.dataset.barcode = d.barcode;
      btn.setAttribute("aria-label", `Check example product ${d.label}`);

      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("width", "14");
      icon.setAttribute("height", "14");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "2");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<rect x="3" y="3" width="2" height="18"/><rect x="7" y="3" width="1" height="18"/><rect x="10" y="3" width="3" height="18"/><rect x="15" y="3" width="1" height="18"/><rect x="18" y="3" width="3" height="18"/>';

      const label = document.createElement("span");
      label.className = "demo-chip-text";
      label.textContent = d.label;

      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        if (state.inFlight || state.scanLocked) return;
        if (!ensureScanConsent()) return;
        const manualInput = document.getElementById("manualBarcode");
        if (manualInput) { manualInput.value = d.barcode; updateManualState(); }
        fetchVerdict(d.barcode).catch(() => renderError(MESSAGES.genericError));
      });
      grid.appendChild(btn);
    });
  }
  show(section);
}

// ── Render history wrapper ──────────────────────────────────────────────────

function doRenderHistory() {
  renderHistory({
    state,
    onRescan: (barcode, verdictData, entryProfile) => {
      // Re-displaying a stored verdict is still processing the dietary mode, so
      // it is gated too. (fetchVerdict has its own backstop for the else-branch.)
      if (!ensureScanConsent()) return;
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
  // Examples and history are mutually exclusive: the chips are the empty state.
  renderDemoChips();
  Favorites.onFirstRunStateChange();
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
    if (!ensureScanConsent()) return;
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
    if (!ensureScanConsent()) return;
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
    if (!ensureScanConsent()) return;
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
    if (!ensureScanConsent()) return;
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

  // Detailed misclassification report
  bindReportEvents(() => state.currentBarcode);

  // Account deletion
  bindAccountEvents({
    onDeleted: () => {
      closeUserDropdown();
      hideResult();
      clearMessage();
      doRenderHistory();
      hide(document.getElementById("newScanBtn"));
      show(document.getElementById("scanTriggerArea"));
      const mi = document.getElementById("manualBarcode");
      if (mi) mi.value = "";
      updateManualState();
      showMessage({
        variant: "info",
        message: "Your account and associated data have been permanently removed.",
      });
    },
  });

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

    // The sign-in modal loads Firebase lazily; make sure it's ready before we
    // call into it (the user may submit faster than the CDN import resolves).
    try {
      await ensureAuthReady();
    } catch {
      _setMagicLinkLoading(false);
      _showMagicLinkError("Couldn't load sign-in. Please check your connection and try again.");
      return;
    }

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
      await ensureAuthReady();
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
      const deleteModal = document.getElementById("deleteAccountModal");
      const reportModal = document.getElementById("reportModal");
      if (deleteModal && !deleteModal.classList.contains("hidden")) {
        closeModal(deleteModal); return;
      }
      if (reportModal && !reportModal.classList.contains("hidden")) {
        closeModal(reportModal); return;
      }
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
    onNeedConsent: openConsentPrompt,
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

  // First-visit Article 9 consent prompt + footer "Privacy choices" control.
  // When the user opts into third-party sign-in, warm up Firebase so Google's
  // button is ready by the time they open the sign-in modal.
  initConsentBanner({
    onDecision: (rec) => {
      if (rec?.thirdParty === true) ensureAuthReady().catch(() => {});
    },
  });

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

  // Third-party sign-in scripts (Firebase + Google) must NOT load on first paint
  // without consent. Load them only when the user has opted in, OR when they've
  // arrived via a magic sign-in link (that click IS the intent to authenticate).
  const _arrivedViaMagicLink = Auth.isMagicLinkUrl();
  if (canLoadThirdParty() || _arrivedViaMagicLink) {
    await ensureAuthReady();
  }

  // Magic link completion — MUST run after Auth.init() so _auth is set. Guarded
  // by _arrivedViaMagicLink, so it only runs when we actually loaded Firebase.
  if (_arrivedViaMagicLink) {
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
    hasAnyScans,
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

  // Pre-warm barcode libs — these are third-party scripts (ZXing on a CDN), so
  // only fetch them once scanning is actually permitted. The on-demand scan path
  // still loads them behind the same consent gate.
  if (canScan()) preWarmBarcodeLibs();
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
