/**
 * barcode.js — Re-exports from the shared barcode library.
 *
 * All barcode logic now lives in shared/lib/barcode.js (single source of truth).
 * This file exists for backward compatibility with existing imports.
 */
export {
  validateChecksum,
  normalizeBarcode,
  isValidBarcode,
  getSymbologyLabel,
} from '../shared/lib/barcode.js';
