/**
 * submission.js — Missing-product submission transport and verdict shaping.
 *
 * DOM-free on purpose: missing.js owns the modal wiring, this module owns the
 * request/response contract so it can be unit-tested without a browser.
 *
 * POST /v1/submit_missing returns the FULL verdict it just computed
 * (status / reasons / confidence / explain / ingredient_categories), so no
 * second round trip is needed on success. On 409 CONFLICT the product already
 * exists and no verdict comes back — the caller falls back to GET /v1/verdict.
 */

import { fetchWithTimeout, getApiBase, getClientId, ENDPOINTS } from "./api.js";

export const SUBMIT_TIMEOUT_MS = 15000;
export const MIN_INGREDIENTS_CHARS = 5;

/**
 * Build the POST body. Field names are fixed by the backend's
 * SubmitMissingRequest model — all five are always sent, empty strings allowed.
 */
export function buildSubmitBody({ barcode, ingredientsText, productName, brand, profile }) {
  return {
    barcode: String(barcode || ""),
    ingredients_text: String(ingredientsText || "").trim(),
    product_name: String(productName || "").trim(),
    brand: String(brand || "").trim(),
    profile: String(profile || "everyday_jain"),
  };
}

/**
 * Turn a /v1/submit_missing response into a renderable verdict.
 *
 * HONESTY REQUIREMENT: this verdict was computed from text a user typed and has
 * NOT been checked against the packaging. The submit endpoint does not return
 * the provenance fields (they belong to /v1/verdict), so they are stamped here
 * — the row is always written server-side with review_status="unverified".
 * These two fields are what make the result card render
 * "Community-submitted · unverified", exactly as the mobile apps label it.
 * Never let a submit response present itself as a catalog verdict.
 */
export function buildCommunityVerdict(data, barcode) {
  return {
    ...(data || {}),
    barcode: data?.barcode || barcode,
    data_source: "community",
    verified: false,
    saved: false,
  };
}

/**
 * Shape check mirroring the mobile app's isLikelyIngredientList heuristic.
 * Only used for a soft, dismissible warning — never to block a submission.
 */
export function looksLikeIngredientList(text) {
  const t = String(text || "").trim();
  if (t.length < 20) return false;
  return (t.match(/[,;]/g) || []).length >= 2;
}

/**
 * POST typed ingredients to /v1/submit_missing.
 *
 * @returns {Promise<{ok: boolean, status: number, data: Object}>}
 *   ok=true  → data is the verdict payload (pass through buildCommunityVerdict)
 *   status=409 → product already exists; fetch GET /v1/verdict instead
 */
export async function submitMissingIngredients({
  barcode, ingredientsText, productName = "", brand = "", profile = "everyday_jain",
  accessToken = null,
}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Client-Id": getClientId(),
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const resp = await fetchWithTimeout(
    `${getApiBase()}${ENDPOINTS.submit_missing}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(buildSubmitBody({ barcode, ingredientsText, productName, brand, profile })),
    },
    SUBMIT_TIMEOUT_MS,
  );

  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}
