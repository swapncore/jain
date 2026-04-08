/**
 * profile.test.js — Tests for profile switching and default selection.
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

// Mock document.querySelectorAll for setActiveProfile
vi.stubGlobal("document", {
  ...globalThis.document,
  querySelectorAll: vi.fn(() => []),
  getElementById: vi.fn(() => null),
  createElement: vi.fn(() => ({
    className: "",
    textContent: "",
    title: "",
    type: "",
    dataset: {},
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    appendChild: vi.fn(),
  })),
});

import { getActiveProfile, setActiveProfile, PROFILES, PROFILE_DEFAULT } from "../src/profile.js";

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe("getActiveProfile", () => {
  it("returns default profile when nothing is stored", () => {
    expect(getActiveProfile()).toBe(PROFILE_DEFAULT);
  });

  it("returns default profile when stored value is invalid", () => {
    store["JAIN_PROFILE"] = "nonexistent_profile";
    expect(getActiveProfile()).toBe(PROFILE_DEFAULT);
  });

  it("returns stored profile when valid", () => {
    store["JAIN_PROFILE"] = "temple_mode";
    expect(getActiveProfile()).toBe("temple_mode");
  });

  it("recognizes all defined profiles", () => {
    for (const p of PROFILES) {
      store["JAIN_PROFILE"] = p.id;
      expect(getActiveProfile()).toBe(p.id);
    }
  });
});

describe("setActiveProfile", () => {
  it("saves valid profile to localStorage", () => {
    setActiveProfile("paryushan_mode");
    expect(localStorageMock.setItem).toHaveBeenCalledWith("JAIN_PROFILE", "paryushan_mode");
  });

  it("does not save invalid profile", () => {
    setActiveProfile("invalid_mode");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});

describe("PROFILES", () => {
  it("has at least 4 profiles", () => {
    expect(PROFILES.length).toBeGreaterThanOrEqual(4);
  });

  it("each profile has id, label, and desc", () => {
    for (const p of PROFILES) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.desc).toBeTruthy();
    }
  });

  it("includes everyday_jain as a profile", () => {
    expect(PROFILES.find(p => p.id === "everyday_jain")).toBeDefined();
  });

  it("includes temple_mode as a profile", () => {
    expect(PROFILES.find(p => p.id === "temple_mode")).toBeDefined();
  });
});

describe("PROFILE_DEFAULT", () => {
  it("is everyday_jain", () => {
    expect(PROFILE_DEFAULT).toBe("everyday_jain");
  });

  it("exists in PROFILES", () => {
    expect(PROFILES.find(p => p.id === PROFILE_DEFAULT)).toBeDefined();
  });
});
