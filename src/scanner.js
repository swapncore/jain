/**
 * scanner.js — Camera initialization, barcode scanning, and torch control.
 *
 * BARCODE SCANNER FALLBACK CHAIN
 * ==============================
 * The scanner uses a 3-layer fallback strategy to maximize compatibility:
 *
 * 1. Native BarcodeDetector API (iOS Safari/Chrome via WebKit)
 *    - Used when: Browser natively supports BarcodeDetector (iOS 15.4+)
 *    - Skipped on: Android (unreliable detection on many devices)
 *    - Pros: Fast, no external libs, works directly with video element
 *    - Cons: Limited browser support, Android implementation is buggy
 *
 * 2. ZXing library (manual canvas decode loop)
 *    - Used when: Native BarcodeDetector is unavailable or skipped
 *    - Also used: Android (all versions), older iOS, desktop browsers
 *    - Pros: Reliable, supports TRY_HARDER mode, works everywhere
 *    - Cons: Requires external library (~200KB), slightly slower
 *    - On mobile: Uses manual canvas loop (drawImage + decode) for reliability
 *    - On desktop: Uses decodeFromConstraints (ZXing manages stream)
 *
 * 3. Manual entry (text input)
 *    - Used when: Camera permission denied, no camera available, or user preference
 *    - Always available as fallback alongside camera scanning
 *    - Pros: Works on all devices, no permissions needed
 *    - Cons: Requires user to type/paste barcode digits
 *
 * KNOWN LIMITATIONS:
 * - Chrome WKWebView on iOS may report videoWidth/Height as 0; we fall back
 *   to track.getSettings() dimensions
 * - BarcodeDetector polyfill (WASM) may fail on older iOS due to CSP
 *   wasm-unsafe-eval restrictions
 * - ZXing decodeFromConstraints silently breaks on iOS Safari; we use
 *   manual canvas loop instead on all mobile devices
 * - UPC-E (8-digit) barcodes require BarcodeDetector or ZXing UPC_E format
 */

import { show, hide } from "./ui.js";
import { reportClientEvent } from "./api.js";
import { MESSAGES } from "./config.js";
import { normalizeBarcode } from "../barcode.js";

// Barcode libraries are lazy-loaded on first camera use
let _BrowserMultiFormatReader = null;
let _DecodeHintType = null;
let _BarcodeFormat = null;
let _BarcodeDetectorPolyfill = null;
let _barcodeLibsLoading = null;
let SCAN_FORMATS = null;

async function _loadBarcodeLibs() {
  if (_barcodeLibsLoading) return _barcodeLibsLoading;
  _barcodeLibsLoading = (async () => {
    const [zxingBrowser, zxingLib] = await Promise.all([
      import("https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm"),
      import("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/+esm"),
    ]);
    _BrowserMultiFormatReader = zxingBrowser.BrowserMultiFormatReader;
    _DecodeHintType = zxingLib.DecodeHintType;
    _BarcodeFormat = zxingLib.BarcodeFormat;

    try {
      const barcodeDetMod = await import("https://cdn.jsdelivr.net/npm/barcode-detector@2/+esm");
      _BarcodeDetectorPolyfill = barcodeDetMod.BarcodeDetector;
    } catch {
      _BarcodeDetectorPolyfill = null;
    }
  })();
  _barcodeLibsLoading.catch(() => { _barcodeLibsLoading = null; });
  return _barcodeLibsLoading;
}

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

function _getDetectorImpl() {
  if (typeof globalThis.BarcodeDetector !== "undefined") return globalThis.BarcodeDetector;
  return _BarcodeDetectorPolyfill;
}

// ── Scanner state ───────────────────────────────────────────────────────────

const scanState = {
  reader: null,
  controls: null,
  torchOn: false,
  _nativeDetector: null,
  _nativeScanStop: null,
};

// ── Torch control ───────────────────────────────────────────────────────────

function getActiveTrack() {
  const video = document.getElementById("videoPreview");
  return video?.srcObject?.getVideoTracks?.()[0] ?? null;
}

async function setupTorch() {
  const torchBtn = document.getElementById("torchBtn");
  const track = getActiveTrack();
  if (!track) return;
  const caps = track.getCapabilities?.();
  if (!caps?.torch) return;
  show(torchBtn);
  scanState.torchOn = false;
}

async function applyTorch(on) {
  const torchBtn = document.getElementById("torchBtn");
  const track = getActiveTrack();
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    scanState.torchOn = on;
    torchBtn.classList.toggle("torch-on", on);
  } catch {
    hide(torchBtn);
  }
}

function resetTorch() {
  const torchBtn = document.getElementById("torchBtn");
  scanState.torchOn = false;
  hide(torchBtn);
  torchBtn?.classList.remove("torch-on");
}

// ── Barcode decode callback ─────────────────────────────────────────────────

/**
 * Map a decoder's format value to a symbology hint string that
 * normalizeBarcode understands. BarcodeDetector reports a string
 * ("ean_8", "upc_e", …); ZXing reports a BarcodeFormat enum value.
 */
function _symbologyHint(format) {
  if (format == null) return null;
  if (typeof format === "string") return format;
  if (_BarcodeFormat && format === _BarcodeFormat.EAN_8) return "ean_8";
  return null;
}

function createOnDecodedText(appState, fetchVerdictFn, renderErrorFn) {
  return function onDecodedText(text, format) {
    if (appState.scanLocked || appState.inFlight) return;
    // Pass the decoder's symbology so a genuine EAN-8 is not mis-expanded as UPC-E.
    const normalized = normalizeBarcode(text, _symbologyHint(format));
    const digits = normalized.upc12 || normalized.ean13 || normalized.cleaned;
    if (digits.length !== 8 && digits.length !== 12 && digits.length !== 13) return;

    const now = Date.now();
    if (digits === appState.lastBarcode && now - appState.lastScanAt < 1200) return;

    if (digits !== appState.pendingBarcode) {
      appState.pendingBarcode = digits;
      appState.pendingCount = 1;
      const scanStatus = document.getElementById("scanStatus");
      if (scanStatus) scanStatus.textContent = `Detected ${digits}... confirming`;
      return;
    }
    appState.pendingCount++;
    if (appState.pendingCount < 2) return;

    appState.pendingBarcode = "";
    appState.pendingCount = 0;
    appState.lastBarcode = digits;
    appState.lastScanAt = now;
    appState.scanLocked = true;

    const scanStatus = document.getElementById("scanStatus");
    if (scanStatus) scanStatus.textContent = `Barcode ${digits} confirmed. Looking up...`;
    fetchVerdictFn(digits).catch(() => renderErrorFn(MESSAGES.network));
  };
}

// ── Native BarcodeDetector scanning ─────────────────────────────────────────

async function startNativeScanning(stream, onDecodedText) {
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid) return false;

  const DetectorImpl = _getDetectorImpl();
  if (!DetectorImpl) return false;

  let supported;
  try { supported = await DetectorImpl.getSupportedFormats(); }
  catch { return false; }
  const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
  if (!formats.length) return false;

  const video = document.getElementById("videoPreview");
  const detector = new DetectorImpl({ formats });
  scanState._nativeDetector = detector;

  video.srcObject = stream;
  await video.play();

  let running = true;
  scanState._nativeScanStop = () => { running = false; };

  const SCAN_INTERVAL_MS = 60;
  const tick = async () => {
    if (!running) return;
    try {
      const barcodes = await detector.detect(video);
      for (const bc of barcodes) {
        onDecodedText(bc.rawValue, bc.format);
      }
    } catch { /* frame not ready */ }
    if (running) setTimeout(tick, SCAN_INTERVAL_MS);
  };
  setTimeout(tick, SCAN_INTERVAL_MS);
  return true;
}

// ── Video frame readiness ───────────────────────────────────────────────────

/**
 * Wait until the video element has actual frame dimensions (not just
 * readyState >= 2). Chrome iOS WKWebView is known to report HAVE_CURRENT_DATA
 * before videoWidth/videoHeight become non-zero, which causes the decode loop
 * to feed empty canvases to ZXing.
 */
async function _waitForVideoFrame(video, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      return true;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ── ZXing canvas decode loop (extracted into a helper so the watchdog can
//    invoke it as a fallback when the BarcodeDetector polyfill silently
//    fails on certain iOS browsers) ────────────────────────────────────────

function _startZxingCanvasLoop({ stream, video, onDecodedText, scanStatus, isWKWebViewIOS }) {
  const hints = new Map();
  hints.set(_DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
  hints.set(_DecodeHintType.TRY_HARDER, true);
  scanState.reader = new _BrowserMultiFormatReader(hints, 50);

  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() || {};
  const trackW = settings.width || 0;
  const trackH = settings.height || 0;

  // On Chrome iOS / Firefox iOS (WKWebView) we attach the working canvas to
  // the DOM (visually hidden) because off-DOM canvas drawImage from <video>
  // is unreliable in WKWebView. On other browsers a detached canvas is fine
  // and avoids polluting the DOM.
  let aCanvas;
  if (isWKWebViewIOS) {
    aCanvas = document.getElementById("__scanCanvas");
    if (!aCanvas) {
      aCanvas = document.createElement("canvas");
      aCanvas.id = "__scanCanvas";
      // Visually hidden but still painted by the rendering engine so
      // drawImage(video) actually captures frames.
      aCanvas.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(aCanvas);
    }
  } else {
    aCanvas = document.createElement("canvas");
  }
  const aCtx = aCanvas.getContext("2d", { willReadFrequently: true });
  let running = true;

  scanState._nativeScanStop = () => {
    running = false;
    try { stream.getTracks().forEach(t => t.stop()); } catch {}
    video.srcObject = null;
  };

  const FRAME_MS = isWKWebViewIOS ? 100 : 60;
  const tick = () => {
    if (!running) return;
    try {
      const vw = video.videoWidth || trackW || 0;
      const vh = video.videoHeight || trackH || 0;
      if (video.readyState >= 2 && vw > 0 && vh > 0) {
        if (aCanvas.width !== vw) { aCanvas.width = vw; aCanvas.height = vh; }
        aCtx.drawImage(video, 0, 0, vw, vh);
        const result = scanState.reader.decodeFromCanvas(aCanvas);
        if (result) onDecodedText(result.getText(), result.getBarcodeFormat());
      }
    } catch { /* NotFoundException — barcode not in this frame */ }
    if (running) {
      // On WKWebView iOS, requestAnimationFrame can be paused unexpectedly,
      // so use plain setTimeout for reliability. On other platforms RAF is
      // preferable for vsync alignment.
      if (isWKWebViewIOS) {
        setTimeout(tick, FRAME_MS);
      } else {
        requestAnimationFrame(() => setTimeout(tick, FRAME_MS));
      }
    }
  };
  // Give the camera a moment to deliver real frames before the first decode.
  setTimeout(tick, isWKWebViewIOS ? 600 : 250);

  if (scanStatus) scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
}

// ── Camera device selection ─────────────────────────────────────────────────

async function pickBackCamera() {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const vids = devs.filter(d => d.kind === "videoinput");
    const back = vids.find(d => /back|rear|environment/i.test(d.label || ""));
    return back?.deviceId || null;
  } catch { return null; }
}

// ── Start scanning ──────────────────────────────────────────────────────────

export async function startScanning(appState, fetchVerdictFn, renderErrorFn, showMessageFn) {
  if (scanState.controls || scanState._nativeScanStop) return;

  const video = document.getElementById("videoPreview");
  const cameraArea = document.getElementById("cameraArea");
  const cameraBlockedMsg = document.getElementById("cameraBlockedMsg");
  const scanTriggerArea = document.getElementById("scanTriggerArea");
  const newScanBtn = document.getElementById("newScanBtn");
  const scanStatus = document.getElementById("scanStatus");

  const onDecodedText = createOnDecodedText(appState, fetchVerdictFn, renderErrorFn);

  try {
    await _loadBarcodeLibs();
    if (!SCAN_FORMATS) {
      SCAN_FORMATS = [_BarcodeFormat.EAN_13, _BarcodeFormat.EAN_8, _BarcodeFormat.UPC_A, _BarcodeFormat.UPC_E];
    }
  } catch (e) {
    console.error("Failed to load barcode scanning libraries", e);
    showMessageFn({ variant: "error", message: MESSAGES.cameraUnsupported });
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    hide(cameraArea);
    show(cameraBlockedMsg);
    reportClientEvent("camera_error", { error_msg: "permission_denied" });
    return;
  }

  hide(cameraBlockedMsg);
  hide(newScanBtn);
  show(cameraArea);
  hide(scanTriggerArea);
  appState.scanLocked = false;

  try {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isMobile = isIOS || /Mobi|Android/i.test(navigator.userAgent);
    const idealW = isMobile ? 1280 : 1920;
    const idealH = isMobile ? 720 : 1080;

    const deviceId = await pickBackCamera();

    const videoConstraints = isIOS
      ? (deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: idealW, min: 640 }, height: { ideal: idealH, min: 480 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: idealW, min: 640 }, height: { ideal: idealH, min: 480 } })
      : (deviceId
          ? { deviceId: { exact: deviceId }, focusMode: { ideal: "continuous" }, width: { ideal: idealW, min: 640 }, height: { ideal: idealH, min: 480 } }
          : { facingMode: { ideal: "environment" }, focusMode: { ideal: "continuous" }, width: { ideal: idealW, min: 640 }, height: { ideal: idealH, min: 480 } });

    // ── Mobile (iOS + Android) ─────────────────────────────────────────────
    if (isMobile) {
      const isChromeIOS = /CriOS/i.test(navigator.userAgent);
      const isFirefoxIOS = /FxiOS/i.test(navigator.userAgent);
      // Non-Safari iOS browsers (Chrome/Firefox) use WKWebView, where the
      // BarcodeDetector polyfill's internal off-DOM canvas frame capture is
      // unreliable. We skip the polyfill on those browsers entirely and go
      // straight to the ZXing canvas loop with a DOM-attached canvas.
      const isWKWebViewIOS = isIOS && (isChromeIOS || isFirefoxIOS);

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
      }

      video.srcObject = stream;
      video.setAttribute("playsinline", "");
      video.muted = true;
      await video.play();

      // Wait for the video to actually have frame dimensions. On Chrome iOS
      // WKWebView, video.readyState can reach HAVE_CURRENT_DATA before
      // videoWidth/videoHeight become non-zero, which causes the decode loop
      // to feed empty canvases. We poll for up to ~3s.
      await _waitForVideoFrame(video, 3000);

      // ── iOS Safari only: try BarcodeDetector polyfill first ──
      // On Safari iOS this path works well; on Chrome/Firefox iOS we skip it
      // because the polyfill's internal canvas can't reliably read video
      // frames inside WKWebView.
      if (isIOS && !isWKWebViewIOS) {
        const DetectorImpl = _getDetectorImpl();
        if (DetectorImpl) {
          try {
            const supported = await DetectorImpl.getSupportedFormats();
            const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
            if (formats.length) {
              const detector = new DetectorImpl({ formats });
              scanState._nativeDetector = detector;
              let running = true;
              let lastDecodeAttempts = 0;
              let nativeWatchdogFired = false;
              scanState._nativeScanStop = () => {
                running = false;
                stream.getTracks().forEach(t => t.stop());
                video.srcObject = null;
              };
              const tick = async () => {
                if (!running) return;
                try {
                  const barcodes = await detector.detect(video);
                  lastDecodeAttempts++;
                  for (const bc of barcodes) onDecodedText(bc.rawValue, bc.format);
                } catch { /* frame not ready */ }
                if (running) setTimeout(tick, 60);
              };
              setTimeout(tick, 300);

              // Watchdog: if the polyfill produces no decoded barcodes after
              // ~6s of attempts AND no manual entry has happened, fall back
              // to the ZXing canvas loop. This catches the "polyfill loaded
              // but silently fails" case on certain iOS versions.
              setTimeout(() => {
                if (!running || nativeWatchdogFired) return;
                if (appState.lastBarcode) return; // already decoded something
                if (lastDecodeAttempts === 0) return; // never even attempted
                nativeWatchdogFired = true;
                console.warn("BarcodeDetector polyfill produced no decodes in 6s — falling back to ZXing");
                running = false;
                _startZxingCanvasLoop({
                  stream, video, onDecodedText, scanStatus,
                  isWKWebViewIOS: false, isMobile: true,
                });
              }, 6000);

              await setupTorch();
              scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
              return;
            }
          } catch { /* native unavailable */ }
        }
      }

      // ── ZXing manual canvas decode loop (Android, Chrome iOS, Firefox iOS, fallback) ──
      _startZxingCanvasLoop({
        stream, video, onDecodedText, scanStatus,
        isWKWebViewIOS, isMobile: true,
      });
      await setupTorch();
      scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
      return;
    }

    // ── Desktop: native BarcodeDetector then ZXing fallback ─────────────────
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
      const ok = await startNativeScanning(stream, onDecodedText);
      if (ok) {
        await setupTorch();
        scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
        return;
      }
      stream.getTracks().forEach(t => t.stop());
    } catch { /* fall through to ZXing */ }

    // ZXing decodeFromConstraints fallback (desktop)
    const hints = new Map();
    hints.set(_DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS);
    hints.set(_DecodeHintType.TRY_HARDER, true);
    scanState.reader = new _BrowserMultiFormatReader(hints, 50);
    const onResult = (r) => { if (r) onDecodedText(r.getText(), r.getBarcodeFormat()); };
    try {
      scanState.controls = await scanState.reader.decodeFromConstraints(
        { audio: false, video: videoConstraints }, video, onResult);
    } catch {
      scanState.controls = await scanState.reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } }, video, onResult);
    }

    await setupTorch();
    scanStatus.textContent = "Scanner is live. Point the barcode within the guide.";
  } catch (err) {
    hide(cameraArea);
    show(cameraBlockedMsg);
    show(scanTriggerArea);
    show(newScanBtn);
    scanStatus.textContent = "Camera access needed.";
    reportClientEvent("camera_error", { error_msg: err?.message || "unknown" });
  }
}

// ── Stop scanning ───────────────────────────────────────────────────────────

export function stopScanning(appState) {
  const video = document.getElementById("videoPreview");
  appState.pendingBarcode = "";
  appState.pendingCount = 0;
  resetTorch();
  if (scanState._nativeScanStop) { scanState._nativeScanStop(); scanState._nativeScanStop = null; }
  if (video?.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  try { if (scanState.controls) { scanState.controls.stop(); scanState.controls = null; } } catch { scanState.controls = null; }
  try { if (scanState.reader) { scanState.reader.reset(); scanState.reader = null; } } catch { scanState.reader = null; }
}

// ── Torch toggle binding ────────────────────────────────────────────────────

export function bindTorchEvent() {
  document.getElementById("torchBtn")?.addEventListener("click", () => applyTorch(!scanState.torchOn));
}

// ── Pre-warm barcode libs ───────────────────────────────────────────────────

export function preWarmBarcodeLibs() {
  _loadBarcodeLibs().catch(() => {});
}
