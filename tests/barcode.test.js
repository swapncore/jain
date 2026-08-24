/**
 * barcode.test.js — Tests for barcode validation and normalization.
 */

import { describe, it, expect } from "vitest";
import { normalizeBarcode, isValidBarcode, validateChecksum, getSymbologyLabel, isEan8Hint } from "../barcode.js";

describe("isValidBarcode", () => {
  it("accepts 8-digit UPC-E barcodes", () => {
    expect(isValidBarcode("04900000")).toBe(true);
  });

  it("accepts 12-digit UPC-A barcodes", () => {
    expect(isValidBarcode("012345678901")).toBe(true);
  });

  it("accepts 13-digit EAN-13 barcodes", () => {
    expect(isValidBarcode("0123456789012")).toBe(true);
  });

  it("rejects barcodes with fewer than 8 digits", () => {
    expect(isValidBarcode("1234567")).toBe(false);
  });

  it("rejects barcodes with 9-10 digits (no GTIN has those lengths)", () => {
    expect(isValidBarcode("123456789")).toBe(false);
    expect(isValidBarcode("1234567890")).toBe(false);
  });

  it("accepts 11-digit codes as ambiguous rather than rejecting them", () => {
    // 9,650 catalog rows are 11 digits -- an old FoodData Central import that
    // dropped either the leading zero or the trailing check digit. Which one
    // cannot be known from the code alone, so the normalizer emits candidates
    // for BOTH readings and flags the result ambiguous, instead of telling the
    // user their perfectly real barcode is invalid.
    expect(isValidBarcode("12345678901")).toBe(true);
    const n = normalizeBarcode("12345678901");
    expect(n.ambiguous).toBe(true);
    expect(n.lookupCandidates.length).toBeGreaterThan(1);
  });

  it("rejects barcodes with more than 13 digits", () => {
    expect(isValidBarcode("12345678901234")).toBe(false);
  });

  it("strips non-digit characters before validating", () => {
    expect(isValidBarcode("0123-4567-8901")).toBe(true);
    expect(isValidBarcode("012 345 678 901")).toBe(true);
  });

  it("handles null and undefined", () => {
    expect(isValidBarcode(null)).toBe(false);
    expect(isValidBarcode(undefined)).toBe(false);
    expect(isValidBarcode("")).toBe(false);
  });
});

describe("normalizeBarcode", () => {
  it("identifies UPC-A symbology for 12 digits", () => {
    const result = normalizeBarcode("012345678905");
    expect(result.symbology).toBe("UPC-A");
    expect(result.upc12).toBe("012345678905");
    expect(result.ean13).toBe("0012345678905");
  });

  it("identifies EAN-13 symbology for 13 digits", () => {
    const result = normalizeBarcode("4006381333931");
    expect(result.symbology).toBe("EAN-13");
    expect(result.ean13).toBe("4006381333931");
  });

  it("identifies UPC-E symbology for 8 digits", () => {
    const result = normalizeBarcode("04900000");
    expect(result.symbology).toBe("UPC-E");
    expect(result.upc12).not.toBeNull();
  });

  it("expands UPC-E to UPC-A (12 digits)", () => {
    const result = normalizeBarcode("04900000");
    expect(result.upc12).toHaveLength(12);
  });

  it("strips non-digit characters", () => {
    const result = normalizeBarcode("0123-4567-8901");
    expect(result.cleaned).toBe("012345678901");
    expect(result.symbology).toBe("UPC-A");
  });

  it("returns unknown for invalid lengths", () => {
    const result = normalizeBarcode("12345");
    expect(result.symbology).toBe("unknown");
    expect(result.upc12).toBeNull();
    expect(result.ean13).toBeNull();
  });

  it("handles empty input", () => {
    const result = normalizeBarcode("");
    expect(result.cleaned).toBe("");
    expect(result.symbology).toBe("unknown");
  });

  it("provides lookup candidates", () => {
    const result = normalizeBarcode("012345678905");
    expect(result.lookupCandidates.length).toBeGreaterThan(0);
    expect(result.lookupCandidates).toContain("012345678905");
  });
});

describe("normalizeBarcode — EAN-8 vs UPC-E (symbology hint)", () => {
  // "96385074" is a real, checksum-valid EAN-8.
  it("treats an 8-digit code as EAN-8 when the scanner hints ean_8 (no UPC-E expansion)", () => {
    const result = normalizeBarcode("96385074", "ean_8");
    expect(result.symbology).toBe("EAN-8");
    expect(result.upc12).toBeNull();                 // must NOT be UPC-E-expanded
    expect(result.ean13).toBe("0000096385074");       // zero-padded EAN-13 form
    expect(result.lookupCandidates).toContain("96385074");        // 8-digit as-is
    expect(result.lookupCandidates).toContain("0000096385074");   // and padded form
  });

  it("validates the EAN-8 check digit via its zero-padded EAN-13 form", () => {
    expect(normalizeBarcode("96385074", "ean_8").checksumValid).toBe(true);
    expect(normalizeBarcode("96385070", "ean_8").checksumValid).toBe(false);
  });

  it("accepts the ZXing/BarcodeDetector hint spellings EAN_8 and EAN-8", () => {
    expect(normalizeBarcode("96385074", "EAN_8").symbology).toBe("EAN-8");
    expect(normalizeBarcode("96385074", "EAN-8").symbology).toBe("EAN-8");
  });

  it("still defaults an 8-digit code to UPC-E when no hint is given", () => {
    const result = normalizeBarcode("04900000");
    expect(result.symbology).toBe("UPC-E");
    expect(result.upc12).not.toBeNull();
  });

  it("keeps the raw 8-digit as a fallback candidate for hint-less entry", () => {
    // So a genuine EAN-8 typed manually can still be matched.
    expect(normalizeBarcode("04900000").lookupCandidates).toContain("04900000");
  });

  it("ignores an ean_8 hint for non-8-digit input (length wins)", () => {
    expect(normalizeBarcode("012345678905", "ean_8").symbology).toBe("UPC-A");
    expect(normalizeBarcode("4006381333931", "ean_8").symbology).toBe("EAN-13");
  });
});

describe("isEan8Hint", () => {
  it("recognises the forms a scanner can emit", () => {
    for (const h of ["ean_8", "EAN_8", "EAN-8", "ean8", "ean 8"]) {
      expect(isEan8Hint(h)).toBe(true);
    }
  });
  it("rejects other symbologies and empty hints", () => {
    for (const h of ["upc_e", "ean_13", "upc_a", "", null, undefined]) {
      expect(isEan8Hint(h)).toBe(false);
    }
  });
});

describe("getSymbologyLabel", () => {
  it("labels an 8-digit code UPC-E by default but EAN-8 when hinted", () => {
    expect(getSymbologyLabel("96385074")).toBe("UPC-E");
    expect(getSymbologyLabel("96385074", "ean_8")).toBe("EAN-8");
  });
  it("labels 12- and 13-digit codes", () => {
    expect(getSymbologyLabel("012345678905")).toBe("UPC-A");
    expect(getSymbologyLabel("4006381333931")).toBe("EAN-13");
  });
  it("returns empty string for invalid lengths", () => {
    expect(getSymbologyLabel("12345")).toBe("");
  });
});

describe("validateChecksum", () => {
  it("returns true for valid EAN-13 checksum", () => {
    expect(validateChecksum("4006381333931")).toBe(true);
  });

  it("returns false for invalid checksum", () => {
    expect(validateChecksum("4006381333932")).toBe(false);
  });

  it("validates 12-digit UPC-A", () => {
    // A valid UPC-A
    const result = validateChecksum("036000291452");
    expect(typeof result).toBe("boolean");
  });

  it("returns null for invalid input", () => {
    expect(validateChecksum("")).toBeNull();
    expect(validateChecksum("abc")).toBeNull();
    expect(validateChecksum("12345")).toBeNull();
  });
});
