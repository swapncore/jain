/**
 * ui.js — DOM helpers, modal management, loading states, and error display.
 *
 * Provides shared UI primitives used across all modules. DOM elements are
 * accessed via querySelector — no global refs.
 */

// ── Show / Hide / Toggle ────────────────────────────────────────────────────

export function show(el) { el?.classList.remove("hidden"); }
export function hide(el) { el?.classList.add("hidden"); }
export function toggle(el, on) { el?.classList.toggle("hidden", !on); }

// ── Loading state ───────────────────────────────────────────────────────────

export function setLoading(active, text = "Looking up product\u2026", isManualValidFn) {
  const progressWrap = document.getElementById("progressWrap");
  const progressText = document.getElementById("progressText");
  const checkBtn = document.getElementById("checkBtn");

  toggle(progressWrap, active);
  if (progressText) progressText.textContent = text;
  if (checkBtn) checkBtn.disabled = active || (isManualValidFn ? !isManualValidFn() : false);
}

// ── Message box ─────────────────────────────────────────────────────────────

export function clearMessage() {
  const messageBox = document.getElementById("messageBox");
  if (messageBox) {
    messageBox.className = "notice hidden";
    messageBox.replaceChildren();
  }
}

export function showMessage({ message, variant = "info", domContent = null }) {
  const messageBox = document.getElementById("messageBox");
  if (!messageBox) return;

  messageBox.className = `notice notice-${variant}`;

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
    wrapper.appendChild(domContent);
  } else {
    const p = document.createElement("p");
    p.textContent = message;
    wrapper.appendChild(p);
  }

  messageBox.replaceChildren(svg, wrapper);
  show(messageBox);
}

// ── Modal management ────────────────────────────────────────────────────────

function trapFocus(modal, e) {
  if (e.key !== "Tab") return;
  const focusable = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

export function openModal(modal) {
  show(modal);
  document.body.classList.add("modal-open");
  const first = modal.querySelector("button, input, textarea, select, a[href]");
  first?.focus();
  modal._trapFocusHandler = (e) => trapFocus(modal, e);
  modal.addEventListener("keydown", modal._trapFocusHandler);
}

export function closeModal(modal) {
  if (modal._trapFocusHandler) {
    modal.removeEventListener("keydown", modal._trapFocusHandler);
    modal._trapFocusHandler = null;
  }
  hide(modal);
  clearFormMsg(modal);
  const anyOpen = document.querySelector('.modal-backdrop:not(.hidden)');
  if (!anyOpen) document.body.classList.remove("modal-open");
}

export function clearFormMsg(modal) {
  const msg = modal.querySelector(".form-msg");
  if (msg) { msg.className = "form-msg hidden"; msg.textContent = ""; }
}

export function showFormMsg(modal, message, type = "success") {
  const msg = modal.querySelector(".form-msg");
  if (!msg) return;
  msg.className = `form-msg ${type}`;
  msg.textContent = message;
  show(msg);
}

// ── First-scan celebration ──────────────────────────────────────────────────

export function showFirstScanCelebration() {
  const toast = document.createElement("div");
  toast.className = "first-scan-toast";
  toast.setAttribute("role", "status");
  const confetti = document.createElement("span");
  confetti.className = "first-scan-confetti";
  confetti.textContent = "\u{1F389}";
  toast.appendChild(confetti);
  toast.appendChild(document.createTextNode(" You're all set! Scan any product to check if it's Jain-friendly."));
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// ── Free scan banner ────────────────────────────────────────────────────────

export function showFreeScanBanner(remaining, openAuthModalFn) {
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
    openAuthModalFn("Sign in with Google for unlimited scans");
    banner.remove();
  });

  banner.appendChild(text);
  banner.appendChild(link);

  const insertTarget = document.getElementById("resultSection") || document.getElementById("messageBox");
  if (insertTarget?.parentNode) {
    insertTarget.parentNode.insertBefore(banner, insertTarget.nextSibling);
  }

  setTimeout(() => { banner.classList.add("free-scan-banner--fade"); }, 7000);
  setTimeout(() => { banner.remove(); }, 8000);
}
