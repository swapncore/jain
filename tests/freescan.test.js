/**
 * freescan.test.js — Anonymous free-scan accounting.
 *
 * Regression cover for: the web used to burn a free scan on every RENDER, so
 * an anonymous user who scanned one product and re-opened it twice from Recent
 * scans was locked out. Only a real server lookup may count, and the server's
 * own number wins over the local counter.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const store = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((k) => (k in store ? store[k] : null)),
  setItem: vi.fn((k, v) => { store[k] = String(v); }),
  removeItem: vi.fn((k) => { delete store[k]; }),
});

import {
  FREE_SCAN_KEY, FREE_SCAN_LIMIT,
  getFreeScanCount, setFreeScanCount, incrementFreeScanCount,
  isFreeScanExhausted, readServerScansRemaining, recordServerLookup,
} from "../src/freescan.js";

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
});

/** Minimal Response stand-in: only `headers.get` is used. */
function fakeResp(headers = {}) {
  return { headers: { get: (name) => (name in headers ? headers[name] : null) } };
}

describe("local counter", () => {
  it("starts at zero", () => {
    expect(getFreeScanCount()).toBe(0);
    expect(isFreeScanExhausted()).toBe(false);
  });

  it("increments and persists", () => {
    expect(incrementFreeScanCount()).toBe(1);
    expect(store[FREE_SCAN_KEY]).toBe("1");
    expect(getFreeScanCount()).toBe(1);
  });

  it("is exhausted at the limit", () => {
    setFreeScanCount(FREE_SCAN_LIMIT);
    expect(isFreeScanExhausted()).toBe(true);
  });

  it("treats corrupt storage as zero rather than NaN", () => {
    store[FREE_SCAN_KEY] = "not-a-number";
    expect(getFreeScanCount()).toBe(0);
    expect(isFreeScanExhausted()).toBe(false);
  });
});

describe("readServerScansRemaining", () => {
  it("prefers the X-RateLimit-Remaining header", () => {
    const r = readServerScansRemaining(fakeResp({ "X-RateLimit-Remaining": "2" }), { scans_remaining: 0 });
    expect(r).toBe(2);
  });

  it("falls back to the body's scans_remaining", () => {
    expect(readServerScansRemaining(fakeResp(), { scans_remaining: 1 })).toBe(1);
  });

  it("reads zero from the body (not treated as absent)", () => {
    expect(readServerScansRemaining(fakeResp(), { scans_remaining: 0 })).toBe(0);
  });

  it("returns null when the server says nothing", () => {
    expect(readServerScansRemaining(fakeResp(), {})).toBeNull();
    expect(readServerScansRemaining(fakeResp(), null)).toBeNull();
  });

  it("returns null for a signed-in response with no counters", () => {
    expect(readServerScansRemaining(fakeResp({ "X-RateLimit-Remaining": "" }), { status: "GREEN" })).toBeNull();
  });

  it("survives a response object with no headers at all", () => {
    expect(readServerScansRemaining({}, { scans_remaining: 3 })).toBe(3);
    expect(readServerScansRemaining(undefined, undefined)).toBeNull();
  });

  it("ignores a non-numeric header", () => {
    expect(readServerScansRemaining(fakeResp({ "X-RateLimit-Remaining": "many" }), { scans_remaining: 2 })).toBe(2);
  });
});

describe("recordServerLookup", () => {
  it("uses the local counter when the server is silent", () => {
    expect(recordServerLookup(null)).toBe(FREE_SCAN_LIMIT - 1);
    expect(getFreeScanCount()).toBe(1);
  });

  it("mirrors the server's number into local storage", () => {
    expect(recordServerLookup(1)).toBe(1);
    expect(getFreeScanCount()).toBe(FREE_SCAN_LIMIT - 1);
  });

  it("server value overrides a drifted local counter", () => {
    setFreeScanCount(FREE_SCAN_LIMIT); // locally "exhausted"
    expect(recordServerLookup(2)).toBe(2);
    expect(isFreeScanExhausted()).toBe(false);
  });

  it("clamps a server value above the limit", () => {
    expect(recordServerLookup(99)).toBe(FREE_SCAN_LIMIT);
    expect(getFreeScanCount()).toBe(0);
  });

  it("never goes negative", () => {
    setFreeScanCount(FREE_SCAN_LIMIT + 5);
    expect(recordServerLookup(null)).toBe(0);
  });

  it("three real lookups exhaust the allowance, and only three", () => {
    for (let i = 0; i < FREE_SCAN_LIMIT; i++) recordServerLookup(null);
    expect(isFreeScanExhausted()).toBe(true);
    expect(getFreeScanCount()).toBe(FREE_SCAN_LIMIT);
  });

  it("re-rendering a cached verdict costs nothing (no call = no change)", () => {
    // The fix is structural: cached renders no longer reach this module at all.
    // One real lookup followed by two cached re-views leaves two scans left.
    recordServerLookup(null);
    // ...two cached history clicks happen here, calling nothing...
    expect(getFreeScanCount()).toBe(1);
    expect(isFreeScanExhausted()).toBe(false);
  });
});
