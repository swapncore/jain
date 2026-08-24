/**
 * consent.js — explicit consent management for Jaini's web app.
 *
 * WHY THIS EXISTS
 * ---------------
 * Jaini judges food against a user's Jain dietary MODE. That mode reflects
 * religious observance, which is special-category data under GDPR Article 9 and
 * requires EXPLICIT consent before processing. The old app had none: it ran the
 * scan and loaded Google's sign-in scripts on first paint, with no prompt.
 *
 * This module is the single source of truth for what the user has agreed to. It
 * records an affirmative choice (a button click, never a pre-tick or "by
 * continuing"), versions it so a material policy change can re-ask, and gates:
 *   • the scan-to-verdict feature   (needs `essential` consent — the Art. 9 basis)
 *   • third-party sign-in scripts   (Google/Firebase — needs `thirdParty` consent)
 *
 * It deliberately stores only a tiny record in localStorage and talks to no
 * server: consent state is a local fact about this browser.
 */

const CONSENT_KEY = "JAIN_CONSENT";
// Bump when the policy changes materially enough to require re-consent. Kept in
// sync with the "Last updated" date on privacy.html.
export const CONSENT_VERSION = "2026-08-24";

/** @typedef {{ version:string, ts:string, essential:boolean, thirdParty:boolean }} ConsentRecord */

/** Read the stored consent record, or null if none/!current/corrupt. */
export function getConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || rec.version !== CONSENT_VERSION) return null; // stale → re-ask
    return rec;
  } catch {
    return null;
  }
}

/** True once the user has answered the current consent prompt at all. */
export function hasDecided() {
  return getConsent() !== null;
}

/**
 * True if the user granted the basis needed to run a scan (process their dietary
 * mode). Without this the verdict feature must stay disabled.
 */
export function canScan() {
  return getConsent()?.essential === true;
}

/** True if the user allowed loading third-party sign-in scripts (Google/Firebase). */
export function canLoadThirdParty() {
  return getConsent()?.thirdParty === true;
}

/**
 * Persist an affirmative choice. `essential` is the Art. 9 basis for scanning;
 * `thirdParty` covers optional Google/Firebase sign-in. Returns the record.
 * @returns {ConsentRecord}
 */
export function recordConsent({ essential, thirdParty }, nowIso) {
  const rec = {
    version: CONSENT_VERSION,
    ts: nowIso || new Date().toISOString(),
    essential: essential === true,
    thirdParty: thirdParty === true,
  };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(rec));
  } catch {
    /* private-mode / storage disabled: consent lives only for this page view */
  }
  return rec;
}

/** Withdraw consent entirely (used by a "manage/withdraw" control). */
export function clearConsent() {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* ignore */
  }
}
