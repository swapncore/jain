/**
 * barcode.js — Canonical barcode normalization for the web app.
 *
 * Mirrors JainiApp/src/utils/barcode.js for the legacy web frontend.
 * Handles UPC-E (8-digit), UPC-A (12-digit), and EAN-13 (13-digit)
 * normalization, including human-readable split formats.
 */

function expandUPCE(upce8) {
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

function ean13CheckDigit(ean13) {
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const w = i % 2 === 0 ? 1 : 3;
    total += parseInt(ean13[i], 10) * w;
  }
  return (10 - (total % 10)) % 10;
}

export function validateChecksum(digits) {
  if (!digits || !/^\d+$/.test(digits)) return null;
  if (digits.length === 8) {
    return validateChecksum(expandUPCE(digits));
  }
  if (digits.length !== 12 && digits.length !== 13) return null;
  const ean13 = digits.length === 13 ? digits : '0' + digits;
  return parseInt(ean13[12], 10) === ean13CheckDigit(ean13);
}

export function normalizeBarcode(raw) {
  const cleaned = (raw || '').replace(/\D/g, '');

  let symbology = 'unknown';
  let upc12 = null;
  let ean13 = null;
  let checksumValid = null;
  const candidates = [];

  if (cleaned.length === 8 && /^\d+$/.test(cleaned)) {
    symbology = 'UPC-E';
    const expanded = expandUPCE(cleaned);
    if (expanded) {
      upc12 = expanded;
      ean13 = '0' + expanded;
      checksumValid = validateChecksum(cleaned);
      candidates.push(expanded, ean13);
    }
  } else if (cleaned.length === 12) {
    symbology = 'UPC-A';
    upc12 = cleaned;
    ean13 = '0' + cleaned;
    checksumValid = validateChecksum(cleaned);
    candidates.push(cleaned, ean13);
  } else if (cleaned.length === 13) {
    symbology = 'EAN-13';
    ean13 = cleaned;
    checksumValid = validateChecksum(cleaned);
    candidates.push(cleaned);
    if (cleaned.startsWith('0')) {
      upc12 = cleaned.slice(1);
      candidates.push(upc12);
    }
  }

  const seen = new Set();
  const lookupCandidates = [];
  for (const c of candidates) {
    if (!seen.has(c)) {
      seen.add(c);
      lookupCandidates.push(c);
    }
  }

  return { raw: raw || '', cleaned, symbology, upc12, ean13, checksumValid, lookupCandidates };
}

export function isValidBarcode(raw) {
  const cleaned = (raw || '').replace(/\D/g, '');
  return cleaned.length === 8 || cleaned.length === 12 || cleaned.length === 13;
}
