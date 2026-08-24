/**
 * consentBanner.js — the first-visit consent modal that fronts consent.js.
 *
 * WHY THIS EXISTS
 * ---------------
 * consent.js is the state machine; this module is its UI. Jaini judges food
 * against the user's Jain dietary MODE, which reflects religious observance and
 * is special-category data under GDPR Article 9. Processing it — and loading any
 * third-party sign-in script — requires an EXPLICIT, affirmative choice: a real
 * button press, never a pre-tick or "by continuing to use the site".
 *
 * This module:
 *   • shows a focus-trapped, aria-modal prompt on first visit (when
 *     `!hasDecided()`), offering Accept / Essential only / Decline;
 *   • is dismissible ONLY by making one of those choices (Escape and backdrop
 *     clicks do NOT silently leave the decision undone — declining is itself a
 *     valid, recorded choice);
 *   • wires a "Privacy choices" control so the user can WITHDRAW consent as
 *     easily as they granted it (GDPR Art. 7(3)), which clears the record and
 *     re-shows this prompt.
 *
 * It builds its own DOM (no markup required in index.html) and talks only to
 * consent.js — it never touches the network.
 */

import {
  hasDecided,
  recordConsent,
  clearConsent,
} from "./consent.js";

let _modal = null;
let _onDecision = null;
let _lastFocus = null;
let _keydownHandler = null;

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Build the modal element once and cache it. Content is entirely hardcoded. */
function buildModal() {
  const backdrop = document.createElement("div");
  backdrop.id = "consentModal";
  backdrop.className = "modal-backdrop consent-modal hidden";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "consent-modal-title");
  backdrop.setAttribute("aria-describedby", "consent-modal-body");

  // No close (X) button by design: the only ways out are the three choices,
  // so the decision can never be left undone.
  backdrop.innerHTML = `
    <div class="modal-box modal-box--sm consent-box">
      <div class="consent-badge" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <h2 class="modal-title consent-title" id="consent-modal-title">Before you scan: your privacy</h2>
      <div class="consent-body" id="consent-modal-body">
        <p>Jaini judges a product against your chosen <strong>Jain dietary mode</strong>
        (for example Everyday, Temple, or Paryushan). That choice reflects
        <strong>religious dietary observance</strong>, which the GDPR treats as
        <strong>special-category data (Article&nbsp;9)</strong>. We ask for your explicit
        consent before we use it to check a product.</p>
        <p>Choosing <strong>Essential only</strong> keeps everything on your device and lets
        you scan, with no Google or Firebase sign-in scripts loading until you actually choose to
        sign in. Choosing <strong>Accept</strong> also allows those optional sign-in scripts
        so you can save favourites and history across devices.</p>
        <p class="consent-links">
          Read the full <a href="./privacy.html" class="consent-link">Privacy Policy</a>.
          You can change or withdraw your choice any time from the
          <strong>Privacy choices</strong> link in the footer.
        </p>
      </div>
      <div class="consent-actions">
        <button type="button" class="btn btn-primary consent-btn" data-consent="accept">
          Accept
        </button>
        <button type="button" class="btn btn-ghost consent-btn" data-consent="essential">
          Essential only
        </button>
        <button type="button" class="btn btn-ghost consent-btn consent-btn--decline" data-consent="decline">
          Decline
        </button>
      </div>
      <p class="consent-foot">No pre-ticked boxes. Nothing is shared with anyone until you choose.</p>
    </div>
  `;

  backdrop.querySelectorAll("[data-consent]").forEach((btn) => {
    btn.addEventListener("click", () => decide(btn.getAttribute("data-consent")));
  });

  // Backdrop clicks must NOT dismiss without a decision.
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      // Nudge focus back into the dialog rather than closing it.
      backdrop.querySelector(".consent-btn")?.focus();
    }
  });

  document.body.appendChild(backdrop);
  return backdrop;
}

/** Record the choice, close the prompt, and notify the app. */
function decide(choice) {
  let rec;
  if (choice === "accept") {
    rec = recordConsent({ essential: true, thirdParty: true });
  } else if (choice === "essential") {
    rec = recordConsent({ essential: true, thirdParty: false });
  } else {
    // decline — a real, recorded decision that blocks scanning.
    rec = recordConsent({ essential: false, thirdParty: false });
  }
  closeConsentPrompt();
  if (typeof _onDecision === "function") {
    try { _onDecision(rec); } catch { /* app callback must not break the gate */ }
  }
}

function onKeydown(e) {
  if (!_modal || _modal.classList.contains("hidden")) return;
  if (e.key === "Tab") {
    const items = Array.from(_modal.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  } else if (e.key === "Escape") {
    // Escape must NOT silently dismiss an undecided prompt — a required,
    // explicit choice cannot be escaped away.
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Show the consent prompt (creating it if needed). */
export function openConsentPrompt() {
  if (!_modal) _modal = buildModal();
  _lastFocus = document.activeElement;
  _modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  if (!_keydownHandler) {
    _keydownHandler = onKeydown;
    // Capture phase so we intercept Escape before other global handlers.
    document.addEventListener("keydown", _keydownHandler, true);
  }
  // Focus the primary action so keyboard/screen-reader users land inside.
  setTimeout(() => _modal.querySelector(".consent-btn")?.focus(), 30);
}

/** Hide the consent prompt and restore focus. */
export function closeConsentPrompt() {
  if (!_modal) return;
  _modal.classList.add("hidden");
  if (_keydownHandler) {
    document.removeEventListener("keydown", _keydownHandler, true);
    _keydownHandler = null;
  }
  const anyOpen = document.querySelector(".modal-backdrop:not(.hidden)");
  if (!anyOpen) document.body.classList.remove("modal-open");
  try { _lastFocus?.focus?.(); } catch { /* element may be gone */ }
}

/**
 * Wire up the consent flow. Call once on app load.
 *  - shows the prompt on first visit (when the user hasn't decided);
 *  - binds the footer "Privacy choices" control to withdraw + re-ask.
 * @param {{ onDecision?: (rec:any)=>void }} opts
 */
export function initConsentBanner({ onDecision } = {}) {
  _onDecision = onDecision || null;

  // Footer control(s): withdraw consent, then re-show the prompt. As easy to
  // withdraw as to grant (GDPR Art. 7(3)).
  document.querySelectorAll("[data-consent-manage]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      clearConsent();
      openConsentPrompt();
    });
  });

  if (!hasDecided()) openConsentPrompt();
}
