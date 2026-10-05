// The fair-use cap on the client's Analyze button (Phase C).
import { describe, expect, test } from "vitest";
import { decideClientRun, describeCap, pagesOf, ANALYSIS_CAP } from "@/lib/analysis-cap";

const now = new Date("2026-10-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

describe("decideClientRun", () => {
  test("nothing new to read is never a paid run", () => {
    expect(decideClientRun({ now, usage: [], pendingDocs: 0, pendingChars: 0 })).toEqual({ allowed: false, reason: "nothing_new" });
    expect(decideClientRun({ now, usage: [], pendingDocs: 0, pendingChars: 0, approvedRequest: true }).allowed).toBe(false);
  });

  test("the first press of the day is allowed", () => {
    const d = decideClientRun({ now, usage: [], pendingDocs: 2, pendingChars: 9000 });
    expect(d).toEqual({ allowed: true, pages: 3, monthPagesAfter: 3 });
  });

  test("a second press within 24 hours waits, and says when", () => {
    const d = decideClientRun({ now, usage: [{ at: hoursAgo(5), pendingChars: 3000 }], pendingDocs: 1, pendingChars: 3000 });
    expect(d.allowed).toBe(false);
    if (!d.allowed && d.reason === "daily") {
      expect(d.nextAt).toBe(new Date(now.getTime() + 19 * 3600_000).toISOString());
      expect(describeCap(d, now)).toContain("about 19 hours");
    } else throw new Error("expected the daily cap");
  });

  test("a press more than 24 hours ago does not count against today", () => {
    expect(decideClientRun({ now, usage: [{ at: hoursAgo(25), pendingChars: 3000 }], pendingDocs: 1, pendingChars: 3000 }).allowed).toBe(true);
  });

  test("the monthly page allowance counts only this calendar month", () => {
    const lastMonth = { at: "2026-09-30T23:00:00Z", pendingChars: ANALYSIS_CAP.pagesPerMonth * ANALYSIS_CAP.charsPerPage };
    expect(decideClientRun({ now, usage: [lastMonth], pendingDocs: 1, pendingChars: 3000 }).allowed).toBe(true);
    const thisMonth = { at: "2026-10-02T09:00:00Z", pendingChars: 190 * ANALYSIS_CAP.charsPerPage };
    const d = decideClientRun({ now, usage: [thisMonth], pendingDocs: 4, pendingChars: 20 * ANALYSIS_CAP.charsPerPage });
    expect(d).toEqual({ allowed: false, reason: "monthly", pages: 20, monthPagesUsed: 190 });
    expect(describeCap(d)).toContain("190 of this month's 200");
  });

  test("an approved request lets one press through the cap", () => {
    const d = decideClientRun({ now, usage: [{ at: hoursAgo(1), pendingChars: 600_000 }], pendingDocs: 3, pendingChars: 60_000, approvedRequest: true });
    expect(d.allowed).toBe(true);
  });

  test("pages round up, and an empty text is no pages", () => {
    expect(pagesOf(1)).toBe(1);
    expect(pagesOf(3000)).toBe(1);
    expect(pagesOf(3001)).toBe(2);
    expect(pagesOf(0)).toBe(0);
  });
});
