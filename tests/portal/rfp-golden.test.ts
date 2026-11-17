// The golden set against the rules (patch 54). With the frozen fits, Rubric
// v1.1 in code must reproduce every settled verdict: this is the deterministic
// half of the regression. The live half (the model's fit) runs from Admin.
import { describe, it, expect } from "vitest";
import { GOLDEN_ROWS, GOLDEN_GATES, GOLDEN_AS_OF } from "@/lib/rfp-golden";
import { screenRfp, verdict, BUCKET_OF, GOLDEN_BAR, type Action } from "@/lib/rfp-rubric";

const decide = (id: string): Action => {
  const r = GOLDEN_ROWS.find(x => x.id === id)!;
  const s = screenRfp(r.notice, GOLDEN_GATES, GOLDEN_AS_OF);
  if (s.action) return s.action;
  if (!r.frozen) throw new Error(`${id} needs a fit judgment but has none frozen`);
  return verdict(s, r.frozen).action;
};

describe("the golden set", () => {
  it("has the 20 rows, and 8 in the original comparison set", () => {
    expect(GOLDEN_ROWS).toHaveLength(20);
    expect(new Set(GOLDEN_ROWS.map(r => r.id)).size).toBe(20);
    expect(GOLDEN_ROWS.filter(r => r.comparable).map(r => r.id)).toEqual(["R1", "R2", "R5", "R12", "R15", "R16", "R17", "R20"]);
  });

  for (const r of GOLDEN_ROWS) {
    it(`${r.id} ${r.label}: ${r.expected}`, () => {
      expect(decide(r.id)).toBe(r.expected);
    });
  }

  it("a frozen fit is given exactly where the rules leave fit to judge", () => {
    for (const r of GOLDEN_ROWS) {
      const s = screenRfp(r.notice, GOLDEN_GATES, GOLDEN_AS_OF);
      if (s.action === null) expect(r.frozen, r.id).not.toBeNull();
    }
  });

  it("lands in the slide 5 buckets, with R11 scored at its window rather than after its award", () => {
    const counts: Record<string, number> = {};
    for (const r of GOLDEN_ROWS) counts[BUCKET_OF[decide(r.id)]] = (counts[BUCKET_OF[decide(r.id)]] ?? 0) + 1;
    // Slide 5: 2 committed, 4 free responses, 4 verification first, 8 no's, 2 watch.
    // R11 is a lean bid at its window, so it sits with the committed pursuits here.
    expect(counts).toEqual({ draft_submit: 3, open_response: 4, no_source: 4, spend_nothing: 7, upcoming: 2 });
  });

  it("holds the bar it will be held to", () => { expect(GOLDEN_BAR).toBe(0.8); });
});
