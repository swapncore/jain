/**
 * Share utilities — verdict card image generation and sharing.
 */
import { PROFILE_DEFAULT } from "../config/shared-config.js";

// ─── Status colors for canvas rendering ──────────────────────────────────────
const STATUS_COLORS = {
  GREEN:   { bg: "#f0fdf4", border: "#22c55e", text: "#166534", icon: "\u2713" },
  YELLOW:  { bg: "#fefce8", border: "#eab308", text: "#854d0e", icon: "\u25D0" },
  ORANGE:  { bg: "#fff7ed", border: "#f97316", text: "#9a3412", icon: "?" },
  RED:     { bg: "#fef2f2", border: "#ef4444", text: "#991b1b", icon: "\u2715" },
  UNKNOWN: { bg: "#f9fafb", border: "#9ca3af", text: "#374151", icon: "\u2014" },
};

export function getShareUrl(barcode, profileId) {
  const base = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({ b: barcode });
  if (profileId && profileId !== PROFILE_DEFAULT) params.set("p", profileId);
  return `${base}?${params}`;
}

export function buildVerdictImage(barcode, status, productName, brand, reasons, statusMeta) {
  const W = 600, H = 340;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const col = STATUS_COLORS[status] || STATUS_COLORS.UNKNOWN;
  const label = statusMeta[status]?.label ?? status;

  // Background
  ctx.fillStyle = col.bg;
  ctx.fillRect(0, 0, W, H);

  // Left accent bar
  ctx.fillStyle = col.border;
  ctx.fillRect(0, 0, 8, H);

  // Brand strip top-right
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("jaini", W - 28, 38);
  ctx.fillStyle = "#666";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText("jain.swapncore.com", W - 28, 56);

  // Big status icon
  ctx.fillStyle = col.border;
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(col.icon, 30, 100);

  // Status label
  ctx.fillStyle = col.text;
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.fillText(label, 30, 148);

  // Product name (truncate if needed)
  const maxNameW = W - 60;
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 20px system-ui, sans-serif";
  let displayName = productName || "Unknown product";
  while (displayName.length > 4 && ctx.measureText(displayName).width > maxNameW) {
    displayName = displayName.slice(0, -1);
  }
  if (displayName !== (productName || "Unknown product")) displayName += "\u2026";
  ctx.fillText(displayName, 30, 188);

  // Brand
  if (brand) {
    ctx.fillStyle = "#555";
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillText(brand, 30, 212);
  }

  // Reason chips
  if (reasons && reasons.length) {
    const chipY = brand ? 238 : 224;
    ctx.font = "13px system-ui, sans-serif";
    let x = 30;
    reasons.slice(0, 5).forEach(r => {
      const chipLabel = r.replace(/_/g, " ").toLowerCase();
      const tw = ctx.measureText(chipLabel).width + 20;
      if (x + tw > W - 30) return;
      ctx.fillStyle = col.border + "30";
      ctx.strokeStyle = col.border;
      ctx.lineWidth = 1;
      const rx = x, ry = chipY - 16, rw = tw, rh = 22;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(rx, ry, rw, rh, 11);
      } else {
        ctx.moveTo(rx + 11, ry);
        ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, 11);
        ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, 11);
        ctx.arcTo(rx, ry + rh, rx, ry, 11);
        ctx.arcTo(rx, ry, rx + rw, ry, 11);
        ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.text;
      ctx.fillText(chipLabel, rx + 10, chipY);
      x += tw + 8;
    });
  }

  // Barcode at bottom
  ctx.fillStyle = "#999";
  ctx.font = "12px monospace, system-ui";
  ctx.fillText(barcode, 30, H - 18);

  // Divider line
  ctx.strokeStyle = col.border + "40";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, H - 34); ctx.lineTo(W - 30, H - 34);
  ctx.stroke();

  return c;
}

export async function handleShare(barcode, status, productName, brand, reasons, { statusMeta, profileId, onToast }) {
  const url     = getShareUrl(barcode, profileId);
  const verdict = statusMeta[status]?.label ?? "Unknown";
  const title   = `Jaini: ${productName ? productName + " \u2014 " : ""}${verdict}`;
  const text    = `${productName ? productName + " \u2014 " : ""}${verdict} (Jaini Jain dietary check)`;

  // Try to share as image first (modern browsers + mobile)
  if (navigator.share && navigator.canShare) {
    try {
      const canvas = buildVerdictImage(barcode, status, productName, brand, reasons, statusMeta);
      const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
      const file = new File([blob], "jaini-verdict.png", { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title, text, url, files: [file] });
        return;
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }

  // Fallback: share URL only
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }

  // Last resort: copy URL to clipboard
  try {
    await navigator.clipboard.writeText(url);
    onToast("Link copied to clipboard");
  } catch {
    onToast("Share: " + url, 8000);
  }
}

export function timeAgo(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const diffMs  = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH   = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  const diffD   = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}
