/**
 * Scan history — load, save, push, and render scan history entries.
 */
import { HISTORY_KEY, HISTORY_MAX } from "../config/shared-config.js";
import * as Auth from "../auth.js";
import { timeAgo } from "./share.js";

export function historyLoad() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

export function historySave(entries) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch {}
}

/**
 * Push a new history entry and re-render.
 * @param {Object} entry - {barcode, status, product_name, brand, profile, ts, verdictData}
 * @param {Function} onRender - callback to trigger renderHistory
 */
export function historyPush(entry, onRender) {
  const entries = historyLoad().filter(
    e => !(e.barcode === entry.barcode && e.profile === entry.profile)
  );
  entries.unshift(entry);
  historySave(entries.slice(0, HISTORY_MAX));
  if (onRender) onRender();
}

/**
 * Sync server-side scan history for signed-in users.
 * @param {string} apiBase
 * @param {Function} onRender - callback to trigger renderHistory
 */
export async function syncServerHistory(apiBase, onRender) {
  try {
    const resp = await Auth.authFetch(`${apiBase}/v1/scan-history`);
    if (!resp.ok) return;
    const { history } = await resp.json().catch(() => ({}));
    if (!history || !history.length) return;
    const local = historyLoad();
    const seen = new Set(local.map(e => `${e.barcode}:${e.profile}`));
    let added = 0;
    for (const s of history) {
      const key = `${s.barcode}:${s.profile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      local.push({
        barcode: s.barcode,
        status: s.status || "UNKNOWN",
        product_name: s.product_name || "",
        brand: s.brand || "",
        profile: s.profile || "jain",
        ts: s.ts || "",
        verdictData: null,
      });
      added++;
    }
    if (added > 0) {
      local.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
      historySave(local.slice(0, HISTORY_MAX));
      if (onRender) onRender();
    }
  } catch { /* non-critical */ }
}

/**
 * Render the history list into the DOM.
 * @param {Object} opts
 * @param {HTMLElement} opts.section - history section element
 * @param {HTMLElement} opts.list - history list element (ul)
 * @param {Function} opts.show - show(el) function
 * @param {Function} opts.hide - hide(el) function
 * @param {Function} opts.getActiveProfile
 * @param {Object} opts.state - shared state object
 * @param {Function} opts.onRescan - callback(barcode, verdictData) for re-scanning
 */
export function renderHistory(opts) {
  const entries = historyLoad();
  const { section, list, show, hide } = opts;
  if (!section || !list) return;

  if (entries.length === 0) {
    hide(section);
    return;
  }

  show(section);
  list.innerHTML = "";

  entries.forEach(entry => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.setAttribute("role", "listitem");

    const dot = document.createElement("span");
    dot.className = `history-dot history-dot--${(entry.status || "UNKNOWN").toLowerCase()}`;
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "history-name";
    name.textContent = entry.product_name || entry.barcode;

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = timeAgo(entry.ts);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-rescan";
    btn.dataset.barcode = entry.barcode;
    btn.setAttribute("aria-label", `Re-scan ${entry.product_name || entry.barcode}`);
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.62"/></svg>`;

    const showVerdict = () => {
      if (opts.state.inFlight || opts.state.scanLocked) return;
      opts.onRescan(entry.barcode, entry.verdictData, entry.profile);
    };
    btn.addEventListener("click", (e) => { e.stopPropagation(); showVerdict(); });
    li.addEventListener("click", showVerdict);

    li.appendChild(dot);
    li.appendChild(name);
    li.appendChild(time);
    li.appendChild(btn);
    list.appendChild(li);
  });
}
