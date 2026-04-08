/**
 * api.test.js — Tests for fetchWithTimeout and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock localStorage
const store = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => { store[key] = val; }),
  removeItem: vi.fn((key) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
});

// Mock window and its properties
vi.stubGlobal("window", {
  location: { hostname: "jain.swapncore.com" },
  crypto: { randomUUID: () => "test-uuid-1234" },
});
vi.stubGlobal("location", { hostname: "jain.swapncore.com" });

import { fetchWithTimeout, getApiBase, getClientId } from "../src/api.js";

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.clearAllMocks();
});

describe("getApiBase", () => {
  it("returns production URL for non-localhost", () => {
    const base = getApiBase();
    expect(base).toContain("https://");
  });
});

describe("getClientId", () => {
  it("generates a client ID on first call", () => {
    const id = getClientId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("returns the same ID on subsequent calls", () => {
    const id1 = getClientId();
    const id2 = getClientId();
    expect(id1).toBe(id2);
  });

  it("persists the ID in localStorage", () => {
    getClientId();
    expect(store["JAIN_CLIENT_ID"]).toBeTruthy();
  });
});

describe("fetchWithTimeout", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns response for successful fetch", async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.resolve({ status: "GREEN" }) };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const resp = await fetchWithTimeout("https://example.com/api", {}, 5000);
    expect(resp.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("passes abort signal to fetch", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    await fetchWithTimeout("https://example.com/api", {}, 5000);

    const fetchCall = globalThis.fetch.mock.calls[0];
    expect(fetchCall[1]).toHaveProperty("signal");
    expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("merges options with abort signal", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    await fetchWithTimeout("https://example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, 5000);

    const fetchCall = globalThis.fetch.mock.calls[0];
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
    expect(fetchCall[1].signal).toBeDefined();
  });

  it("propagates fetch errors", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(fetchWithTimeout("https://example.com/api", {}, 5000))
      .rejects.toThrow("Network error");
  });

  it("aborts after timeout", async () => {
    vi.useFakeTimers();

    globalThis.fetch = vi.fn().mockImplementation((url, opts) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });

    const promise = fetchWithTimeout("https://example.com/api", {}, 100);
    vi.advanceTimersByTime(150);

    await expect(promise).rejects.toThrow();

    vi.useRealTimers();
  });
});
