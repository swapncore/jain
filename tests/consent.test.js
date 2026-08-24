/**
 * consent.test.js — the Article 9 consent gate.
 *
 * The dietary mode is special-category (religious) data, so scanning must NOT be
 * possible until the user has given an affirmative, current-version consent, and
 * third-party sign-in scripts must NOT load without their own opt-in. These tests
 * lock that gate: default-deny, version-aware re-ask, and clean withdrawal.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((k) => (k in store ? store[k] : null)),
  setItem: vi.fn((k, v) => { store[k] = String(v); }),
  removeItem: vi.fn((k) => { delete store[k]; }),
  clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
});

import {
  getConsent,
  hasDecided,
  canScan,
  canLoadThirdParty,
  recordConsent,
  clearConsent,
  CONSENT_VERSION,
} from "../src/consent.js";

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
});

describe("default state (no prior consent)", () => {
  it("denies everything until the user decides", () => {
    expect(getConsent()).toBeNull();
    expect(hasDecided()).toBe(false);
    expect(canScan()).toBe(false);
    expect(canLoadThirdParty()).toBe(false);
  });
});

describe("recording an affirmative choice", () => {
  it("essential-only consent enables scanning but NOT third parties", () => {
    recordConsent({ essential: true, thirdParty: false });
    expect(canScan()).toBe(true);
    expect(canLoadThirdParty()).toBe(false);
    expect(hasDecided()).toBe(true);
  });

  it("full consent enables both", () => {
    recordConsent({ essential: true, thirdParty: true });
    expect(canScan()).toBe(true);
    expect(canLoadThirdParty()).toBe(true);
  });

  it("declining essential is a real, recorded decision that still blocks scanning", () => {
    recordConsent({ essential: false, thirdParty: false });
    expect(hasDecided()).toBe(true); // they answered
    expect(canScan()).toBe(false); // but did not consent to Art. 9 processing
  });

  it("stamps the current version and an ISO timestamp", () => {
    const rec = recordConsent({ essential: true, thirdParty: true }, "2026-08-24T00:00:00.000Z");
    expect(rec.version).toBe(CONSENT_VERSION);
    expect(rec.ts).toBe("2026-08-24T00:00:00.000Z");
  });

  it("only a literal true grants consent — truthy-but-not-true never leaks in", () => {
    // A consent gate must fail closed: only an explicit boolean true counts, so a
    // stray 1 / "yes" / {} from a caller bug can never be mistaken for consent.
    recordConsent({ essential: 1, thirdParty: "yes" });
    const rec = getConsent();
    expect(rec.essential).toBe(false);
    expect(rec.thirdParty).toBe(false);
  });
});

describe("versioning — a material policy change re-asks", () => {
  it("treats a stored record from an older version as no decision", () => {
    localStorage.setItem(
      "JAIN_CONSENT",
      JSON.stringify({ version: "2020-01-01", ts: "x", essential: true, thirdParty: true }),
    );
    expect(getConsent()).toBeNull();
    expect(canScan()).toBe(false); // must consent again under the new policy
  });

  it("treats corrupt JSON as no decision rather than crashing", () => {
    localStorage.setItem("JAIN_CONSENT", "{not json");
    expect(getConsent()).toBeNull();
    expect(hasDecided()).toBe(false);
  });
});

describe("withdrawal", () => {
  it("clearConsent removes the record and returns to default-deny", () => {
    recordConsent({ essential: true, thirdParty: true });
    expect(canScan()).toBe(true);
    clearConsent();
    expect(getConsent()).toBeNull();
    expect(canScan()).toBe(false);
    expect(canLoadThirdParty()).toBe(false);
  });
});
