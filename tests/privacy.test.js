/**
 * privacy.test.js — What "delete my account" has to erase from this device.
 *
 * Regression cover for a shared-browser leak: clearing localStorage alone left
 * both the chosen religious mode and up to 100 cached verdict responses (each
 * keyed by barcode + profile) readable by the next person to use the browser.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PERSONAL_LOCAL_KEYS,
  API_CACHE_PREFIX,
  isApiCacheName,
  clearCachedVerdicts,
  clearPersonalLocalData,
} from "../src/privacy.js";
import { HISTORY_KEY, PROFILE_KEY } from "../src/config.js";

/** Minimal in-memory localStorage stand-in. */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

/** Minimal CacheStorage stand-in. */
function makeCaches(names = []) {
  let list = [...names];
  return {
    keys: async () => [...list],
    delete: async (n) => {
      const had = list.includes(n);
      list = list.filter(x => x !== n);
      return had;
    },
    remaining: () => [...list],
  };
}

describe("PERSONAL_LOCAL_KEYS", () => {
  it("includes the scan history", () => {
    expect(PERSONAL_LOCAL_KEYS).toContain(HISTORY_KEY);
  });

  // The strictness mode records the user's religious observance. It is the
  // most sensitive single value stored, and it was previously left behind.
  it("includes the religious strictness mode", () => {
    expect(PERSONAL_LOCAL_KEYS).toContain(PROFILE_KEY);
    expect(PROFILE_KEY).toBe("JAIN_PROFILE");
  });

  it("includes the community votes, free-scan counter and pending magic email", () => {
    expect(PERSONAL_LOCAL_KEYS).toContain("JAIN_FEEDBACK");
    expect(PERSONAL_LOCAL_KEYS).toContain("JAINI_FREE_SCANS");
    expect(PERSONAL_LOCAL_KEYS).toContain("JAINI_MAGIC_EMAIL");
  });

  it("includes the first-run flag, which discloses prior use of the device", () => {
    expect(PERSONAL_LOCAL_KEYS).toContain("JAINI_FIRST_SCAN_DONE");
  });

  it("lists no key twice", () => {
    expect(new Set(PERSONAL_LOCAL_KEYS).size).toBe(PERSONAL_LOCAL_KEYS.length);
  });
});

describe("isApiCacheName", () => {
  it("matches the verdict cache used by sw.js", () => {
    expect(isApiCacheName("jaini-api-v2")).toBe(true);
  });

  // Prefix-matched on purpose: bumping CACHE_API in sw.js must not silently
  // stop the delete from clearing it.
  it("keeps matching after a cache version bump", () => {
    expect(isApiCacheName("jaini-api-v3")).toBe(true);
    expect(isApiCacheName(`${API_CACHE_PREFIX}-v99`)).toBe(true);
  });

  it("leaves the app-shell cache alone", () => {
    expect(isApiCacheName("jaini-v7")).toBe(false);
  });

  it("is safe on junk input", () => {
    expect(isApiCacheName(null)).toBe(false);
    expect(isApiCacheName(undefined)).toBe(false);
    expect(isApiCacheName(123)).toBe(false);
  });
});

describe("clearCachedVerdicts", () => {
  it("deletes verdict caches and keeps the app shell", async () => {
    const cs = makeCaches(["jaini-v7", "jaini-api-v2", "jaini-api-v3", "other"]);
    const deleted = await clearCachedVerdicts(cs);
    expect(deleted.sort()).toEqual(["jaini-api-v2", "jaini-api-v3"]);
    expect(cs.remaining().sort()).toEqual(["jaini-v7", "other"]);
  });

  it("returns an empty list when Cache Storage is unavailable", async () => {
    await expect(clearCachedVerdicts(undefined)).resolves.toEqual([]);
    await expect(clearCachedVerdicts({})).resolves.toEqual([]);
  });

  // A browser that refuses cache access must not be able to abort the delete.
  it("swallows Cache Storage errors", async () => {
    const hostile = { keys: async () => { throw new Error("denied"); } };
    await expect(clearCachedVerdicts(hostile)).resolves.toEqual([]);
  });
});

describe("clearPersonalLocalData", () => {
  let storage, cs;

  beforeEach(() => {
    storage = makeStorage({
      [HISTORY_KEY]: "[{}]",
      [PROFILE_KEY]: "paryushan_mode",
      JAIN_FEEDBACK: "{}",
      JAINI_FREE_SCANS: "3",
      JAINI_MAGIC_EMAIL: "a@b.com",
      JAINI_FIRST_SCAN_DONE: "1",
      JAIN_CLIENT_ID: "keep-me",
      JAIN_THEME: "dark",
    });
    cs = makeCaches(["jaini-v7", "jaini-api-v2"]);
  });

  it("removes every personal key", async () => {
    await clearPersonalLocalData(storage, cs);
    for (const key of PERSONAL_LOCAL_KEYS) {
      expect(storage.getItem(key)).toBeNull();
    }
  });

  it("removes the religious mode specifically", async () => {
    expect(storage.getItem(PROFILE_KEY)).toBe("paryushan_mode");
    await clearPersonalLocalData(storage, cs);
    expect(storage.getItem(PROFILE_KEY)).toBeNull();
  });

  it("also drops the cached verdict responses", async () => {
    await clearPersonalLocalData(storage, cs);
    expect(cs.remaining()).toEqual(["jaini-v7"]);
  });

  // Theme is a display preference and the client id is regenerated anyway;
  // wiping unrelated keys would be overreach, not privacy.
  it("leaves non-personal preferences untouched", async () => {
    await clearPersonalLocalData(storage, cs);
    expect(storage.getItem("JAIN_THEME")).toBe("dark");
  });

  it("survives storage being disabled", async () => {
    const hostile = { removeItem: () => { throw new Error("blocked"); } };
    await expect(clearPersonalLocalData(hostile, cs)).resolves.toBeDefined();
  });
});
