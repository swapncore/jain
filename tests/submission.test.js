/**
 * submission.test.js — Not-found → typed-ingredients → verdict path.
 *
 * The web used to dead-end at "Our team reviews submissions daily" with no
 * verdict and no way to type the ingredient list, while the phone answered the
 * same scan in seconds. This covers the request contract, the 409 CONFLICT
 * case, and the honesty requirement that a verdict computed from user-typed
 * ingredients is labelled community-submitted and unverified.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const store = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((k) => (k in store ? store[k] : null)),
  setItem: vi.fn((k, v) => { store[k] = String(v); }),
  removeItem: vi.fn((k) => { delete store[k]; }),
});
vi.stubGlobal("window", {
  location: { hostname: "jain.swapncore.com" },
  crypto: { randomUUID: () => "test-uuid-1234" },
});

import {
  buildSubmitBody, buildCommunityVerdict, looksLikeIngredientList,
  submitMissingIngredients, MIN_INGREDIENTS_CHARS,
} from "../src/submission.js";
import { ENDPOINTS } from "../src/config.js";

const BARCODE = "8901058001181";
const INGREDIENTS = "Wheat flour, sugar, palm oil, salt, raising agent (500ii)";

describe("buildSubmitBody", () => {
  it("sends exactly the five fields the backend model declares", () => {
    const body = buildSubmitBody({
      barcode: BARCODE, ingredientsText: INGREDIENTS,
      productName: "Maggi", brand: "Nestle", profile: "temple_mode",
    });
    expect(Object.keys(body).sort()).toEqual(
      ["barcode", "brand", "ingredients_text", "product_name", "profile"]
    );
    expect(body.barcode).toBe(BARCODE);
    expect(body.ingredients_text).toBe(INGREDIENTS);
    expect(body.product_name).toBe("Maggi");
    expect(body.brand).toBe("Nestle");
    expect(body.profile).toBe("temple_mode");
  });

  it("trims text fields and defaults the profile", () => {
    const body = buildSubmitBody({ barcode: BARCODE, ingredientsText: `  ${INGREDIENTS}  ` });
    expect(body.ingredients_text).toBe(INGREDIENTS);
    expect(body.product_name).toBe("");
    expect(body.brand).toBe("");
    expect(body.profile).toBe("everyday_jain");
  });
});

describe("buildCommunityVerdict — honesty labelling", () => {
  const submitResponse = {
    saved: true, barcode: BARCODE, profile: "everyday_jain",
    status: "GREEN", reasons: [], confidence: "MED",
    explain: "No Jain dietary conflicts detected.",
    ingredients_text: INGREDIENTS, ingredient_categories: { GREEN: ["sugar"] },
  };

  it("always marks the verdict community-submitted and unverified", () => {
    const v = buildCommunityVerdict(submitResponse, BARCODE);
    // These two fields are exactly what drives the
    // "Community-submitted · unverified" badge in renderResult.
    expect(v.data_source).toBe("community");
    expect(v.verified).toBe(false);
  });

  it("cannot be talked into claiming curated provenance", () => {
    const spoofed = { ...submitResponse, data_source: "curated", verified: true };
    const v = buildCommunityVerdict(spoofed, BARCODE);
    expect(v.data_source).toBe("community");
    expect(v.verified).toBe(false);
  });

  it("never shows the 'Saved for future scans' banner", () => {
    expect(buildCommunityVerdict({ ...submitResponse, saved: true }, BARCODE).saved).toBe(false);
  });

  it("carries the whole verdict payload through for rendering", () => {
    const v = buildCommunityVerdict(submitResponse, BARCODE);
    expect(v.status).toBe("GREEN");
    expect(v.confidence).toBe("MED");
    expect(v.explain).toBe("No Jain dietary conflicts detected.");
    expect(v.ingredients_text).toBe(INGREDIENTS);
    expect(v.ingredient_categories).toEqual({ GREEN: ["sugar"] });
  });

  it("falls back to the requested barcode when the response omits one", () => {
    expect(buildCommunityVerdict({ status: "RED" }, BARCODE).barcode).toBe(BARCODE);
    expect(buildCommunityVerdict(null, BARCODE).barcode).toBe(BARCODE);
  });
});

describe("looksLikeIngredientList", () => {
  it("accepts a real ingredient list", () => {
    expect(looksLikeIngredientList(INGREDIENTS)).toBe(true);
  });

  it("rejects a short or unseparated blob", () => {
    expect(looksLikeIngredientList("chocolate")).toBe(false);
    expect(looksLikeIngredientList("this is a sentence with no separators at all")).toBe(false);
    expect(looksLikeIngredientList("")).toBe(false);
    expect(looksLikeIngredientList(null)).toBe(false);
  });

  it("is only a soft signal — the minimum length gate is separate", () => {
    expect(MIN_INGREDIENTS_CHARS).toBe(5);
  });
});

describe("submitMissingIngredients", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    Object.keys(store).forEach((k) => delete store[k]);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  function stubFetch(status, payload, ok = status >= 200 && status < 300) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok, status, json: () => Promise.resolve(payload),
    });
  }

  it("POSTs JSON to /v1/submit_missing with the client id header", async () => {
    stubFetch(200, { saved: true, status: "GREEN", barcode: BARCODE });
    await submitMissingIngredients({ barcode: BARCODE, ingredientsText: INGREDIENTS });

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain(ENDPOINTS.submit_missing);
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers["X-Client-Id"]).toBeTruthy();
    expect(opts.headers.Authorization).toBeUndefined();
    expect(JSON.parse(opts.body).ingredients_text).toBe(INGREDIENTS);
  });

  it("attaches a bearer token when the user is signed in", async () => {
    stubFetch(200, { saved: true });
    await submitMissingIngredients({
      barcode: BARCODE, ingredientsText: INGREDIENTS, accessToken: "tok-123",
    });
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer tok-123");
  });

  it("returns the verdict payload on success", async () => {
    stubFetch(200, { saved: true, status: "RED", reasons: ["GELATIN"], confidence: "HIGH" });
    const { ok, status, data } = await submitMissingIngredients({
      barcode: BARCODE, ingredientsText: INGREDIENTS,
    });
    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data.status).toBe("RED");
    // …and that payload becomes an explicitly unverified verdict.
    expect(buildCommunityVerdict(data, BARCODE).verified).toBe(false);
  });

  it("surfaces 409 CONFLICT as a status, not an error", async () => {
    stubFetch(409, { error: "CONFLICT", message: "A product with this barcode already exists." });
    const { ok, status, data } = await submitMissingIngredients({
      barcode: BARCODE, ingredientsText: INGREDIENTS,
    });
    // The caller re-fetches GET /v1/verdict rather than showing an error.
    expect(ok).toBe(false);
    expect(status).toBe(409);
    expect(data.error).toBe("CONFLICT");
  });

  it("surfaces a 429 rate limit for the caller to message", async () => {
    stubFetch(429, { error: "RATE_LIMIT", message: "Too many submissions." });
    const { ok, status } = await submitMissingIngredients({
      barcode: BARCODE, ingredientsText: INGREDIENTS,
    });
    expect(ok).toBe(false);
    expect(status).toBe(429);
  });

  it("tolerates a non-JSON error body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503, json: () => Promise.reject(new Error("not json")),
    });
    const { status, data } = await submitMissingIngredients({
      barcode: BARCODE, ingredientsText: INGREDIENTS,
    });
    expect(status).toBe(503);
    expect(data).toEqual({});
  });

  it("propagates network failures to the caller", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    await expect(
      submitMissingIngredients({ barcode: BARCODE, ingredientsText: INGREDIENTS })
    ).rejects.toThrow("Network error");
  });
});
