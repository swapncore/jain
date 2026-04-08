/**
 * profile.js — Profile/mode selector, persistence, and UI rendering.
 *
 * Manages the strictness mode pills (Everyday, Temple, Paryushan, Greens+)
 * and persists the active profile to localStorage.
 */

import { PROFILES, PROFILE_DEFAULT, PROFILE_KEY } from "./config.js";

// ── Active profile management ───────────────────────────────────────────────

export function getActiveProfile() {
  const stored = localStorage.getItem(PROFILE_KEY);
  return PROFILES.some(p => p.id === stored) ? stored : PROFILE_DEFAULT;
}

export function setActiveProfile(profileId) {
  if (!PROFILES.some(p => p.id === profileId)) return;
  localStorage.setItem(PROFILE_KEY, profileId);
  // Update pill UI
  document.querySelectorAll(".mode-pill").forEach(btn => {
    const active = btn.dataset.profile === profileId;
    btn.classList.toggle("mode-pill--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

// ── Profile selector initialization ─────────────────────────────────────────

/**
 * Initialize the mode selector bar with profile pills.
 * @param {Object} opts
 * @param {Function} opts.onProfileChange - callback(newProfileId, prevProfileId)
 */
export function initProfileSelector({ onProfileChange } = {}) {
  const bar = document.getElementById("modeBar");
  if (!bar) return;

  // Label
  const lbl = document.createElement("span");
  lbl.className = "mode-bar-label";
  lbl.textContent = "Mode:";
  bar.appendChild(lbl);

  const current = getActiveProfile();
  PROFILES.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-pill";
    btn.dataset.profile = p.id;
    btn.textContent = p.label;
    btn.title = p.desc;
    const active = p.id === current;
    btn.classList.toggle("mode-pill--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.addEventListener("click", () => {
      const prev = getActiveProfile();
      setActiveProfile(p.id);
      if (prev !== p.id && onProfileChange) {
        onProfileChange(p.id, prev);
      }
    });
    bar.appendChild(btn);
  });

  // "?" help link → modes.html
  const help = document.createElement("a");
  help.className = "mode-help-btn";
  help.href = "./modes.html";
  help.textContent = "?";
  help.setAttribute("aria-label", "Learn what each mode means");
  help.title = "What do these modes mean?";
  bar.appendChild(help);
}

// Re-export for convenience
export { PROFILES, PROFILE_DEFAULT };
