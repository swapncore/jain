/**
 * api.js — Centralized API calls and network utilities for Jaini web app.
 *
 * All HTTP requests to the backend go through this module. Provides
 * fetchWithTimeout, client ID management, and API base URL resolution.
 */

import {
  API_BASE_PROD,
  API_BASE_DEV,
  REQUEST_TIMEOUT_MS,
  ENDPOINTS,
} from "./config.js";

// ── API base URL ────────────────────────────────────────────────────────────

export function getApiBase() {
  const h = window.location.hostname;
  return (h === "localhost" || h === "127.0.0.1") ? API_BASE_DEV : API_BASE_PROD;
}

// ── Client ID (anonymous device identifier) ─────────────────────────────────

const CLIENT_ID_KEY = "JAIN_CLIENT_ID";

export function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (window.crypto?.randomUUID?.()) ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.floor(Math.random() * 16);
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

// ── Fetch with timeout ──────────────────────────────────────────────────────

export async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

// ── Client failure telemetry ────────────────────────────────────────────────

export async function reportClientEvent(eventType, opts = {}) {
  try {
    await fetchWithTimeout(`${getApiBase()}${ENDPOINTS.client_event}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
      body: JSON.stringify({
        event_type: eventType,
        barcode: opts.barcode || undefined,
        profile: opts.profile || undefined,
        error_code: opts.error_code,
        error_msg: opts.error_msg,
        response_ms: opts.response_ms,
      }),
    }, REQUEST_TIMEOUT_MS);
  } catch { /* fire-and-forget, never throw */ }
}

// Re-export for convenience
export { REQUEST_TIMEOUT_MS, ENDPOINTS };
