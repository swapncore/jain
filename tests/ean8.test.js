/**
 * ean8.test.js — EAN-8 pass-through, end to end through the barcode layer.
 *
 * The bug: scanner.js collapsed an EAN-8 decode to its zero-padded 13-digit
 * form. verdict.js then re-normalized WITHOUT the symbology hint, the padded
 * value starts with '0', so it came back out as a 12-digit UPC-A — and the
 * backend's dual 8-digit candidate logic never fired. 3,072 catalog products
 * were unreachable from the web scanner. verdict.js additionally hard-rejected
 * any 8-digit entry outright.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeBarcode, pickLookupBarcode, isValidBarcode, getSymbologyLabel, isEan8Hint,
} from "../barcode.js";
import { _symbologyHint } from "../src/scanner.js";

// Stand-in for the ZXing BarcodeFormat enum (real values from @zxing/library).
const ZXING = { EAN_8: 6, EAN_13: 7, UPC_A: 14, UPC_E: 15, QR_CODE: 11 };

const EAN8 = "20601254";        // 8-digit EAN-8
const UPCA = "012345678905";    // 12-digit UPC-A
const EAN13 = "5000159459228";  // 13-digit EAN-13

describe("_symbologyHint — ZXing enum mapping", () => {
  it("maps EAN_8", () => {
    expect(_symbologyHint(ZXING.EAN_8, ZXING)).toBe("ean_8");
  });

  // These three used to return null, throwing away the decoder's answer.
  it("maps EAN_13, UPC_A and UPC_E", () => {
    expect(_symbologyHint(ZXING.EAN_13, ZXING)).toBe("ean_13");
    expect(_symbologyHint(ZXING.UPC_A, ZXING)).toBe("upc_a");
    expect(_symbologyHint(ZXING.UPC_E, ZXING)).toBe("upc_e");
  });

  it("passes BarcodeDetector's string formats straight through", () => {
    expect(_symbologyHint("ean_8")).toBe("ean_8");
    expect(_symbologyHint("upc_e")).toBe("upc_e");
  });

  it("returns null for no format or an unmapped one", () => {
    expect(_symbologyHint(null, ZXING)).toBeNull();
    expect(_symbologyHint(undefined, ZXING)).toBeNull();
    expect(_symbologyHint(ZXING.QR_CODE, ZXING)).toBeNull();
  });

  it("returns null when the enum is not loaded yet", () => {
    expect(_symbologyHint(6, null)).toBeNull();
  });

  it("produces hints normalizeBarcode actually recognises as EAN-8", () => {
    expect(isEan8Hint(_symbologyHint(ZXING.EAN_8, ZXING))).toBe(true);
    expect(isEan8Hint(_symbologyHint(ZXING.UPC_E, ZXING))).toBe(false);
  });
});

describe("pickLookupBarcode — what actually goes to /v1/verdict", () => {
  it("sends an EAN-8 decode RAW, not zero-padded", () => {
    const hint = _symbologyHint(ZXING.EAN_8, ZXING);
    const { barcode, symbology, valid } = pickLookupBarcode(EAN8, hint);
    expect(barcode).toBe(EAN8);
    expect(barcode).toHaveLength(8);
    expect(symbology).toBe("EAN-8");
    expect(valid).toBe(true);
  });

  it("regression: the old collapse produced an unusable 12-digit string", () => {
    const n = normalizeBarcode(EAN8, "ean_8");
    const oldValue = n.upc12 || n.ean13 || n.cleaned;   // the old expression
    expect(oldValue).toBe("00000" + EAN8);              // zero-padded to 13
    // Re-normalizing it without the hint — exactly what verdict.js used to do —
    // silently reinterprets it as a 12-digit UPC-A.
    const reNormalized = normalizeBarcode(oldValue);
    expect(reNormalized.symbology).toBe("EAN-13");
    expect(reNormalized.upc12).toBe("0000" + EAN8);
    expect(reNormalized.upc12).toHaveLength(12);
    // The raw 8-digit code is nowhere in the candidate list, so the backend
    // could never try the EAN-8 reading.
    expect(reNormalized.lookupCandidates).not.toContain(EAN8);
    // The fix keeps it:
    expect(pickLookupBarcode(EAN8, "ean_8").barcode).toBe(EAN8);
  });

  it("accepts 8-digit manual entry with no symbology hint", () => {
    const { barcode, symbology, valid } = pickLookupBarcode(EAN8);
    expect(valid).toBe(true);            // used to be hard-rejected
    expect(barcode).toBe(EAN8);          // sent raw so the backend tries both readings
    expect(symbology).toBe("UPC-E");     // ambiguous 8-digit defaults to UPC-E
  });

  it("keeps the canonical collapse for 12-digit codes", () => {
    const { barcode, symbology, valid } = pickLookupBarcode(UPCA, "upc_a");
    expect(barcode).toBe(UPCA);
    expect(symbology).toBe("UPC-A");
    expect(valid).toBe(true);
  });

  it("keeps the canonical collapse for 13-digit codes", () => {
    const { barcode, symbology, valid } = pickLookupBarcode(EAN13, "ean_13");
    expect(barcode).toBe(EAN13);
    expect(symbology).toBe("EAN-13");
    expect(valid).toBe(true);
  });

  it("collapses a leading-zero EAN-13 to its UPC-A form, as before", () => {
    const { barcode } = pickLookupBarcode("0" + UPCA, "ean_13");
    expect(barcode).toBe(UPCA);
  });

  it("strips separators before deciding", () => {
    expect(pickLookupBarcode("2060-1254", "ean_8").barcode).toBe(EAN8);
  });

  it("rejects lengths that are not 8, 12 or 13", () => {
    expect(pickLookupBarcode("1234567").valid).toBe(false);
    expect(pickLookupBarcode("").valid).toBe(false);
    expect(pickLookupBarcode("12345678901234").valid).toBe(false);
  });

  it("never reports a symbology of 'unknown' for a valid code", () => {
    for (const [code, hint] of [[EAN8, "ean_8"], [UPCA, null], [EAN13, null]]) {
      expect(pickLookupBarcode(code, hint).symbology).not.toBe("unknown");
    }
  });
});

describe("EAN-8 acceptance across the barcode helpers", () => {
  it("isValidBarcode accepts 8 digits", () => {
    expect(isValidBarcode(EAN8)).toBe(true);
  });

  it("getSymbologyLabel honours the scanner hint", () => {
    expect(getSymbologyLabel(EAN8, "ean_8")).toBe("EAN-8");
    expect(getSymbologyLabel(EAN8)).toBe("UPC-E");
  });

  it("an EAN-8 hint yields both 8-digit and padded candidates", () => {
    const n = normalizeBarcode(EAN8, "ean_8");
    expect(n.lookupCandidates).toContain(EAN8);
    expect(n.lookupCandidates).toContain("00000" + EAN8);
  });
});
