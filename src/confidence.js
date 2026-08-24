/**
 * confidence.js — Evidence-quality policy for a verdict.
 *
 * Two things live here, and both are deliberately DOM-free so they can be
 * unit-tested without a browser:
 *
 *   1. How a confidence level (HIGH / MED / LOW) is normalised and described.
 *   2. Whether a verdict is backed by any ingredient evidence at all, and what
 *      caveat — if any — the user must be shown alongside it.
 *
 * Why this exists: a GREEN verdict is no longer automatically a HIGH-confidence
 * verdict. Rendering "Jain-friendly" with no visible indication that the
 * underlying evidence was thin is the fake-green failure mode this app exists
 * to avoid. Confidence therefore has to be shown as evidence quality, in its
 * own visual language, never in the red/amber/green language used for the
 * verdict itself — otherwise a green card with a red chip reads as a
 * contradiction rather than as "friendly, but poorly evidenced".
 */

/**
 * Descriptions of each confidence level.
 *
 * `level` is the number of filled segments in the strength meter (out of 3).
 * `detail` is shown on hover/focus and to screen readers — it explains what the
 * level is a statement ABOUT (the evidence), not how safe the food is.
 */
export const CONFIDENCE_META = {
  HIGH: {
    key: "HIGH",
    label: "High confidence",
    short: "High",
    level: 3,
    detail: "A full ingredient list was available and every ingredient was recognised.",
  },
  MED: {
    key: "MED",
    label: "Medium confidence",
    short: "Medium",
    level: 2,
    detail: "An ingredient list was available, but some entries could not be matched exactly.",
  },
  LOW: {
    key: "LOW",
    label: "Low confidence",
    short: "Low",
    level: 1,
    detail: "Little usable ingredient data was available, so this verdict rests on thin evidence.",
  },
};

/**
 * Normalise whatever the API sent into one of HIGH / MED / LOW, or null.
 *
 * Older rows predate the confidence field entirely and send nothing; those must
 * render as "no confidence stated" rather than as a fabricated level.
 *
 * @param {*} raw
 * @returns {"HIGH"|"MED"|"LOW"|null}
 */
export function normalizeConfidence(raw) {
  const c = String(raw ?? "").trim().toUpperCase();
  if (c === "HIGH") return "HIGH";
  if (c === "MED" || c === "MEDIUM") return "MED";
  if (c === "LOW") return "LOW";
  return null;
}

/**
 * @param {*} raw
 * @returns {object|null} entry from CONFIDENCE_META, or null when unstated.
 */
export function getConfidenceMeta(raw) {
  const key = normalizeConfidence(raw);
  return key ? CONFIDENCE_META[key] : null;
}

/**
 * True when the verdict has at least one piece of ingredient evidence behind
 * it — either raw ingredient text, or at least one categorised ingredient.
 *
 * This is the test that stops the app from drawing an ingredient breakdown made
 * entirely of empty rows. Four category headers all reading "None" look like a
 * completed check that found nothing wrong; in reality nothing was checked.
 *
 * @param {object} data verdict payload
 * @returns {boolean}
 */
export function hasIngredientEvidence(data) {
  if (!data) return false;
  if (String(data.ingredients_text ?? "").trim() !== "") return true;
  const cats = data.ingredient_categories;
  if (!cats || typeof cats !== "object") return false;
  return ["RED", "ORANGE", "YELLOW", "GREEN"].some(
    k => Array.isArray(cats[k]) && cats[k].some(v => String(v ?? "").trim() !== "")
  );
}

/**
 * The caveat to display under a verdict, or null when none is warranted.
 *
 * Ordering matters: "there was no ingredient data at all" is a stronger and more
 * specific statement than "confidence is low", so it wins. UNKNOWN never gets a
 * caveat from here — the whole card is already an explicit "we could not
 * determine this", and stacking a second warning on top of it turns an honest
 * answer into what looks like an error.
 *
 * @param {string} status normalised verdict status
 * @param {object} data verdict payload
 * @returns {{tone: "warn"|"info", text: string}|null}
 */
export function verdictCaveat(status, data) {
  if (status === "UNKNOWN") return null;

  if (!hasIngredientEvidence(data)) {
    return {
      tone: "warn",
      text: "No ingredient data was available for this product, so this verdict could not be checked against a list of ingredients. Read the packaging before deciding.",
    };
  }

  const conf = normalizeConfidence(data?.confidence);
  if (conf === "LOW") {
    return {
      tone: "warn",
      text: "Confidence is low: the ingredient data behind this verdict is thin or unclear. Treat it as a starting point and read the label.",
    };
  }
  if (conf === "MED") {
    return {
      tone: "info",
      text: "Confidence is medium: some ingredients could not be matched exactly. Check the label if this product matters to you.",
    };
  }
  return null;
}

/**
 * Why a product can come back UNKNOWN. Shown as a list inside the UNKNOWN
 * guidance panel so the state reads as a known, explained outcome rather than
 * as something having gone wrong.
 */
export const UNKNOWN_CAUSES = [
  "The ingredient list is missing from every source we check.",
  "The ingredients are listed in a form we could not read reliably.",
  "The product record is incomplete and has not been reviewed yet.",
];
