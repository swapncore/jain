/**
 * history.test.js — Tests for history add/remove/max limit logic.
 *
 * Tests the core history data operations (load, save, push) without
 * importing the full lib/history.js module (which has transitive
 * dependencies on auth.js/Firebase that require browser APIs).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => { store[key] = val; }),
  removeItem: vi.fn((key) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
};
vi.stubGlobal("localStorage", localStorageMock);

// ── Inline reimplementation of core history functions ────────────────────────
// These mirror lib/history.js logic without the transitive Firebase imports.

const HISTORY_KEY = "JAIN_HISTORY";
const HISTORY_MAX = 20;

function historyLoad() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function historySave(entries) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch {}
}

function historyPush(entry, onRender) {
  const entries = historyLoad().filter(
    e => !(e.barcode === entry.barcode && e.profile === entry.profile)
  );
  entries.unshift(entry);
  historySave(entries.slice(0, HISTORY_MAX));
  if (onRender) onRender();
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe("historyLoad", () => {
  it("returns empty array when no history exists", () => {
    expect(historyLoad()).toEqual([]);
  });

  it("returns parsed history from localStorage", () => {
    const entries = [{ barcode: "1234567890123", status: "GREEN" }];
    store[HISTORY_KEY] = JSON.stringify(entries);
    expect(historyLoad()).toEqual(entries);
  });

  it("returns empty array for corrupted JSON", () => {
    store[HISTORY_KEY] = "not valid json{{{";
    expect(historyLoad()).toEqual([]);
  });
});

describe("historySave", () => {
  it("saves entries to localStorage", () => {
    const entries = [{ barcode: "1234567890123", status: "GREEN" }];
    historySave(entries);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      HISTORY_KEY,
      JSON.stringify(entries)
    );
  });

  it("saves empty array", () => {
    historySave([]);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(HISTORY_KEY, "[]");
  });
});

describe("historyPush", () => {
  it("adds a new entry at the beginning", () => {
    const existing = [{ barcode: "111", profile: "everyday_jain", status: "GREEN" }];
    store[HISTORY_KEY] = JSON.stringify(existing);

    const renderFn = vi.fn();
    historyPush({ barcode: "222", profile: "everyday_jain", status: "RED" }, renderFn);

    const saved = JSON.parse(store[HISTORY_KEY]);
    expect(saved[0].barcode).toBe("222");
    expect(saved[1].barcode).toBe("111");
    expect(renderFn).toHaveBeenCalledOnce();
  });

  it("replaces existing entry with same barcode+profile", () => {
    const existing = [
      { barcode: "111", profile: "everyday_jain", status: "GREEN" },
      { barcode: "222", profile: "everyday_jain", status: "RED" },
    ];
    store[HISTORY_KEY] = JSON.stringify(existing);

    historyPush({ barcode: "111", profile: "everyday_jain", status: "YELLOW" }, vi.fn());

    const saved = JSON.parse(store[HISTORY_KEY]);
    expect(saved).toHaveLength(2);
    expect(saved[0].barcode).toBe("111");
    expect(saved[0].status).toBe("YELLOW");
  });

  it("respects maximum history limit (20 entries)", () => {
    const existing = Array.from({ length: 25 }, (_, i) => ({
      barcode: String(i).padStart(13, "0"),
      profile: "everyday_jain",
      status: "GREEN",
    }));
    store[HISTORY_KEY] = JSON.stringify(existing);

    historyPush({ barcode: "9999999999999", profile: "everyday_jain", status: "RED" }, vi.fn());

    const saved = JSON.parse(store[HISTORY_KEY]);
    expect(saved.length).toBeLessThanOrEqual(HISTORY_MAX);
    expect(saved[0].barcode).toBe("9999999999999");
  });

  it("does not duplicate entries across different profiles", () => {
    const existing = [
      { barcode: "111", profile: "everyday_jain", status: "GREEN" },
    ];
    store[HISTORY_KEY] = JSON.stringify(existing);

    historyPush({ barcode: "111", profile: "temple_mode", status: "YELLOW" }, vi.fn());

    const saved = JSON.parse(store[HISTORY_KEY]);
    expect(saved).toHaveLength(2);
    expect(saved[0].profile).toBe("temple_mode");
    expect(saved[1].profile).toBe("everyday_jain");
  });
});
