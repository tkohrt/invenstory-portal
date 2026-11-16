import { describe, expect, test } from "vitest";
import { typesWaiting, applySuggestion } from "@/lib/analysis-client";
import { EMPTY_PROFILE } from "@/lib/eligibility-fields";

describe("documents waiting for a type (patch 52)", () => {
  const docs = [
    { id: "a", title: "Zoning letter", typeTag: null, docType: null },
    { id: "b", title: "FY25 Form 990", typeTag: null, docType: "irs_990" },
    { id: "c", title: "Budget 2026", typeTag: "budget", docType: "budget" },
    { id: "d", title: "Board list", typeTag: null, docType: "board_roster" },
    { id: "e", title: "Misc notes", typeTag: null, docType: "other" },
  ];
  test("a document a person has typed is not waiting", () => {
    expect(typesWaiting(docs).map(d => d.id)).not.toContain("c");
  });
  test("one-click suggestions come first, then by title", () => {
    expect(typesWaiting(docs).map(d => d.id)).toEqual(["d", "b", "e", "a"]);
  });
  test("'other' is not a suggestion worth confirming", () => {
    expect(typesWaiting(docs).find(d => d.id === "e")?.suggested).toBeNull();
    expect(typesWaiting(docs).find(d => d.id === "b")?.suggested).toBe("irs_990");
  });
  test("nothing read, nothing waiting", () => {
    expect(typesWaiting([])).toEqual([]);
  });
});

describe("a confirmed answer reaches the form as well as the profile (patch 52)", () => {
  test("a one-value field takes the answer; a list field gains it once", () => {
    const p = { ...EMPTY_PROFILE, cause_areas: ["Education"] };
    expect(applySuggestion(p, "tax_status", "501c3").tax_status).toBe("501c3");
    expect(applySuggestion(p, "cause_areas", "Youth development").cause_areas).toEqual(["Education", "Youth development"]);
    expect(applySuggestion(p, "cause_areas", "education").cause_areas).toEqual(["Education"]);
  });
});
