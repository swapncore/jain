// ─────────────────────────────────────────────────────────────────────────
// GENERATED-ISH: this file is a copy of compliance_core/shared/lib/barcode.js.
// GitHub Pages serves raw ES modules with no bundler, so the web app cannot
// import across repos and has to carry its own copy.
//
// It drifted once already (125 lines here vs 422 upstream), and the missing
// piece was the zero-padded GTIN-14 candidate that makes 22,313 catalog
// products reachable. Do NOT hand-edit normalizer logic here -- change
// shared/lib/barcode.js and re-copy, or the two will disagree again.
//
// Only pickLookupBarcode() below is web-specific.
// ─────────────────────────────────────────────────────────────────────────

/**
 * shared/lib/barcode.js — Single source of truth for barcode normalization (JS).
 *
 * Used by the web app (jain/) and available to the mobile app (JainiApp/).
 * Handles EAN-8 / UPC-E (8), UPC-A (12), EAN-13 (13), GTIN-14 / ITF-14 (14)
 * and 11-digit legacy rows.
 *
 * Import paths:
 *   Web (Vite):    import { normalizeBarcode } from '../../shared/lib/barcode.js'
 *   Mobile (Metro): import { normalizeBarcode } from '../../../shared/lib/barcode'
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS FILE IS ONE OF THREE IMPLEMENTATIONS THAT MUST AGREE:
 *   compliance_core/backend_api/barcode.py   (authoritative)
 *   compliance_core/shared/lib/barcode.js    (this file)
 *   JainiApp/src/utils/barcode.ts
 *
 * They are pinned to each other by shared/lib/barcode_vectors.json, which the
 * Python and JS test suites both consume. Before this reconciliation the three
 * disagreed: manual entry of the EAN-8 '96385074' produced a different
 * candidate list on every surface, because each had invented its own 8-digit
 * disambiguation rule (backend: UPC-E-first with EAN-8 fallbacks; this file:
 * always UPC-E; mobile: a first-digit heuristic that existed nowhere else and
 * matched no standard). The backend's dual-candidate policy won; the others
 * were ported onto it.
 *
 * Contracts (see barcode.py for the full text):
 *   1. Candidates are APPEND-ONLY — order is match priority.
 *   2. checksumValid is always validated under `symbology`.
 *   3. Mutually exclusive unconfirmable readings set `ambiguous`, never a guess.
 *   4. ITF-14 is accepted only at exactly 14 digits with a passing check digit.
 * ───────────────────────────────────────────────────────────────────────────
 */

// ── Canonical symbology names ───────────────────────────────────────────────
export const SYM_EAN_8 = 'EAN-8';
export const SYM_UPC_E = 'UPC-E';
export const SYM_UPC_A = 'UPC-A';
export const SYM_EAN_13 = 'EAN-13';
export const SYM_GTIN_14 = 'GTIN-14';
export const SYM_ITF_14 = 'ITF-14';
export const SYM_AMBIGUOUS_11 = 'AMBIGUOUS-11';
export const SYM_UNKNOWN = 'unknown';

// ── Note flags (must match barcode.py's NOTE_* constants exactly) ───────────
const NOTE_DEGENERATE = 'degenerate';
const NOTE_EAN8_CHECKSUM_VALID = 'ean8_checksum_valid';
const NOTE_EAN8_CHECKSUM_INVALID = 'ean8_checksum_invalid';
const NOTE_UPCE_CHECKSUM_VALID = 'upce_checksum_valid';
const NOTE_UPCE_CHECKSUM_INVALID = 'upce_checksum_invalid';
const NOTE_GTIN14_INDICATOR_0 = 'gtin14_indicator_0';
const NOTE_GTIN14_CASE_CODE = 'gtin14_case_code';
const NOTE_GTIN14_CHECKSUM_FAILED = 'gtin14_checksum_failed';
const NOTE_ITF_REJECTED_LENGTH = 'itf_rejected_bad_length';
const NOTE_ITF_REJECTED_CHECKSUM = 'itf_rejected_bad_checksum';
const NOTE_UPC11_LEFTPAD_VALID = 'upc11_leftpad_checksum_valid';
const NOTE_UPC11_LEFTPAD_INVALID = 'upc11_leftpad_checksum_invalid';
const NOTE_UPC11_APPENDED_CHECK = 'upc11_appended_check_digit';
const NOTE_UNSUPPORTED_LENGTH = 'unsupported_length';

/**
 * GS1 mod-10 check digit, for any GTIN length.
 *
 * Defined from the RIGHT: the digit immediately left of the check digit has
 * weight 3, then 1, 3, 1 … leftward. Being length-agnostic is what makes
 * zero-padding a GTIN check-digit-preserving.
 *
 * @param {string} payload - the code WITHOUT its check digit.
 */
export function gtinCheckDigit(payload) {
  let total = 0;
  for (let r = 0; r < payload.length; r++) {
    const digit = parseInt(payload[payload.length - 1 - r], 10);
    total += digit * (r % 2 === 0 ? 3 : 1);
  }
  return (10 - (total % 10)) % 10;
}

function gtinChecksumOk(code) {
  if (!code || !/^\d+$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === parseInt(code[code.length - 1], 10);
}

/**
 * Expand an 8-digit UPC-E to 12-digit UPC-A using the GS1 standard algorithm.
 *
 * Verified round-trip vectors (each compresses back to the UPC-E shown; see
 * shared/lib/barcode_vectors.json):
 *   X6 in 0,1,2  01637528 <-> 016200003758
 *   X6 = 3       03601202 <-> 036000000122
 *   X6 = 4       01234747 <-> 012340000077
 *   X6 in 5..9   01234589 <-> 012345000089
 *   GS1 example  04252614 <-> 042100005264
 */
export function expandUPCE(upce8) {
  if (!upce8 || upce8.length < 8) return null;
  const s = upce8[0];
  const x = upce8.slice(1, 7);
  const c = upce8[7];
  let mfr, prod;

  if (x[5] === '0' || x[5] === '1' || x[5] === '2') {
    mfr = x[0] + x[1] + x[5] + '00';
    prod = '00' + x[2] + x[3] + x[4];
  } else if (x[5] === '3') {
    mfr = x[0] + x[1] + x[2] + '00';
    prod = '000' + x[3] + x[4];
  } else if (x[5] === '4') {
    mfr = x[0] + x[1] + x[2] + x[3] + '0';
    prod = '0000' + x[4];
  } else {
    mfr = x[0] + x[1] + x[2] + x[3] + x[4];
    prod = '0000' + x[5];
  }

  return s + mfr + prod + c;
}

/**
 * True for digit strings that can never be a real product barcode.
 * 13 zeros and 14 zeros both carry a "valid" GS1 check digit, and junk rows
 * with those barcodes exist in the catalog — so a lookup would return a real,
 * unrelated product as an exact match.
 */
export function isDegenerateBarcode(cleaned) {
  return Boolean(cleaned) && new Set(cleaned).size === 1;
}

/**
 * Map a decoder's symbology label onto a canonical SYM_* name.
 * Accepts every spelling the client stacks emit (expo-camera 'ean8',
 * BarcodeDetector 'ean_8', ZXing 'EAN_8', AVFoundation 'org.gs1.EAN-8', …).
 * An unrecognised hint returns null — "behave as if unhinted" — so a new
 * decoder label can never turn a good scan into a failure.
 */
export function canonicalSymbology(hint) {
  if (hint === null || hint === undefined) return null;
  const h = String(hint).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!h) return null;
  if (h.includes('ean13')) return SYM_EAN_13;
  if (h.includes('ean8')) return SYM_EAN_8;
  if (h.includes('upca')) return SYM_UPC_A;
  if (h.includes('upce')) return SYM_UPC_E;
  if (h.includes('itf') || h.includes('interleaved2of5') || h.includes('i2of5')) return SYM_ITF_14;
  return null;
}

/** Back-compat helper: true when the hint names EAN-8. */
export function isEan8Hint(hint) {
  return canonicalSymbology(hint) === SYM_EAN_8;
}

/**
 * Validate a GTIN check digit. Returns true/false, or null when the length is
 * unsupported or the input is not digits.
 *
 * THE 8-DIGIT CASE IS SYMBOLOGY-DEPENDENT. EAN-8 and UPC-E are different
 * symbologies with different check-digit algorithms:
 *   UPC-E — the check digit belongs to the EXPANDED UPC-A.
 *   EAN-8 — the check digit is over the 8-digit code itself (identical to the
 *           EAN-13 algorithm over lpad(code, 13, '0')).
 * This file used to expand EVERY 8-digit input as UPC-E, so genuine EAN-8 codes
 * such as 40170725, 73513537 and 20886509 were reported invalid. Pass
 * symbology='ean_8' for an authoritative answer; with no hint the UPC-E reading
 * is used so the result always agrees with normalizeBarcode()'s `symbology`.
 */
export function validateChecksum(digits, symbology = null) {
  if (!digits || typeof digits !== 'string' || !/^\d+$/.test(digits)) return null;
  const canon = canonicalSymbology(symbology);

  if (digits.length === 8) {
    if (canon === SYM_EAN_8) return gtinChecksumOk(digits);
    const expanded = expandUPCE(digits);
    return expanded ? gtinChecksumOk(expanded) : null;
  }
  if (digits.length === 12 || digits.length === 13 || digits.length === 14) {
    return gtinChecksumOk(digits);
  }
  return null;
}

/** EAN-8 check digit, validated as its own symbology (never UPC-E-expanded). */
export function validateEan8Checksum(digits8) {
  if (!digits8 || !/^\d{8}$/.test(digits8)) return null;
  return gtinChecksumOk(digits8);
}

/** GTIN-14 / ITF-14 check digit. */
export function validateGtin14Checksum(digits14) {
  if (!digits14 || !/^\d{14}$/.test(digits14)) return null;
  return gtinChecksumOk(digits14);
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Normalize a raw barcode string into a canonical form with lookup candidates.
 *
 * @param {string} raw - User input or decoder payload (may contain spaces, hyphens).
 * @param {string|null} symbologyHint - Optional decoder symbology (see canonicalSymbology).
 * @returns {{raw, cleaned, symbology, upc12, ean13, gtin14, checksumValid, ambiguous, notes, lookupCandidates}}
 */
export function normalizeBarcode(raw, symbologyHint = null) {
  const cleaned = (raw || '').replace(/\D/g, '');
  const hint = canonicalSymbology(symbologyHint);

  let symbology = SYM_UNKNOWN;
  let upc12 = null;
  let ean13 = null;
  let gtin14 = null;
  let checksumValid = null;
  let ambiguous = false;
  const notes = [];
  let candidates = [];

  const result = () => ({
    raw: raw || '',
    cleaned,
    symbology,
    upc12,
    ean13,
    gtin14,
    checksumValid,
    ambiguous,
    notes,
    lookupCandidates: dedupe(candidates),
  });

  // ── Degenerate input ──────────────────────────────────────────────────────
  // Checked FIRST: 13 zeros and 14 zeros both carry a "valid" check digit.
  if (isDegenerateBarcode(cleaned)) {
    checksumValid = false;
    notes.push(NOTE_DEGENERATE);
    return result();
  }

  // ── ITF-14 guard (contract 4) ─────────────────────────────────────────────
  // Interleaved 2-of-5 is not self-checking: a partial frame decodes cleanly
  // into a shorter even-length payload that looks like a legitimate UPC-A or
  // EAN-8. Accept an ITF read at EXACTLY 14 digits with a passing check digit,
  // reject it otherwise. The backend enforces the same rule independently.
  if (hint === SYM_ITF_14) {
    symbology = SYM_ITF_14;
    if (cleaned.length !== 14) {
      notes.push(NOTE_ITF_REJECTED_LENGTH);
      return result();
    }
    if (!gtinChecksumOk(cleaned)) {
      checksumValid = false;
      notes.push(NOTE_ITF_REJECTED_CHECKSUM);
      return result();
    }
  }

  // ── 8 digits: EAN-8 vs UPC-E ──────────────────────────────────────────────
  if (cleaned.length === 8) {
    const expanded = expandUPCE(cleaned);
    const ean8Ok = gtinChecksumOk(cleaned);
    const upceOk = gtinChecksumOk(expanded);
    notes.push(ean8Ok ? NOTE_EAN8_CHECKSUM_VALID : NOTE_EAN8_CHECKSUM_INVALID);
    notes.push(upceOk ? NOTE_UPCE_CHECKSUM_VALID : NOTE_UPCE_CHECKSUM_INVALID);

    if (hint === SYM_EAN_8) {
      // Decoder confirmed EAN-8: its own symbology, NOT a compressed UPC-E.
      symbology = SYM_EAN_8;
      ean13 = cleaned.padStart(13, '0');
      gtin14 = cleaned.padStart(14, '0');
      checksumValid = ean8Ok;
      candidates = [cleaned, ean13, gtin14];
    } else if (hint === SYM_UPC_E) {
      symbology = SYM_UPC_E;
      upc12 = expanded;
      ean13 = '0' + expanded;
      gtin14 = '00' + expanded;
      checksumValid = upceOk;
      candidates = [expanded, ean13, gtin14, cleaned];
    } else {
      // No hint (manual entry, or a client that drops the symbology). Genuinely
      // ambiguous: try BOTH readings, UPC-E first (historical primary).
      symbology = SYM_UPC_E;
      upc12 = expanded;
      ean13 = '0' + expanded;
      gtin14 = '00' + expanded;
      checksumValid = upceOk;
      ambiguous = true;
      candidates = [
        expanded,                     // UPC-E -> UPC-A
        '0' + expanded,               // UPC-E -> EAN-13
        cleaned,                      // raw EAN-8
        cleaned.padStart(13, '0'),    // EAN-8 -> EAN-13
        '00' + expanded,              // UPC-E -> GTIN-14
        cleaned.padStart(14, '0'),    // EAN-8 -> GTIN-14
      ];
    }

  // ── 11 digits: legacy rows, honestly ambiguous ────────────────────────────
  } else if (cleaned.length === 11) {
    // 9,650 catalog rows are 11 digits — UPC-A that lost a digit in an old
    // import. WHICH digit is not recoverable:
    //   (a) the leading zero was stripped  -> real code is '0' + cleaned
    //   (b) the check digit was stripped   -> real code is cleaned + check
    // Only ~1,158 validate under (a). Offer both, assert neither.
    symbology = SYM_AMBIGUOUS_11;
    ambiguous = true;
    checksumValid = null;

    const leftpad12 = '0' + cleaned;
    const leftpadOk = gtinChecksumOk(leftpad12);
    const appended12 = cleaned + String(gtinCheckDigit(cleaned));

    notes.push(leftpadOk ? NOTE_UPC11_LEFTPAD_VALID : NOTE_UPC11_LEFTPAD_INVALID);
    notes.push(NOTE_UPC11_APPENDED_CHECK);

    const readingA = [leftpad12, '0' + leftpad12];
    const readingB = [appended12, '0' + appended12];
    if (leftpadOk) {
      upc12 = leftpad12;
      ean13 = '0' + leftpad12;
      candidates = [cleaned, ...readingA, ...readingB];
    } else {
      upc12 = appended12;
      ean13 = '0' + appended12;
      candidates = [cleaned, ...readingB, ...readingA];
    }

  } else if (cleaned.length === 12) {
    symbology = SYM_UPC_A;
    upc12 = cleaned;
    ean13 = '0' + cleaned;
    gtin14 = '00' + cleaned;
    checksumValid = gtinChecksumOk(cleaned);
    candidates = [cleaned, ean13, gtin14];

  } else if (cleaned.length === 13) {
    symbology = SYM_EAN_13;
    ean13 = cleaned;
    gtin14 = '0' + cleaned;
    checksumValid = gtinChecksumOk(cleaned);
    candidates = [cleaned];
    if (cleaned.startsWith('0')) {
      upc12 = cleaned.slice(1);
      candidates.push(upc12);
    }
    // 22,313 catalog rows are ordinary GTIN-13s stored as 0-padded 14s; before
    // this candidate a normal EAN-13 scan of the same product missed them.
    candidates.push(gtin14);

  // ── 14 digits: GTIN-14 / ITF-14 ───────────────────────────────────────────
  } else if (cleaned.length === 14) {
    symbology = SYM_GTIN_14;
    gtin14 = cleaned;
    checksumValid = gtinChecksumOk(cleaned);
    if (!checksumValid) {
      // A 14-digit payload with a bad check digit is an ITF misread or a typo.
      // Emitting candidates for it is how a scanner confidently returns the
      // WRONG product.
      notes.push(NOTE_GTIN14_CHECKSUM_FAILED);
      return result();
    }

    if (cleaned[0] === '0') {
      // Plain GTIN-13 stored zero-padded; padding never changes the check
      // digit, so cleaned.slice(1) is a valid EAN-13 by construction.
      notes.push(NOTE_GTIN14_INDICATOR_0);
      ean13 = cleaned.slice(1);
      candidates = [cleaned, ean13];
      if (ean13.startsWith('0')) {
        upc12 = ean13.slice(1);
        candidates.push(upc12);
      }
    } else {
      // Indicator 1-9 = a case/carton/pallet level. The trade item inside is
      // digits[1..13) plus a RECOMPUTED check digit — the GTIN-14's own check
      // digit belongs to the case, not the unit.
      notes.push(NOTE_GTIN14_CASE_CODE);
      const base12 = cleaned.slice(1, 13);
      const base13 = base12 + String(gtinCheckDigit(base12));
      ean13 = base13;
      candidates = [cleaned, base13];
      if (base13.startsWith('0')) {
        upc12 = base13.slice(1);
        candidates.push(upc12);
      }
      candidates.push('0' + base13);
    }

  } else if (cleaned) {
    // 9, 10, 15, 16 … digits. No GTIN has those lengths; ~203 such rows are
    // junk in the catalog. Candidates for them could only be false matches.
    notes.push(NOTE_UNSUPPORTED_LENGTH);
  }

  return result();
}

/**
 * Can this input be looked up at all?
 *
 * Defined as "normalization produced at least one candidate", which is exactly
 * the condition /v1/verdict uses to decide between a lookup and a 400. It is
 * therefore true for 8/11/12/13/14-digit input and false for degenerate codes,
 * junk lengths, and 14-digit payloads whose check digit does not pass.
 */
export function isValidBarcode(raw, symbologyHint = null) {
  return normalizeBarcode(raw, symbologyHint).lookupCandidates.length > 0;
}

/** Human-readable label for the detected symbology ('' when unrecognised). */
export function getSymbologyLabel(raw, symbologyHint = null) {
  const sym = normalizeBarcode(raw, symbologyHint).symbology;
  return sym === SYM_UNKNOWN ? '' : sym;
}


export function pickLookupBarcode(raw, symbologyHint = null) {
  const n = normalizeBarcode(raw, symbologyHint);
  const barcode = n.cleaned.length === 8
    ? n.cleaned
    : (n.upc12 || n.ean13 || n.cleaned);
  const valid = barcode.length === 8 || barcode.length === 12 || barcode.length === 13;
  return { barcode, symbology: n.symbology, valid };
}

// Human-readable symbology label. An 8-digit code is UPC-E by default, but a
// scanner symbology hint of EAN-8 must be honoured (EAN-8 is a distinct
// symbology, not a compressed UPC-E).
