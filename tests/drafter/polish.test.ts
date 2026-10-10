import { describe, expect, test } from "vitest";
import { checkShortening, describeFigureFlags, dropOptions, figureAudit, openFlags, parsePolish, repeats, screenShortenings } from "@/lib/polish";

const quotes: Record<string, string[]> = {
  c1: ["In 2025 we served 312 families across Hamilton County."],
  c2: ["Nurse navigators call every patient within 48 hours of discharge."],
};
const q = (id: string) => quotes[id] ?? [];

describe("the figure audit", () => {
  test("a card's number is looked for in that card's sources", () => {
    const flags = figureAudit([
      { id: "b1", kind: "card", cardId: "c1", text: "In 2025 we served 400 families." },
      { id: "b2", kind: "card", cardId: "c2", text: "Navigators call within 48 hours." },
    ], q);
    expect(flags.map(f => [f.blockId, f.figure, f.where])).toEqual([["b1", "400", "card"]]);
  });

  test("your own words and bridges may use any number the answer's cards hold, and nothing else", () => {
    const flags = figureAudit([
      { id: "b1", kind: "card", cardId: "c1", text: "We served 312 families." },
      { id: "b2", kind: "card", cardId: "c2", text: "Navigators call within 48 hours." },
      { id: "h1", kind: "human", cardId: null, text: "Those 312 families got a call within 48 hours; 90% stayed home." },
      { id: "x1", kind: "bridge", cardId: null, text: "That took 3 years.", proposed: true },
    ], q);
    expect(flags.map(f => [f.blockId, f.figure, f.where])).toEqual([["h1", "90", "answer"]]);
  });

  test("a cleared flag is kept, with who and why, and no longer stops the answer", () => {
    const blocks = [{ id: "h1", kind: "human", cardId: null, text: "We have 12 staff." }];
    const flags = figureAudit(blocks, q, [{ blockId: "h1", figure: "12", by: "u1", role: "client", reason: "From the 2026 org chart", at: "2026-10-09" }]);
    expect(flags).toHaveLength(1);
    expect(flags[0].cleared?.reason).toBe("From the 2026 org chart");
    expect(openFlags(flags)).toHaveLength(0);
    expect(describeFigureFlags(2)).toMatch(/2 numbers in this application have no source/);
    expect(describeFigureFlags(1)).not.toContain("—");
  });
});

describe("repetition", () => {
  test("two pieces sharing six or more words in a row", () => {
    const r = repeats([
      { id: "a", kind: "card", cardId: "c1", text: "No older adult should leave the hospital without a plan." },
      { id: "b", kind: "human", cardId: null, text: "We believe no older adult should leave the hospital alone." },
      { id: "c", kind: "card", cardId: "c2", text: "Navigators call every patient." },
    ]);
    expect(r).toEqual([{ a: "a", b: "b", phrase: "no older adult should leave the hospital" }]);
  });
});

describe("pieces that could go", () => {
  const words = (n: number) => Array(n).fill("word").join(" ");
  const pieces = [
    { id: "p1", kind: "card", cardId: "k1", text: words(40) },  // the only program model
    { id: "p2", kind: "card", cardId: "k2", text: words(30) },  // outcome, a second one
    { id: "p3", kind: "card", cardId: "k3", text: words(30) },  // outcome
    { id: "h1", kind: "human", cardId: null, text: words(10) },
  ];
  const kinds: Record<string, string> = { k1: "program_model", k2: "outcome_metric", k3: "outcome_metric" };
  const scores: Record<string, number> = { k1: 0.9, k2: 0.2, k3: 0.6 };
  const base = { pieces, unit: "words" as const, kindOf: (id: string) => kinds[id], wantedKinds: ["program_model", "outcome_metric"], scoreOf: (id: string) => scores[id] };

  test("under the limit, nothing to drop", () => {
    expect(dropOptions({ ...base, limit: 200 })).toEqual([]);
  });

  test("one piece enough on its own, the gentlest first; the only card of a wanted kind last", () => {
    const o = dropOptions({ ...base, limit: 85 });
    expect(o.map(x => x.blockIds)).toEqual([["p2"], ["p3"], ["p1"]]);
    expect(o[0]).toMatchObject({ after: 80, saves: 30 });
  });

  test("when no one piece is enough, the fewest gentle pieces together", () => {
    const o = dropOptions({ ...base, limit: 45 });
    expect(o).toHaveLength(1);
    expect(o[0].after).toBeLessThanOrEqual(45);
    expect(o[0].blockIds).not.toContain("p1");
  });
});

describe("shorter wording: the code check", () => {
  const orig = "Since 2019, RE-Assist nurse navigators have called every patient within 48 hours of discharge to coordinate care.";
  test("shorter, same facts: shown", () => {
    expect(checkShortening(orig, "Since 2019, RE-Assist navigators have called every patient within 48 hours of discharge.")).toBeNull();
  });
  test("refused: longer, gutted, a changed number, a new name, a changed quotation", () => {
    expect(checkShortening(orig, `${orig} Truly.`)).toBe("not_shorter");
    expect(checkShortening(orig, "RE-Assist calls.")).toBe("too_short");
    expect(checkShortening(orig, "Since 2019, RE-Assist navigators have called every patient within 24 hours.")).toBe("number");
    expect(checkShortening(orig, "Since 2019, RE-Assist navigators at Mercy Health call every patient within 48 hours.")).toBe("name");
    expect(checkShortening('She said "the call saved my mother" after her discharge from the hospital last spring.', 'She said "the call saved her" after discharge last spring.')).toBe("quote");
    // Dropping a number is allowed; a capitalised word opening the sentence is fine when the piece holds it.
    expect(checkShortening(orig, "Nurse navigators have called every patient soon after discharge to coordinate care.")).toBeNull();
  });
  test("reading the reply and keeping what passes", () => {
    const got = parsePolish('Here: {"pieces":[{"n":1,"text":"Since 2019, RE-Assist navigators have called every patient within 48 hours of discharge."},{"n":9,"text":"x"},{"n":2,"text":"Longer than the original by far, much much longer indeed."}]}', ["b1", "b2"]);
    expect(got).toHaveLength(2);
    const { kept, refused } = screenShortenings(got!, new Map([["b1", orig], ["b2", "Short one here."]]), "words");
    expect(kept.map(k => [k.blockId, k.saves])).toEqual([["b1", 4]]);
    expect(refused).toEqual([{ blockId: "b2", reason: "not_shorter" }]);
    expect(parsePolish("no json", ["b1"])).toBeNull();
  });
});
