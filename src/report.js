/**
 * report.js — Detailed misclassification report (POST /v1/report-classification).
 *
 * The binary "Looks right / Flag" vote in community.js is a signal; this is the
 * evidence channel — free-text description of what is wrong, plus the corrected
 * ingredient text and an optional email for follow-up. Ports the mobile
 * ReportModal (JainiApp/src/components/ReportModal.tsx) field-for-field.
 *
 * Anonymous: identified only by X-Client-Id, no Authorization header.
 */

import { show, hide, openModal, closeModal, showFormMsg, clearFormMsg } from "./ui.js";
import { fetchWithTimeout, getApiBase, getClientId, reportClientEvent, REQUEST_TIMEOUT_MS } from "./api.js";
import { getActiveProfile } from "./profile.js";
import { WEB_ENDPOINTS } from "./config.js";

let _inFlight = false;

function els() {
  return {
    modal:     document.getElementById("reportModal"),
    formBody:  document.getElementById("reportFormBody"),
    success:   document.getElementById("reportSuccessBody"),
    barcode:   document.getElementById("reportBarcodeDisplay"),
    whatWrong: document.getElementById("reportWhatWrong"),
    corrected: document.getElementById("reportCorrected"),
    email:     document.getElementById("reportEmail"),
    submitBtn: document.getElementById("reportSubmitBtn"),
    submitLbl: document.getElementById("reportSubmitLabel"),
  };
}

function resetReportModal() {
  const e = els();
  if (e.whatWrong) e.whatWrong.value = "";
  if (e.corrected) e.corrected.value = "";
  if (e.email) e.email.value = "";
  if (e.submitBtn) e.submitBtn.disabled = false;
  if (e.submitLbl) e.submitLbl.textContent = "Submit report";
  show(e.formBody);
  hide(e.success);
  if (e.modal) clearFormMsg(e.modal);
  _inFlight = false;
}

/**
 * Build the POST body. Exported so tests can assert the field names without
 * driving the DOM — the backend rejects anything else (ClassificationReportRequest).
 */
export function buildReportBody({ barcode, profile, whatWrong, corrected, email }) {
  return {
    barcode: String(barcode || ""),
    profile: String(profile || "everyday_jain"),
    what_wrong: String(whatWrong || "").trim(),
    corrected_ingredients: String(corrected || "").trim(),
    reporter_email: String(email || "").trim(),
  };
}

async function handleSubmit() {
  if (_inFlight) return;
  const e = els();
  const whatWrong = (e.whatWrong?.value || "").trim();

  if (!whatWrong) {
    showFormMsg(e.modal, "Please describe what seems wrong.", "error");
    e.whatWrong?.focus();
    return;
  }

  const body = buildReportBody({
    barcode: e.barcode?.value || "",
    profile: getActiveProfile(),
    whatWrong,
    corrected: e.corrected?.value,
    email: e.email?.value,
  });

  _inFlight = true;
  if (e.submitBtn) e.submitBtn.disabled = true;
  if (e.submitLbl) e.submitLbl.textContent = "Sending…";
  clearFormMsg(e.modal);

  try {
    const resp = await fetchWithTimeout(
      `${getApiBase()}${WEB_ENDPOINTS.report_classification}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
        body: JSON.stringify(body),
      },
      REQUEST_TIMEOUT_MS,
    );
    const data = await resp.json().catch(() => ({}));

    if (resp.ok) {
      hide(e.formBody);
      show(e.success);
      clearFormMsg(e.modal);
      return;
    }

    const msg = data.detail || data.message
      || (resp.status === 429 ? "Too many reports. Please wait a moment and try again."
                              : "Failed to submit report. Please try again.");
    showFormMsg(e.modal, msg, "error");
    reportClientEvent("feedback_failed", {
      barcode: body.barcode,
      error_code: String(resp.status),
      error_msg: data?.error || "",
    });
  } catch (err) {
    showFormMsg(e.modal, "Network error: please check your connection and try again.", "error");
    reportClientEvent("feedback_failed", { barcode: body.barcode, error_msg: err?.message || "network" });
  } finally {
    _inFlight = false;
    if (e.submitBtn) e.submitBtn.disabled = false;
    if (e.submitLbl) e.submitLbl.textContent = "Submit report";
  }
}

export function bindReportEvents(getCurrentBarcode) {
  const modal = document.getElementById("reportModal");

  document.getElementById("reportClassificationBtn")?.addEventListener("click", () => {
    const bc = getCurrentBarcode();
    if (!bc) return;
    resetReportModal();
    const e = els();
    if (e.barcode) e.barcode.value = bc;
    openModal(modal);
    setTimeout(() => document.getElementById("reportWhatWrong")?.focus(), 80);
  });

  const dismiss = () => { resetReportModal(); closeModal(modal); };
  document.getElementById("reportCloseBtn")?.addEventListener("click", dismiss);
  document.getElementById("reportCancelBtn")?.addEventListener("click", dismiss);
  document.getElementById("reportSubmitBtn")?.addEventListener("click", handleSubmit);
  modal?.addEventListener("click", (ev) => { if (ev.target === modal) dismiss(); });
}

export { resetReportModal };
