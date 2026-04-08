/**
 * verdict.test.js — Tests for verdict status determination and reason display logic.
 */

import { describe, it, expect } from "vitest";
import { STATUS_META, REASON_LABELS, INGREDIENT_GROUP_META } from "../src/config.js";

describe("STATUS_META", () => {
  it("has all five status levels", () => {
    expect(Object.keys(STATUS_META)).toEqual(
      expect.arrayContaining(["GREEN", "YELLOW", "ORANGE", "RED", "UNKNOWN"])
    );
  });

  it("each status has label, description, ariaPrefix, and icon", () => {
    for (const [key, meta] of Object.entries(STATUS_META)) {
      expect(meta.label).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.ariaPrefix).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.icon).toContain("<svg");
    }
  });

  it("GREEN status is labeled Jain-Friendly", () => {
    expect(STATUS_META.GREEN.label).toBe("Jain-Friendly");
  });

  it("RED status is labeled Meat Detected", () => {
    expect(STATUS_META.RED.label).toBe("Meat Detected");
  });

  it("UNKNOWN status is labeled Not enough data", () => {
    expect(STATUS_META.UNKNOWN.label).toBe("Not enough data");
  });
});

describe("REASON_LABELS", () => {
  it("has labels for common reason codes", () => {
    expect(REASON_LABELS.MEAT).toBe("Meat / Fish");
    expect(REASON_LABELS.EGG).toBe("Egg-derived");
    expect(REASON_LABELS.ONION_GARLIC).toBe("Onion / Garlic");
    expect(REASON_LABELS.ROOT_VEG).toBe("Root Vegetables");
    expect(REASON_LABELS.GELATIN).toBe("Gelatin");
  });

  it("has labels for ambiguous categories", () => {
    expect(REASON_LABELS.AMBIGUOUS_ADDITIVE).toBe("Ambiguous Additive");
    expect(REASON_LABELS.AMBIGUOUS_ENZYME).toBe("Ambiguous Enzyme");
    expect(REASON_LABELS.AMBIGUOUS_FLAVOR).toBe("Ambiguous Flavour");
  });
});

describe("INGREDIENT_GROUP_META", () => {
  it("has all four ingredient groups", () => {
    expect(Object.keys(INGREDIENT_GROUP_META)).toEqual(
      expect.arrayContaining(["RED", "ORANGE", "YELLOW", "GREEN"])
    );
  });

  it("each group has label and reason", () => {
    for (const [key, meta] of Object.entries(INGREDIENT_GROUP_META)) {
      expect(meta.label).toBeTruthy();
      expect(meta.reason).toBeTruthy();
    }
  });
});

describe("Verdict status determination logic", () => {
  it("falls back to UNKNOWN for unrecognized status", () => {
    const status = STATUS_META["INVALID_STATUS"] ? "INVALID_STATUS" : "UNKNOWN";
    expect(status).toBe("UNKNOWN");
    expect(STATUS_META[status]).toBeDefined();
  });

  it("reason labels format unknown codes as title case", () => {
    const unknownCode = "SOME_NEW_REASON";
    const formatted = REASON_LABELS[unknownCode] || String(unknownCode).replace(/_/g, " ").toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
    expect(formatted).toBe("Some New Reason");
  });
});
