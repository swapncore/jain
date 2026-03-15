/**
 * barcode.js — Canonical barcode normalization for the web app.
 *
 * Mirrors JainiApp/src/utils/barcode.js for the legacy web frontend.
 * Handles UPC-A (12-digit) and EAN-13 (13-digit) normalization,
 * including human-readable split formats like "0 34240 03400 5".
 */

function ean13CheckDigit(ean13) {
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const w = i % 2 === 0 ? 1 : 3;
    total += parseInt(ean13[i], 10) * w;
  }
  return (10 - (total % 10)) % 10;
}

export function validateChecksum(digits) {
  if (!digits || (digits.length !== 12 && digits.length !== 13)) return null;
  if (!/^\d+$/.test(digits)) return null;
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

  if (cleaned.length === 12) {
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
  return cleaned.length === 12 || cleaned.length === 13;
}
