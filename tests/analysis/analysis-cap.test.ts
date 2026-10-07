// The client's Analyze button (Phase C). Phase D counts its spend toward the allowance and never stops it.
import { describe, expect, test } from "vitest";
import { decideClientRun, describeCap, pagesOf } from "@/lib/analysis-cap";
import type { AllowanceDecision } from "@/lib/allowance";

const fine: AllowanceDecision = { ok: true, level: "fine", warning: null };
const near: AllowanceDecision = { ok: true, level: "near", warning: "Your organization has used 85% of this month's AI allowance." };
// The Analyze button is a build step, so in practice it is never refused (lib/allowance.ts); the page still handles a refusal.
const used: AllowanceDecision = { ok: false, level: "ceiling", canRequest: true, message: "Your organization has used this month's AI allowance." };

describe("decideClientRun", () => {
  test("nothing new to read is never a run, whatever the allowance", () => {
    expect(decideClientRun({ pendingDocs: 0, pendingChars: 0, allowance: fine })).toEqual({ allowed: false, reason: "nothing_new" });
    expect(decideClientRun({ pendingDocs: 0, pendingChars: 0, allowance: used }).allowed).toBe(false);
    expect(describeCap({ allowed: false, reason: "nothing_new" })).toContain("has been analysed");
  });

  test("within the allowance a run is allowed, as often as there is something new (no daily or page cap)", () => {
    expect(decideClientRun({ pendingDocs: 40, pendingChars: 3_000_000, allowance: fine })).toEqual({ allowed: true, pages: 1000, warning: null });
  });

  test("near the allowance the run is allowed and carries the warning", () => {
    const d = decideClientRun({ pendingDocs: 1, pendingChars: 3000, allowance: near });
    expect(d).toEqual({ allowed: true, pages: 1, warning: near.ok && "warning" in near ? near.warning : null });
  });

  test("past the allowance the button says why", () => {
    const d = decideClientRun({ pendingDocs: 2, pendingChars: 9000, allowance: used });
    expect(d).toEqual({ allowed: false, reason: "allowance", message: "Your organization has used this month's AI allowance." });
    expect(describeCap(d)).toBe("Your organization has used this month's AI allowance.");
  });

  test("an admin's unlimited allowance always allows", () => {
    expect(decideClientRun({ pendingDocs: 1, pendingChars: 10, allowance: { ok: true, unlimited: true } }).allowed).toBe(true);
  });

  test("pages round up, and an empty text is no pages", () => {
    expect(pagesOf(1)).toBe(1);
    expect(pagesOf(3000)).toBe(1);
    expect(pagesOf(3001)).toBe(2);
    expect(pagesOf(0)).toBe(0);
  });
});
