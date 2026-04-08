/**
 * history.js — Scan history management and UI rendering.
 *
 * Wraps the lib/history.js low-level functions and provides the
 * renderHistory integration with the main app state.
 */

import {
  historySave,
  historyPush as _historyPush,
  syncServerHistory as _syncServerHistory,
  renderHistory as _renderHistory,
} from "../lib/history.js";

import { show, hide } from "./ui.js";
import { getApiBase } from "./api.js";
import { getActiveProfile } from "./profile.js";

// ── History push ────────────────────────────────────────────────────────────

export function historyPush(entry, renderFn) {
  _historyPush(entry, renderFn);
}

// ── History rendering ───────────────────────────────────────────────────────

/**
 * Render the history list.
 * @param {Object} opts
 * @param {Object} opts.state - shared app state
 * @param {Function} opts.onRescan - callback(barcode, verdictData, entryProfile)
 */
export function renderHistory({ state, onRescan }) {
  const section = document.getElementById("historySection");
  const list = document.getElementById("historyList");

  _renderHistory({
    section,
    list,
    show,
    hide,
    getActiveProfile,
    state,
    onRescan,
  });
}

// ── Server sync ─────────────────────────────────────────────────────────────

export async function syncServerHistory(renderFn) {
  return _syncServerHistory(getApiBase(), renderFn);
}

// ── Clear history ───────────────────────────────────────────────────────────

export function clearHistory(renderFn) {
  historySave([]);
  renderFn();
}

// Re-export
export { historySave };
