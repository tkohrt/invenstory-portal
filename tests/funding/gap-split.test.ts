import { describe, expect, test } from "vitest";
import { splitGaps, analysisAgeDays, ANALYSIS_STALE_DAYS, type Gap } from "@/lib/eligibility-fields";

const g = (key: string, tier: Gap["tier"], fix: Gap["fix"]): Gap => ({ key, tier, label: key, fix });

describe("what's missing, in two lists (patch 50)", () => {
  test("a complete profile with document gaps has nothing in the profile list: CurioLab, 15 November 2026", () => {
    const r = splitGaps([g("need", "essential", "upload"), g("outcomes", "essential", "upload"), g("irs_990", "essential", "upload"), g("determination", "essential", "upload"), g("board_roster", "important", "upload")]);
    expect(r.profile).toEqual([]);
    expect(r.documents.map(x => x.key)).toEqual(["need", "outcomes", "irs_990", "determination", "board_roster"]);
  });
  test("profile answers and documents are kept apart, each most serious first", () => {
    const r = splitGaps([g("annual_report", "enriching", "upload"), g("budget_band", "important", "profile"), g("irs_990", "essential", "upload"), g("org_type", "critical", "profile")]);
    expect(r.profile.map(x => x.key)).toEqual(["org_type", "budget_band"]);
    expect(r.documents.map(x => x.key)).toEqual(["irs_990", "annual_report"]);
  });
});

describe("how old the document analysis is", () => {
  const now = new Date("2026-11-15T21:00:00Z");
  test("counts whole days", () => {
    expect(analysisAgeDays("2026-08-24T20:02:12Z", now)).toBe(83);
    expect(analysisAgeDays("2026-11-15T09:00:00Z", now)).toBe(0);
  });
  test("August's analysis is past the point where the page says so", () => {
    expect(analysisAgeDays("2026-08-24T20:02:12Z", now)!).toBeGreaterThanOrEqual(ANALYSIS_STALE_DAYS);
  });
  test("never analyzed, or an unreadable date, is no age at all", () => {
    expect(analysisAgeDays(null, now)).toBeNull();
    expect(analysisAgeDays("soon", now)).toBeNull();
  });
});
