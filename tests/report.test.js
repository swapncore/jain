/**
 * report.test.js — Detailed misclassification report body contract.
 *
 * The backend's ClassificationReportRequest is strict about field names, and
 * `what_wrong` is required (1..2000). Anything else is a 422 the user never
 * sees a useful message for.
 */

import { describe, it, expect, vi } from "vitest";

vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});
vi.stubGlobal("window", {
  location: { hostname: "jain.swapncore.com" },
  crypto: { randomUUID: () => "test-uuid-1234" },
});

import { buildReportBody } from "../src/report.js";
import { WEB_ENDPOINTS } from "../src/config.js";

describe("WEB_ENDPOINTS", () => {
  it("declares the endpoints the generated shared config omits", () => {
    expect(WEB_ENDPOINTS.report_classification).toBe("/v1/report-classification");
    expect(WEB_ENDPOINTS.account).toBe("/v1/account");
  });
});

describe("buildReportBody", () => {
  it("uses the exact field names the backend model declares", () => {
    const body = buildReportBody({
      barcode: "5000159459228",
      profile: "temple_mode",
      whatWrong: "Marked GREEN but contains gelatin.",
      corrected: "Sugar, gelatin, water",
      email: "reporter@example.com",
    });
    expect(Object.keys(body).sort()).toEqual(
      ["barcode", "corrected_ingredients", "profile", "reporter_email", "what_wrong"]
    );
    expect(body.what_wrong).toBe("Marked GREEN but contains gelatin.");
    expect(body.corrected_ingredients).toBe("Sugar, gelatin, water");
    expect(body.reporter_email).toBe("reporter@example.com");
    expect(body.profile).toBe("temple_mode");
  });

  it("always sends the optional fields as empty strings, never undefined", () => {
    const body = buildReportBody({ barcode: "1", whatWrong: "wrong" });
    expect(body.corrected_ingredients).toBe("");
    expect(body.reporter_email).toBe("");
    expect(body.profile).toBe("everyday_jain");
  });

  it("trims user text", () => {
    const body = buildReportBody({
      barcode: "1", whatWrong: "  wrong  ", corrected: "  a, b  ", email: " me@x.com ",
    });
    expect(body.what_wrong).toBe("wrong");
    expect(body.corrected_ingredients).toBe("a, b");
    expect(body.reporter_email).toBe("me@x.com");
  });

  it("coerces every field to a string", () => {
    const body = buildReportBody({ barcode: 12345678, whatWrong: "x", corrected: null, email: undefined });
    expect(typeof body.barcode).toBe("string");
    expect(typeof body.corrected_ingredients).toBe("string");
    expect(typeof body.reporter_email).toBe("string");
  });
});
