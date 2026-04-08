/**
 * config.js — Re-exports shared configuration constants for the ES module tree.
 *
 * All modules should import config values from here (or directly from
 * config/shared-config.js). This file also defines web-only constants
 * such as SVG status icons.
 */

export {
  API_BASE_PROD,
  API_BASE_DEV,
  REQUEST_TIMEOUT_MS,
  VERDICT_FAILSAFE_MS,
  ENDPOINTS,
  PROFILES,
  PROFILE_DEFAULT,
  PROFILE_KEY,
  HISTORY_KEY,
  HISTORY_MAX,
  STATUS_META as STATUS_META_BASE,
  INGREDIENT_GROUP_META,
  REASON_LABELS,
  MESSAGES,
} from "../config/shared-config.js";

// ── Web-only: SVG icons merged into STATUS_META ──────────────────────────────
// Labels, descriptions, and ariaPrefix come from shared/verdicts.json via shared-config.js.
// Icons are SVG strings and are web-specific — kept here, not in shared config.

import { STATUS_META as _STATUS_META_BASE } from "../config/shared-config.js";

const STATUS_ICONS = {
  GREEN:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  YELLOW:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  ORANGE:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  RED:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  UNKNOWN: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
};

export const STATUS_META = Object.fromEntries(
  Object.entries(_STATUS_META_BASE).map(([k, v]) => [k, { ...v, icon: STATUS_ICONS[k] }])
);
