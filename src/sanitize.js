/**
 * sanitize.js — XSS prevention utilities for Jaini web app.
 *
 * All user-provided text and API-returned strings must be sanitized
 * before being inserted into the DOM. Prefer textContent over innerHTML
 * wherever possible; use escapeHtml only when building HTML strings
 * that include safe structural markup around user data.
 */

/**
 * Escape HTML special characters to prevent XSS injection.
 * @param {*} str - Value to escape (coerced to string).
 * @returns {string} Escaped string safe for innerHTML insertion.
 */
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validate a barcode string strictly: digits only, 8-13 characters.
 * Use this before ANY DOM insertion of barcode values.
 * @param {string} raw - Raw barcode input.
 * @returns {string|null} Cleaned digits if valid, null otherwise.
 */
export function sanitizeBarcode(raw) {
  const cleaned = String(raw ?? "").replace(/\D/g, "");
  if (cleaned.length >= 8 && cleaned.length <= 13) return cleaned;
  return null;
}

/**
 * Sanitize a product name or ingredient string for safe DOM insertion.
 * Strips HTML tags and trims whitespace.
 * @param {*} str - Value to sanitize.
 * @returns {string} Cleaned string.
 */
export function sanitizeText(str) {
  return String(str ?? "")
    .replace(/<[^>]*>/g, "")
    .trim();
}
