/**
 * missing.js — Missing product submission (typed ingredients + photo).
 *
 * Two paths, matching the mobile apps:
 *
 *  1. TYPED INGREDIENTS (primary) — the user types/pastes the ingredient list,
 *     it is POSTed to /v1/submit_missing, and the verdict comes straight back
 *     in the response body. This is the "phone answers in seconds" path the
 *     web used to be missing entirely.
 *
 *  2. PHOTO (secondary) — the label photo goes to /v1/submit_missing_photo for
 *     manual review. No verdict; the team adds the product later.
 *
 * HONESTY: a verdict computed from user-typed ingredients has NOT been checked
 * against the packaging. It is rendered with data_source="community" and
 * verified=false, which surfaces the same "Community-submitted · unverified"
 * badge the mobile apps show. Never present it as a catalog verdict.
 */

import { show, hide, openModal, closeModal, showFormMsg, clearFormMsg } from "./ui.js";
import { fetchWithTimeout, getApiBase, getClientId, reportClientEvent, ENDPOINTS } from "./api.js";
import { getActiveProfile } from "./profile.js";
import { displayVerdictData, fetchVerdict } from "./verdict.js";
import { MESSAGES } from "./config.js";
import {
  SUBMIT_TIMEOUT_MS, MIN_INGREDIENTS_CHARS,
  buildCommunityVerdict, looksLikeIngredientList, submitMissingIngredients,
} from "./submission.js";
import * as Auth from "../auth.js";

let _missingStream = null;
let _missingPhotoData = null;
let _textSubmitInFlight = false;

// ── Missing camera ──────────────────────────────────────────────────────────

export async function startMissingCamera() {
  const missingVideo = document.getElementById("missingVideo");
  if (_missingStream) return;
  try {
    _missingStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    if (missingVideo) {
      missingVideo.srcObject = _missingStream;
      missingVideo.play().catch(() => {});
      show(missingVideo);
    }
  } catch (err) {
    if (missingVideo) hide(missingVideo);
    reportClientEvent("camera_error", { error_msg: "missing_modal_" + (err?.name || "unknown") });
  }
}

export function stopMissingCamera() {
  const missingVideo = document.getElementById("missingVideo");
  if (_missingStream) {
    _missingStream.getTracks().forEach(t => t.stop());
    _missingStream = null;
  }
  if (missingVideo) missingVideo.srcObject = null;
}

function captureFromMissingCamera() {
  const missingVideo = document.getElementById("missingVideo");
  const missingCanvas = document.getElementById("missingCanvas");
  if (!missingVideo || !missingCanvas) return;
  const v = missingVideo;
  const c = missingCanvas;
  c.width = v.videoWidth || 640;
  c.height = v.videoHeight || 480;
  c.getContext("2d").drawImage(v, 0, 0);
  const dataUrl = c.toDataURL("image/jpeg", 0.7);
  setMissingPhoto(dataUrl);
}

function setMissingPhoto(dataUrl) {
  const missingModal = document.getElementById("missingModal");
  const missingPreview = document.getElementById("missingPreview");
  const missingPreviewImg = document.getElementById("missingPreviewImg");
  const missingCaptureControls = document.getElementById("missingCaptureControls");
  const missingReviewControls = document.getElementById("missingReviewControls");
  const missingSubmitBtn = document.getElementById("missingSubmitBtn");
  const missingSubmitLabel = document.getElementById("missingSubmitLabel");

  // Validate size before accepting
  const b64Part = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const decodedSize = Math.ceil(b64Part.length * 3 / 4);
  if (decodedSize > 1_600_000) {
    showFormMsg(missingModal, "Photo is too large (max 1.5 MB). Try a lower resolution or crop the image.", "error");
    return;
  }
  _missingPhotoData = dataUrl;
  if (missingPreviewImg) missingPreviewImg.src = dataUrl;
  show(missingPreview);
  hide(missingCaptureControls);
  show(missingReviewControls);
  stopMissingCamera();
  if (missingSubmitBtn) missingSubmitBtn.disabled = false;
  if (missingSubmitLabel) missingSubmitLabel.textContent = "Submit Photo";
}

// ── Typed-ingredients path ──────────────────────────────────────────────────

function setTextSubmitting(on) {
  const btn = document.getElementById("missingTextSubmitBtn");
  const label = document.getElementById("missingTextSubmitLabel");
  if (btn) btn.disabled = on || !isIngredientsValid();
  if (label) label.textContent = on ? "Checking…" : "Get verdict";
}

function isIngredientsValid() {
  const ta = document.getElementById("missingIngredients");
  return (ta?.value || "").trim().length >= MIN_INGREDIENTS_CHARS;
}

export function updateIngredientsState() {
  const btn = document.getElementById("missingTextSubmitBtn");
  if (btn && !_textSubmitInFlight) btn.disabled = !isIngredientsValid();
  return isIngredientsValid();
}

let _warnedAboutShape = false;

async function handleIngredientsSubmit(e) {
  if (e) e.preventDefault();
  if (_textSubmitInFlight) return;

  const missingModal = document.getElementById("missingModal");
  const missingBarcode = document.getElementById("missingBarcode");
  const missingName = document.getElementById("missingName");
  const ta = document.getElementById("missingIngredients");

  const barcode = missingBarcode?.value || "";
  const ingredientsText = (ta?.value || "").trim();
  const productName = (missingName?.value || "").trim();

  if (!barcode) {
    showFormMsg(missingModal, "No barcode to attach this to. Close and scan again.", "error");
    return;
  }
  if (ingredientsText.length < MIN_INGREDIENTS_CHARS) {
    showFormMsg(missingModal, "Please enter the ingredient list.", "error");
    return;
  }
  // Soft shape warning — the second tap goes through regardless (same as mobile).
  if (!looksLikeIngredientList(ingredientsText) && !_warnedAboutShape) {
    _warnedAboutShape = true;
    showFormMsg(
      missingModal,
      "This doesn't look like a typical ingredient list. Tap Get verdict again to analyze anyway, or fix the text first.",
      "info",
    );
    return;
  }

  _textSubmitInFlight = true;
  setTextSubmitting(true);
  showFormMsg(missingModal, "Analysing ingredients…", "info");

  try {
    const { ok, status, data } = await submitMissingIngredients({
      barcode,
      ingredientsText,
      productName,
      brand: "",
      profile: getActiveProfile(),
      accessToken: Auth.getAccessToken(),
    });

    if (ok) {
      clearFormMsg(missingModal);
      closeModal(missingModal);
      resetMissingModal();
      // The submit response IS the verdict — render it as community/unverified.
      displayVerdictData(buildCommunityVerdict(data, barcode), data.barcode || barcode);
      return;
    }

    if (status === 409) {
      // Someone already submitted this barcode. The product now exists, so the
      // verdict endpoint can answer — show that instead of an error.
      closeModal(missingModal);
      resetMissingModal();
      await fetchVerdict(barcode).catch(() => {});
      return;
    }

    if (status === 429) {
      showFormMsg(missingModal, data.message || "Too many submissions. Please wait a moment and try again.", "error");
    } else {
      showFormMsg(missingModal, data.message || MESSAGES.submissionError, "error");
    }
    reportClientEvent("submission_failed", {
      barcode,
      error_code: String(status),
      error_msg: data?.error || data?.message || "",
    });
  } catch (err) {
    showFormMsg(
      missingModal,
      err?.name === "AbortError" ? MESSAGES.timeout : MESSAGES.network,
      "error",
    );
    reportClientEvent("submission_failed", { barcode, error_msg: err?.message || "network" });
  } finally {
    _textSubmitInFlight = false;
    setTextSubmitting(false);
  }
}

// ── Photo path ──────────────────────────────────────────────────────────────

async function handleMissingSubmit(e) {
  if (e) e.preventDefault();
  const missingModal = document.getElementById("missingModal");
  const missingBarcode = document.getElementById("missingBarcode");
  const missingName = document.getElementById("missingName");
  const missingSubmitBtn = document.getElementById("missingSubmitBtn");
  const missingSubmitLabel = document.getElementById("missingSubmitLabel");

  if (!_missingPhotoData) {
    showFormMsg(missingModal, "Please capture or upload a photo first.", "error");
    return;
  }
  missingSubmitBtn.disabled = true;
  if (missingSubmitLabel) missingSubmitLabel.textContent = "Submitting…";
  showFormMsg(missingModal, "Submitting photo…", "info");

  try {
    const resp = await fetchWithTimeout(
      `${getApiBase()}${ENDPOINTS.submit_missing_photo}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": getClientId(),
          ...(Auth.getAccessToken() ? { "Authorization": `Bearer ${Auth.getAccessToken()}` } : {}),
        },
        body: JSON.stringify({
          barcode: missingBarcode?.value || "",
          product_name: missingName?.value?.trim() || "",
          photo_b64: _missingPhotoData.split(",")[1],
        }),
      },
      SUBMIT_TIMEOUT_MS,
    );
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      showFormMsg(missingModal, "Thank you for uploading! Our team reviews submissions daily and will add this product to the database. For an instant verdict, type the ingredients instead.", "success");
      setTimeout(() => closeModal(missingModal), 2500);
    } else {
      const msg = data.message || "Submission failed. Please try again.";
      showFormMsg(missingModal, msg, "error");
      missingSubmitBtn.disabled = false;
      if (missingSubmitLabel) missingSubmitLabel.textContent = "Submit Photo";
      reportClientEvent("submission_failed", { error_msg: msg });
    }
  } catch (err) {
    const msg = "Network error: please check your connection and try again.";
    showFormMsg(missingModal, msg, "error");
    missingSubmitBtn.disabled = false;
    if (missingSubmitLabel) missingSubmitLabel.textContent = "Submit Photo";
    reportClientEvent("submission_failed", { error_msg: err?.message || "network" });
  }
}

// ── Tab switching ───────────────────────────────────────────────────────────

function selectMissingTab(which) {
  const tabText = document.getElementById("missingTabText");
  const tabPhoto = document.getElementById("missingTabPhoto");
  const paneText = document.getElementById("missingTextPane");
  const panePhoto = document.getElementById("missingPhotoPane");
  const isText = which === "text";

  tabText?.classList.toggle("missing-tab--active", isText);
  tabPhoto?.classList.toggle("missing-tab--active", !isText);
  tabText?.setAttribute("aria-selected", isText ? "true" : "false");
  tabPhoto?.setAttribute("aria-selected", isText ? "false" : "true");
  if (isText) { show(paneText); hide(panePhoto); } else { hide(paneText); show(panePhoto); }

  if (isText) {
    // Don't hold the camera open behind a text form.
    stopMissingCamera();
    setTimeout(() => document.getElementById("missingIngredients")?.focus(), 50);
  } else if (!_missingPhotoData) {
    startMissingCamera();
  }
}

// ── Reset ───────────────────────────────────────────────────────────────────

function resetMissingModal() {
  const missingModal = document.getElementById("missingModal");
  const missingPreview = document.getElementById("missingPreview");
  const missingCaptureControls = document.getElementById("missingCaptureControls");
  const missingReviewControls = document.getElementById("missingReviewControls");
  const ta = document.getElementById("missingIngredients");

  stopMissingCamera();
  _missingPhotoData = null;
  _warnedAboutShape = false;
  if (ta) ta.value = "";
  updateIngredientsState();
  hide(missingPreview);
  show(missingCaptureControls);
  hide(missingReviewControls);
  if (missingModal) clearFormMsg(missingModal);
}

// ── Bind missing modal events ───────────────────────────────────────────────

export function bindMissingEvents(getCurrentBarcode) {
  const missingModal = document.getElementById("missingModal");
  const missingPreview = document.getElementById("missingPreview");
  const missingCaptureControls = document.getElementById("missingCaptureControls");
  const missingReviewControls = document.getElementById("missingReviewControls");
  const missingBarcode = document.getElementById("missingBarcode");
  const missingBarcodeDisplay = document.getElementById("missingBarcodeDisplay");
  const missingName = document.getElementById("missingName");
  const missingFileInput = document.getElementById("missingFileInput");
  const missingIngredients = document.getElementById("missingIngredients");

  // Any [data-open-missing] control opens the modal on the TEXT tab (the
  // instant-verdict path). Two entry points use it: "Report missing product"
  // on the not-found panel, and "Add ingredients from the label" on the
  // UNKNOWN guidance panel — an UNKNOWN verdict is precisely the case where a
  // reader holding the pack can resolve it themselves.
  document.querySelectorAll("[data-open-missing]").forEach(btn => {
    btn.addEventListener("click", () => {
      const bc = getCurrentBarcode();
      if (missingBarcode) missingBarcode.value = bc;
      if (missingBarcodeDisplay) missingBarcodeDisplay.textContent = bc;
      if (missingName) missingName.value = "";
      resetMissingModal();
      selectMissingTab("text");
      openModal(missingModal);
      setTimeout(() => document.getElementById("missingIngredients")?.focus(), 80);
    });
  });

  // Tabs
  document.getElementById("missingTabText")?.addEventListener("click", () => selectMissingTab("text"));
  document.getElementById("missingTabPhoto")?.addEventListener("click", () => selectMissingTab("photo"));

  // Ingredients textarea
  missingIngredients?.addEventListener("input", () => {
    _warnedAboutShape = false;
    clearFormMsg(missingModal);
    updateIngredientsState();
  });
  document.getElementById("missingTextSubmitBtn")?.addEventListener("click", handleIngredientsSubmit);

  // Capture button
  document.getElementById("missingCaptureBtn")?.addEventListener("click", captureFromMissingCamera);

  // Retake button
  document.getElementById("missingRetakeBtn")?.addEventListener("click", () => {
    _missingPhotoData = null;
    hide(missingPreview);
    show(missingCaptureControls);
    hide(missingReviewControls);
    startMissingCamera();
  });

  // File input
  missingFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_FILE_SIZE = 1.5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      showFormMsg(missingModal, "Image too large: please choose a file under 1.5 MB.", "error");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setMissingPhoto(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  });

  // Close button
  document.getElementById("missingCloseBtn")?.addEventListener("click", () => {
    resetMissingModal();
    closeModal(missingModal);
  });

  // Submit photo button
  document.getElementById("missingSubmitBtn")?.addEventListener("click", handleMissingSubmit);

  // Backdrop click
  missingModal?.addEventListener("click", e => {
    if (e.target === missingModal) { stopMissingCamera(); closeModal(missingModal); }
  });
}

export { stopMissingCamera as stopMissingCameraExport };
