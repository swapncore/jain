/**
 * privacy.js — What "delete my data" actually has to erase on this device.
 *
 * Split out of account.js so it can be unit-tested: account.js reaches auth.js,
 * which imports Firebase from an absolute https:// URL (correct for raw ES
 * modules in a browser, unresolvable under Node), so nothing that imports it
 * can be covered by the test suite. The policy is the part worth testing, so
 * the policy lives here — same reasoning that put the free-scan rules in
 * freescan.js.
 */

import { HISTORY_KEY, PROFILE_KEY } from "./config.js";

/**
 * Every localStorage key holding something personal.
 *
 * Mirrors mobile's clearAllUserData() and adds the web-only keys. Two of these
 * were previously missed:
 *
 *   PROFILE_KEY ("JAIN_PROFILE") records the chosen strictness mode — Everyday,
 *   Temple, Paryushan, Greens+. That is a statement about the user's religious
 *   observance and is the most sensitive single value the app stores. It must
 *   not survive onto the next person to use a shared browser.
 *
 *   JAINI_FIRST_SCAN_DONE is weaker but still discloses prior use of the app on
 *   this device, which is exactly what a delete is supposed to remove.
 */
export const PERSONAL_LOCAL_KEYS = [
  HISTORY_KEY,             // "JAIN_HISTORY" — scan history
  PROFILE_KEY,             // "JAIN_PROFILE" — religious strictness mode
  "JAIN_FEEDBACK",         // community vote map (web key)
  "JAINI_FREE_SCANS",      // anonymous free-scan counter
  "JAINI_MAGIC_EMAIL",     // pending magic-link email
  "JAINI_FIRST_SCAN_DONE", // first-run flag — implies prior use of this device
];

/**
 * Prefix of the service worker's verdict cache (see CACHE_API in sw.js).
 *
 * Matched by prefix, not by exact name, so a future version bump in sw.js
 * cannot silently stop this from being cleared.
 */
export const API_CACHE_PREFIX = "jaini-api";

/** True for a Cache Storage entry that holds cached verdict responses. */
export function isApiCacheName(name) {
  return String(name ?? "").startsWith(API_CACHE_PREFIX);
}

/**
 * Delete every cached verdict response held by the service worker.
 *
 * sw.js keeps up to 100 verdict responses in a dedicated cache keyed by request
 * URL — and that URL carries both the barcode and the profile. Clearing
 * localStorage alone left all of it in place, so after "delete my account" the
 * previous user's scan list and chosen mode were still recoverable from the
 * browser's own storage.
 *
 * @param {CacheStorage} [cacheStorage] injectable for tests
 * @returns {Promise<string[]>} the cache names that were deleted
 */
export async function clearCachedVerdicts(cacheStorage = globalThis.caches) {
  if (!cacheStorage?.keys) return [];
  try {
    const names = await cacheStorage.keys();
    const targets = names.filter(isApiCacheName);
    await Promise.all(targets.map(n => cacheStorage.delete(n)));
    return targets;
  } catch {
    // Best effort. A browser that refuses cache access must not be able to
    // block the rest of the delete.
    return [];
  }
}

/**
 * Erase every trace of this user from this device.
 *
 * @param {Storage} [storage] injectable for tests
 * @param {CacheStorage} [cacheStorage] injectable for tests
 */
export async function clearPersonalLocalData(
  storage = globalThis.localStorage,
  cacheStorage = globalThis.caches,
) {
  for (const key of PERSONAL_LOCAL_KEYS) {
    try { storage?.removeItem(key); } catch { /* storage disabled */ }
  }
  return clearCachedVerdicts(cacheStorage);
}
