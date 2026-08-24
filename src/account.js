/**
 * account.js — Account deletion (DELETE /v1/account).
 *
 * GDPR / CCPA and the app-store account-deletion policies require a
 * self-service delete on every surface that can create an account. The mobile
 * apps have had it; the web offered only sign-out.
 *
 * Web uses a typed confirmation ("DELETE") rather than the mobile two-button
 * native alert — a click on a web page is far cheaper to make by accident, and
 * this action is irreversible.
 */

import { openModal, closeModal, showFormMsg, clearFormMsg } from "./ui.js";
import { getApiBase } from "./api.js";
import { WEB_ENDPOINTS } from "./config.js";
import * as Auth from "../auth.js";
// The "what has to be erased" policy lives in its own DOM-free module so the
// test suite can cover it — this file cannot be imported under Node because
// auth.js pulls Firebase from an absolute https:// URL.
import {
  PERSONAL_LOCAL_KEYS, clearPersonalLocalData, clearCachedVerdicts, isApiCacheName,
} from "./privacy.js";

export { PERSONAL_LOCAL_KEYS, clearPersonalLocalData, clearCachedVerdicts, isApiCacheName };

export const CONFIRM_WORD = "DELETE";

let _inFlight = false;

/** Exported for tests: the confirmation is exact and case-sensitive. */
export function isDeleteConfirmed(typed) {
  return String(typed ?? "") === CONFIRM_WORD;
}

function els() {
  return {
    modal:   document.getElementById("deleteAccountModal"),
    input:   document.getElementById("deleteAccountConfirm"),
    confirm: document.getElementById("deleteAccountConfirmBtn"),
    label:   document.getElementById("deleteAccountConfirmLabel"),
  };
}

function resetDeleteModal() {
  const e = els();
  if (e.input) e.input.value = "";
  if (e.confirm) e.confirm.disabled = true;
  if (e.label) e.label.textContent = "Delete account";
  if (e.modal) clearFormMsg(e.modal);
  _inFlight = false;
}

/**
 * @param {Object} opts
 * @param {Function} opts.onDeleted - called after local data is cleared and the
 *   user is signed out, so the host page can reset its UI.
 */
export function bindAccountEvents({ onDeleted } = {}) {
  const modal = document.getElementById("deleteAccountModal");

  document.getElementById("dropdownDeleteAccountBtn")?.addEventListener("click", () => {
    resetDeleteModal();
    openModal(modal);
    setTimeout(() => document.getElementById("deleteAccountConfirm")?.focus(), 80);
  });

  document.getElementById("deleteAccountConfirm")?.addEventListener("input", (ev) => {
    const btn = document.getElementById("deleteAccountConfirmBtn");
    if (btn && !_inFlight) btn.disabled = !isDeleteConfirmed(ev.target.value);
  });

  const dismiss = () => { if (!_inFlight) { resetDeleteModal(); closeModal(modal); } };
  document.getElementById("deleteAccountCloseBtn")?.addEventListener("click", dismiss);
  document.getElementById("deleteAccountCancelBtn")?.addEventListener("click", dismiss);
  modal?.addEventListener("click", (ev) => { if (ev.target === modal) dismiss(); });

  document.getElementById("deleteAccountConfirmBtn")?.addEventListener("click", () => {
    handleDelete(onDeleted);
  });
}

async function handleDelete(onDeleted) {
  if (_inFlight) return;
  const e = els();
  if (!isDeleteConfirmed(e.input?.value)) {
    showFormMsg(e.modal, `Type ${CONFIRM_WORD} exactly to confirm.`, "error");
    return;
  }

  _inFlight = true;
  if (e.confirm) e.confirm.disabled = true;
  if (e.label) e.label.textContent = "Deleting…";
  showFormMsg(e.modal, "Deleting your account…", "info");

  try {
    const resp = await Auth.authFetch(`${getApiBase()}${WEB_ENDPOINTS.account}`, {
      method: "DELETE",
    });

    if (resp.status === 401) {
      // Do NOT clear local data — nothing was deleted server-side.
      showFormMsg(e.modal, "Your session expired. Please sign in again, then retry deleting your account.", "error");
      return;
    }

    if (!resp.ok) {
      showFormMsg(e.modal, "Something went wrong on our end. Please try again in a moment.", "error");
      return;
    }

    // Server confirmed. Clear this device, then sign out.
    await clearPersonalLocalData();
    try { await Auth.signOut(); } catch { /* already signed out */ }
    closeModal(e.modal);
    resetDeleteModal();
    if (onDeleted) onDeleted();
  } catch {
    showFormMsg(e.modal, "Please check your connection and try again.", "error");
  } finally {
    _inFlight = false;
    if (e.confirm) e.confirm.disabled = !isDeleteConfirmed(e.input?.value);
    if (e.label) e.label.textContent = "Delete account";
  }
}
