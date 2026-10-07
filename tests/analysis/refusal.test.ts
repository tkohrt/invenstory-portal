// Remembered refusals (decisions 19 and 31): a refused quote cannot come back.
import { describe, expect, test } from "vitest";
import { quoteKey, quotesMatch, refusalFor, indexRefusals, withoutRefused, MIN_FUZZY_WORDS, type Refusal } from "@/lib/refusal";

const SUD = "we actually were really excited to have just landed our 1st contract with a substance use disorder "
  + "mitigation organization that provides recovery housing, transportation and workforce development.";

const refusal = (quote: string, over: Partial<Refusal> = {}): Refusal => ({
  id: "r1", source: "review", sourceRef: "fp1", documentId: "d1", kind: "traction",
  statement: "RE-Assist landed its first contract with an SUD organization.", quote, createdAt: "2026-10-06T00:00:00Z",
  ...over,
});

describe("matching a quote", () => {
  test("the same quote, with different quote marks, case, spacing and bold, matches", () => {
    expect(quotesMatch(SUD, `“${SUD.toUpperCase().replace(/ /g, "  ")}”`)).toBe(true);
    expect(quotesMatch(SUD, SUD.replace("substance use disorder", "**substance use disorder**"))).toBe(true);
  });

  test("a re-read that trims the quote still matches", () => {
    const trimmed = "landed our 1st contract with a substance use disorder mitigation organization that provides recovery housing";
    expect(quotesMatch(SUD, trimmed)).toBe(true);
  });

  test("a re-read that starts earlier and stops earlier still matches", () => {
    const shifted = "and so we actually were really excited to have just landed our 1st contract with a substance use "
      + "disorder mitigation organization that provides recovery housing";
    expect(quotesMatch(SUD, shifted)).toBe(true);
  });

  test("the refused quote whole inside a longer passage is refused: the quote has come back", () => {
    const longer = `${SUD} Separately, RE-Assist has enrolled 412 patients across nine primary care practices in Hamilton `
      + "County since January, with a 38 percent reduction in missed appointments.";
    expect(quotesMatch(SUD, longer)).toBe(true);
    // The 6 October 2026 case: the garbled line came back with the sentence before it, under another kind.
    expect(quotesMatch("I ended up opening up a rehab hospital as a rehab weason.",
      "I start getting sought after through different companies, and so I ended up opening up a rehab hospital as a rehab weason.")).toBe(true);
  });

  test("a longer passage sharing only part of the refused quote is let through", () => {
    const partial = "landed our 1st contract with a payer in Ohio, and separately RE-Assist has enrolled 412 patients across nine "
      + "primary care practices in Hamilton County since January, with a 38 percent reduction in missed appointments.";
    expect(quotesMatch(SUD, partial)).toBe(false);
  });

  test("a short refused fragment inside a longer, different quote is let through", () => {
    expect(quotesMatch("code help from CUNY, JumpStart involvement",
      "Ashley has an unusually strong endorsement track record: an MIT Solve award, over a year with Harvard, code help from CUNY, JumpStart involvement")).toBe(false);
  });

  test("a clause taken from a long refused passage is refused with it", () => {
    const passage = "Tyler and I, as you'll know, um, we're big relationship people. That's why we're in this business. "
      + "We think that you can. We think that you can do well while you're doing good.";
    expect(quotesMatch(passage, "We think that you can do well while you're doing good.")).toBe(true);
  });

  test("a different quote does not match", () => {
    expect(quotesMatch(SUD, "RE-Assist works with 13 physicians who have a patient population of approximately 1,000.")).toBe(false);
  });

  test("a short quote matches only exactly", () => {
    const short = "I've been a crypto for 20 years.";
    expect(quoteKey(short).split(" ").length).toBeLessThan(MIN_FUZZY_WORDS);
    expect(quotesMatch(short, "i've been a crypto for 20 years")).toBe(true);
    expect(quotesMatch(short, "I've been a crypto for 20 years and loved it")).toBe(false);
  });

  test("empty quotes never match", () => {
    expect(quotesMatch("", "")).toBe(false);
    expect(refusalFor("", indexRefusals([refusal("")]))).toBeNull();
  });
});

describe("filtering a read", () => {
  const docs = [
    { documentId: "d1", cards: [
      { kind: "traction", statement: "Landed a first SUD contract.", quote: SUD },
      { kind: "program_model", statement: "RE-Assist coordinates care.", quote: "RE-Assist coordinates care between primary care physicians and their patients after discharge." },
    ] },
    // The same quote in another document, under another kind: still refused. The quote is what is remembered.
    { documentId: "d2", cards: [{ kind: "partnership", statement: "Works with a recovery housing provider.", quote: SUD }] },
  ];

  test("refused cards are taken out, in every document and under any kind, and reported", () => {
    const r = withoutRefused(docs, [refusal(SUD)]);
    expect(r.docs[0].cards.map(c => c.kind)).toEqual(["program_model"]);
    expect(r.docs[1].cards).toEqual([]);
    expect(r.blocked.map(b => [b.documentId, b.card.kind, b.refusal.id])).toEqual([["d1", "traction", "r1"], ["d2", "partnership", "r1"]]);
  });

  test("with nothing remembered, the read passes through untouched", () => {
    const r = withoutRefused(docs, []);
    expect(r.docs).toBe(docs);
    expect(r.blocked).toEqual([]);
  });

  test("other document fields are kept", () => {
    const withType = [{ ...docs[0], docType: "transcript" }];
    expect(withoutRefused(withType, [refusal(SUD)]).docs[0].docType).toBe("transcript");
  });
});
