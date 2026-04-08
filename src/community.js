/**
 * community.js — Community feedback voting and badge rendering.
 *
 * Handles the "Does this look right?" feedback prompt, persists votes
 * in localStorage, and renders community verification badges.
 */

import { show, hide } from "./ui.js";
import { fetchWithTimeout, getApiBase, getClientId, reportClientEvent, REQUEST_TIMEOUT_MS, ENDPOINTS } from "./api.js";
import { getActiveProfile } from "./profile.js";

const FEEDBACK_KEY = "JAIN_FEEDBACK";

// ── Voted state persistence ─────────────────────────────────────────────────

function feedbackLoadVoted() {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "{}"); }
  catch { return {}; }
}

function feedbackMarkVoted(barcode, signal) {
  const voted = feedbackLoadVoted();
  const key = `${barcode}:${getActiveProfile()}`;
  voted[key] = signal;
  // Prune to last 200 entries
  const keys = Object.keys(voted);
  if (keys.length > 200) {
    const pruned = {};
    keys.slice(-200).forEach(k => { pruned[k] = voted[k]; });
    try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(pruned)); } catch {}
  } else {
    try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(voted)); } catch {}
  }
}

// ── Community badge rendering ───────────────────────────────────────────────

export function renderCommunityBadge(community) {
  const communityBadge = document.getElementById("communityBadge");
  if (!communityBadge) return;
  if (!community || community.total < 5) {
    hide(communityBadge);
    return;
  }
  const { total, correct, correct_pct } = community;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = correct_pct >= 70
    ? '<polyline points="20 6 9 17 4 12"/>'
    : '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
  const label = correct_pct >= 70
    ? `${correct} of ${total} users confirmed`
    : `${total - correct} of ${total} users flagged`;
  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  communityBadge.replaceChildren(svg, document.createTextNode(" "), labelSpan);
  communityBadge.className = `community-badge community-badge--${correct_pct >= 70 ? "confirmed" : "flagged"}`;
  show(communityBadge);
}

// ── Show / hide community section ───────────────────────────────────────────

export function showCommunitySection(barcode, community) {
  const communitySection = document.getElementById("communitySection");
  const feedbackPrompt = document.getElementById("feedbackPrompt");
  const feedbackThanks = document.getElementById("feedbackThanks");
  if (!communitySection) return;

  renderCommunityBadge(community);

  const voted = feedbackLoadVoted();
  const voteKey = `${barcode}:${getActiveProfile()}`;
  if (barcode && !voted[voteKey]) {
    show(feedbackPrompt);
    hide(feedbackThanks);
  } else {
    hide(feedbackPrompt);
    if (voted[voteKey]) {
      feedbackThanks.textContent = voted[voteKey] === "correct"
        ? "Thanks for confirming."
        : "Thanks for flagging \u2014 we'll review.";
      show(feedbackThanks);
    }
  }

  show(communitySection);
}

export function hideCommunitySection() {
  hide(document.getElementById("communitySection"));
  hide(document.getElementById("communityBadge"));
  hide(document.getElementById("feedbackPrompt"));
  hide(document.getElementById("feedbackThanks"));
}

// ── Submit feedback ─────────────────────────────────────────────────────────

export async function submitFeedback(barcode, signal) {
  const profile = getActiveProfile();
  const feedbackPrompt = document.getElementById("feedbackPrompt");
  const feedbackThanks = document.getElementById("feedbackThanks");

  hide(feedbackPrompt);
  feedbackMarkVoted(barcode, signal);
  feedbackThanks.textContent = signal === "correct"
    ? "Thanks for confirming."
    : "Thanks for flagging \u2014 we'll review.";
  show(feedbackThanks);

  try {
    const resp = await fetchWithTimeout(
      `${getApiBase()}${ENDPOINTS.feedback}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
        body: JSON.stringify({ barcode, profile, signal }),
      },
      REQUEST_TIMEOUT_MS,
    );
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (data.community) renderCommunityBadge(data.community);
    } else {
      feedbackThanks.textContent = "Could not save your vote. Please try again.";
      feedbackThanks.classList.add("feedback-thanks--error");
      setTimeout(() => {
        const voted = feedbackLoadVoted();
        delete voted[`${barcode}:${profile}`];
        try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(voted)); } catch {}
        hide(feedbackThanks);
        feedbackThanks.classList.remove("feedback-thanks--error");
        show(feedbackPrompt);
      }, 3000);
    }
  } catch {
    feedbackThanks.textContent = "Network error \u2014 vote not saved.";
    feedbackThanks.classList.add("feedback-thanks--error");
    setTimeout(() => {
      const voted = feedbackLoadVoted();
      delete voted[`${barcode}:${profile}`];
      try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(voted)); } catch {}
      hide(feedbackThanks);
      feedbackThanks.classList.remove("feedback-thanks--error");
      show(feedbackPrompt);
    }, 3000);
    reportClientEvent("feedback_failed", { barcode, error_msg: "network_error" });
  }
}

// ── Bind feedback buttons ───────────────────────────────────────────────────

export function bindFeedbackEvents(getCurrentBarcode) {
  document.getElementById("feedbackCorrectBtn")?.addEventListener("click", () => {
    const barcode = getCurrentBarcode();
    if (barcode) submitFeedback(barcode, "correct");
  });
  document.getElementById("feedbackIncorrectBtn")?.addEventListener("click", () => {
    const barcode = getCurrentBarcode();
    if (barcode) submitFeedback(barcode, "incorrect");
  });
}
