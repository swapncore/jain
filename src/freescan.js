/**
 * freescan.js — Anonymous free-scan accounting.
 *
 * Kept DOM-free and side-effect-free apart from localStorage so the policy can
 * be unit-tested directly.
 *
 * THE RULE: only a real server lookup costs a free scan. Rendering a verdict is
 * NOT the same thing as fetching one — cached session hits, Recent-scans
 * clicks and community submissions all render without a lookup, and used to
 * burn the allowance. An anonymous user who scanned one product and re-opened
 * it twice was locked out after a single scan.
 *
 * The server's own count is authoritative when it sends one; local counting is
 * a fallback for when it does not.
 */

export const FREE_SCAN_KEY = "JAINI_FREE_SCANS";
export const FREE_SCAN_LIMIT = 3;

export function getFreeScanCount() {
  try {
    const n = parseInt(localStorage.getItem(FREE_SCAN_KEY) || "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

export function setFreeScanCount(count) {
  try { localStorage.setItem(FREE_SCAN_KEY, String(Math.max(0, count))); } catch { /* storage disabled */ }
  return Math.max(0, count);
}

export function incrementFreeScanCount() {
  return setFreeScanCount(getFreeScanCount() + 1);
}

/**
 * Read the server's authoritative remaining-scan signal from a /v1/verdict
 * response.
 *
 * The X-RateLimit-Remaining header is checked first (that is what the mobile
 * clients read), but the header is not currently emitted by the backend and
 * would additionally need Access-Control-Expose-Headers to be readable
 * cross-origin — so the JSON body's `scans_remaining` is the field that
 * actually carries the number today. Both are supported; null means the
 * server said nothing and local counting should take over.
 *
 * @returns {number|null}
 */
export function readServerScansRemaining(resp, data) {
  const raw = resp?.headers?.get?.("X-RateLimit-Remaining");
  if (raw != null && String(raw).trim() !== "") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  if (typeof data?.scans_remaining === "number" && Number.isFinite(data.scans_remaining)) {
    return Math.max(0, data.scans_remaining);
  }
  return null;
}

/**
 * Record that one real server lookup happened and return how many free scans
 * remain. Call this ONLY after the network actually answered with a verdict.
 *
 * @param {number|null} serverRemaining - from readServerScansRemaining()
 * @returns {number} remaining free scans
 */
export function recordServerLookup(serverRemaining = null) {
  if (serverRemaining != null) {
    const remaining = Math.max(0, Math.min(FREE_SCAN_LIMIT, serverRemaining));
    // Mirror the server's number locally so the pre-flight gate agrees with
    // the backend instead of drifting from it.
    setFreeScanCount(FREE_SCAN_LIMIT - remaining);
    return remaining;
  }
  return Math.max(0, FREE_SCAN_LIMIT - incrementFreeScanCount());
}

/** True when an anonymous user has no free scans left. */
export function isFreeScanExhausted() {
  return getFreeScanCount() >= FREE_SCAN_LIMIT;
}
