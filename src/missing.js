/**
 * missing.js — Missing product form and photo submission.
 *
 * Manages the "Report missing product" modal flow: camera capture,
 * file upload, preview, and submission to the backend.
 */

import { show, hide, openModal, closeModal, showFormMsg, clearFormMsg } from "./ui.js";
import { fetchWithTimeout, getApiBase, getClientId, reportClientEvent } from "./api.js";
import * as Auth from "../auth.js";

let _missingStream = null;
let _missingPhotoData = null;

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
  if (missingSubmitLabel) missingSubmitLabel.textContent = "Submitting\u2026";
  showFormMsg(missingModal, "Submitting photo\u2026", "info");

  try {
    const resp = await fetchWithTimeout(
      `${getApiBase()}/v1/submit_missing_photo`,
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
      15000,
    );
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      showFormMsg(missingModal, "Thank you for uploading! Our team reviews submissions daily and will add this product to the database.", "success");
      setTimeout(() => closeModal(missingModal), 2500);
    } else {
      const msg = data.message || "Submission failed. Please try again.";
      showFormMsg(missingModal, msg, "error");
      missingSubmitBtn.disabled = false;
      if (missingSubmitLabel) missingSubmitLabel.textContent = "Submit Photo";
      reportClientEvent("submission_failed", { error_msg: msg });
    }
  } catch (err) {
    const msg = "Network error \u2014 please check your connection and try again.";
    showFormMsg(missingModal, msg, "error");
    missingSubmitBtn.disabled = false;
    if (missingSubmitLabel) missingSubmitLabel.textContent = "Submit Photo";
    reportClientEvent("submission_failed", { error_msg: err?.message || "network" });
  }
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

  // Report missing button
  document.getElementById("reportMissingBtn")?.addEventListener("click", () => {
    const bc = getCurrentBarcode();
    if (missingBarcode) missingBarcode.value = bc;
    if (missingBarcodeDisplay) missingBarcodeDisplay.textContent = bc;
    if (missingName) missingName.value = "";
    _missingPhotoData = null;
    hide(missingPreview);
    show(missingCaptureControls);
    hide(missingReviewControls);
    clearFormMsg(missingModal);
    startMissingCamera();
    openModal(missingModal);
  });

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
      showFormMsg(missingModal, "Image too large \u2014 please choose a file under 1.5 MB.", "error");
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
    stopMissingCamera();
    _missingPhotoData = null;
    hide(missingPreview);
    show(missingCaptureControls);
    hide(missingReviewControls);
    clearFormMsg(missingModal);
    closeModal(missingModal);
  });

  // Submit button
  document.getElementById("missingSubmitBtn")?.addEventListener("click", handleMissingSubmit);

  // Backdrop click
  missingModal?.addEventListener("click", e => {
    if (e.target === missingModal) { stopMissingCamera(); closeModal(missingModal); }
  });
}

export { stopMissingCamera as stopMissingCameraExport };
