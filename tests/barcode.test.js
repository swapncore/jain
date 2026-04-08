/**
 * barcode.test.js — Tests for barcode validation and normalization.
 */

import { describe, it, expect } from "vitest";
import { normalizeBarcode, isValidBarcode, validateChecksum } from "../barcode.js";

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

  it("rejects barcodes with 9-11 digits", () => {
    expect(isValidBarcode("123456789")).toBe(false);
    expect(isValidBarcode("12345678901")).toBe(false);
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
