/**
 * sanitize.js — XSS prevention utilities for Jaini web app.
 *
 * All user-provided text and API-returned strings must be sanitized
 * before being inserted into the DOM. Prefer textContent over innerHTML
 * wherever possible.
 */

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
