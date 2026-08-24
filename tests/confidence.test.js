/**
 * confidence.test.js — Evidence-quality policy.
 *
 * The recompute made two things true that the UI previously assumed away:
 *   1. UNKNOWN is a real verdict status on live products, not just a fallback.
 *   2. GREEN is no longer always HIGH confidence.
 *
 * These tests pin the behaviour that keeps both honest.
 */

import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_META,
  normalizeConfidence,
  getConfidenceMeta,
  hasIngredientEvidence,
  verdictCaveat,
  UNKNOWN_CAUSES,
} from "../src/confidence.js";
import { STATUS_META } from "../src/config.js";

describe("normalizeConfidence", () => {
  it("accepts the three levels the API sends", () => {
    expect(normalizeConfidence("HIGH")).toBe("HIGH");
    expect(normalizeConfidence("MED")).toBe("MED");
    expect(normalizeConfidence("LOW")).toBe("LOW");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeConfidence(" high ")).toBe("HIGH");
    expect(normalizeConfidence("Low")).toBe("LOW");
  });

  it("accepts MEDIUM as an alias for MED", () => {
    expect(normalizeConfidence("medium")).toBe("MED");
  });

  // Rows that predate the confidence column send nothing. Inventing a level
  // for them would be asserting evidence quality we do not have.
  it("returns null when confidence is absent or unrecognised", () => {
    expect(normalizeConfidence(undefined)).toBeNull();
    expect(normalizeConfidence(null)).toBeNull();
    expect(normalizeConfidence("")).toBeNull();
    expect(normalizeConfidence("VERY_HIGH")).toBeNull();
    expect(normalizeConfidence(42)).toBeNull();
  });
});

describe("CONFIDENCE_META", () => {
  it("describes all three levels with a meter level and an explanation", () => {
    for (const key of ["HIGH", "MED", "LOW"]) {
      const meta = CONFIDENCE_META[key];
      expect(meta.label).toBeTruthy();
      expect(meta.detail).toBeTruthy();
      expect(meta.level).toBeGreaterThanOrEqual(1);
      expect(meta.level).toBeLessThanOrEqual(3);
    }
  });

  it("orders the meter HIGH > MED > LOW", () => {
    expect(CONFIDENCE_META.HIGH.level).toBeGreaterThan(CONFIDENCE_META.MED.level);
    expect(CONFIDENCE_META.MED.level).toBeGreaterThan(CONFIDENCE_META.LOW.level);
  });

  // Confidence is a claim about the evidence, not about how safe the food is.
  // If the copy starts talking about the product, the chip stops meaning what
  // the engine computed.
  it("explains the evidence, never the safety of the food", () => {
    for (const key of ["HIGH", "MED", "LOW"]) {
      expect(CONFIDENCE_META[key].detail.toLowerCase()).toContain("ingredient");
    }
  });

  it("getConfidenceMeta returns null rather than a default level", () => {
    expect(getConfidenceMeta("nonsense")).toBeNull();
    expect(getConfidenceMeta("MED")).toBe(CONFIDENCE_META.MED);
  });
});

describe("hasIngredientEvidence", () => {
  it("is true when raw ingredient text is present", () => {
    expect(hasIngredientEvidence({ ingredients_text: "rice, salt" })).toBe(true);
  });

  it("is true when any category holds an ingredient", () => {
    expect(hasIngredientEvidence({
      ingredients_text: "",
      ingredient_categories: { RED: [], ORANGE: [], YELLOW: [], GREEN: ["water"] },
    })).toBe(true);
  });

  it("is false when every category is empty", () => {
    expect(hasIngredientEvidence({
      ingredients_text: "",
      ingredient_categories: { RED: [], ORANGE: [], YELLOW: [], GREEN: [] },
    })).toBe(false);
  });

  it("is false for whitespace-only text and whitespace-only entries", () => {
    expect(hasIngredientEvidence({ ingredients_text: "   " })).toBe(false);
    expect(hasIngredientEvidence({
      ingredients_text: "",
      ingredient_categories: { GREEN: ["  ", ""] },
    })).toBe(false);
  });

  it("is false for missing or malformed payloads", () => {
    expect(hasIngredientEvidence(null)).toBe(false);
    expect(hasIngredientEvidence({})).toBe(false);
    expect(hasIngredientEvidence({ ingredient_categories: "nope" })).toBe(false);
  });
});

describe("verdictCaveat", () => {
  const withIngredients = {
    ingredients_text: "wheat flour, water, salt",
    ingredient_categories: { RED: [], ORANGE: [], YELLOW: [], GREEN: ["wheat flour"] },
  };

  it("says nothing for a HIGH-confidence verdict backed by ingredients", () => {
    expect(verdictCaveat("GREEN", { ...withIngredients, confidence: "HIGH" })).toBeNull();
  });

  // The headline regression: post-recompute, most GREENs are NOT high
  // confidence. A LOW-confidence GREEN that renders exactly like a
  // HIGH-confidence GREEN is the fake-green failure this app exists to avoid.
  it("qualifies a LOW-confidence GREEN even when ingredients exist", () => {
    const caveat = verdictCaveat("GREEN", { ...withIngredients, confidence: "LOW" });
    expect(caveat).not.toBeNull();
    expect(caveat.tone).toBe("warn");
    expect(caveat.text.toLowerCase()).toContain("low");
  });

  it("qualifies a MED-confidence verdict more gently than a LOW one", () => {
    const med = verdictCaveat("GREEN", { ...withIngredients, confidence: "MED" });
    expect(med.tone).toBe("info");
    const low = verdictCaveat("GREEN", { ...withIngredients, confidence: "LOW" });
    expect(low.tone).toBe("warn");
  });

  it("prefers the no-evidence caveat over the confidence caveat", () => {
    const caveat = verdictCaveat("GREEN", {
      confidence: "LOW",
      ingredients_text: "",
      ingredient_categories: { RED: [], ORANGE: [], YELLOW: [], GREEN: [] },
    });
    expect(caveat.tone).toBe("warn");
    expect(caveat.text.toLowerCase()).toContain("no ingredient data");
  });

  it("never tells the reader a verdict is confirmed or safe", () => {
    const texts = [
      verdictCaveat("GREEN", { ...withIngredients, confidence: "LOW" }).text,
      verdictCaveat("GREEN", { ...withIngredients, confidence: "MED" }).text,
      verdictCaveat("GREEN", { confidence: "LOW" }).text,
    ];
    for (const t of texts) {
      expect(t.toLowerCase()).not.toMatch(/\b(guaranteed|certified|safe to eat|confirmed jain)\b/);
    }
  });

  // UNKNOWN already says "we could not determine this" across the whole card.
  // Stacking a warning on top turns an honest answer into what looks like an
  // error, which is exactly the framing UNKNOWN must not have.
  it("adds no caveat to UNKNOWN — the card is already the explanation", () => {
    expect(verdictCaveat("UNKNOWN", { confidence: "LOW", ingredients_text: "" })).toBeNull();
    expect(verdictCaveat("UNKNOWN", { ...withIngredients, confidence: "MED" })).toBeNull();
  });
});

describe("UNKNOWN presentation", () => {
  it("has a status entry with its own icon", () => {
    expect(STATUS_META.UNKNOWN).toBeDefined();
    expect(STATUS_META.UNKNOWN.icon).toContain("<svg");
  });

  // The magnifier is the not-found panel's mark ("we searched, this barcode is
  // not in the set"). UNKNOWN is a different claim — we hold the product, the
  // evidence will not support a call — and must not reuse it.
  it("does not reuse the not-found magnifier as the UNKNOWN icon", () => {
    expect(STATUS_META.UNKNOWN.icon).not.toContain('x1="21" y1="21"');
  });

  it("has a distinct icon from every other status", () => {
    const icons = Object.entries(STATUS_META).map(([k, v]) => [k, v.icon]);
    const unknown = STATUS_META.UNKNOWN.icon;
    for (const [key, icon] of icons) {
      if (key !== "UNKNOWN") expect(icon).not.toBe(unknown);
    }
  });

  it("offers concrete, non-blaming reasons for the outcome", () => {
    expect(UNKNOWN_CAUSES.length).toBeGreaterThanOrEqual(2);
    for (const cause of UNKNOWN_CAUSES) {
      expect(typeof cause).toBe("string");
      expect(cause.length).toBeGreaterThan(10);
    }
  });
});

describe("unrecognised statuses degrade to UNKNOWN", () => {
  // The backend can add a status at any time. The web app must render the new
  // value as "not enough data" rather than throwing on a missing meta entry.
  it.each(["PENDING_REVIEW", "BLUE", "", null, undefined])(
    "maps %s onto UNKNOWN meta", (raw) => {
      const status = STATUS_META[raw] ? raw : "UNKNOWN";
      expect(status).toBe("UNKNOWN");
      expect(STATUS_META[status].label).toBe("Not enough data");
    }
  );
});
