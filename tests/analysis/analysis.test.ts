// Inven(s)tory Analysis, Phase A: the rules that decide what the one read keeps.
import { describe, expect, test } from "vitest";
import {
  DOC_TYPES, DOC_TYPE_MAP, FACT_KEYS, parseAnalysis, pickDocType, checkFact, decideDocument, stateCode,
  previewLibrary, summarizeFacts, reviewSample, reviewTally, reviewTarget, duplicatePairs, type ParsedRead,
} from "@/lib/analysis";
import { CARD_KINDS, kindsFor, cardFingerprint } from "@/lib/story-card";
import { CHECKLIST } from "@/lib/checklist";

const DOC = `Bright Paths Youth Center is a 501(c)(3) nonprofit based in Cleveland, Ohio. EIN: 34-1234567.
Our annual operating budget for FY2025 is $1,250,000. Founded in 2009, we serve youth aged 14 to 18 in Cuyahoga County.
In 2025 we ran weekly mentoring sessions at nine partner schools, reaching 412 students.
Our competitor, Northside Mentors, raised $3,000,000 last year.
The Gund Foundation awarded us $75,000 in general operating support in 2024.`;

const allowed = new Set(kindsFor("nonprofit_501c3").map(k => k.key));

describe("the vocabulary", () => {
  test("every document type that evidences an item names a real checklist item", () => {
    const keys = new Set(CHECKLIST.map(i => i.key));
    for (const t of DOC_TYPES) if (t.itemKey) expect(keys.has(t.itemKey), t.key).toBe(true);
  });

  test("the spec's document-type items are all covered by a type", () => {
    const covered = new Set(DOC_TYPES.map(t => t.itemKey).filter(Boolean));
    for (const k of ["irs_990", "determination", "board_roster", "annual_report", "program_budgets", "funder_list",
      "eval_reports", "past_grants", "public_story", "pitch_deck", "cap_table", "investor_updates", "financial_model"]) {
      expect(covered.has(k), k).toBe(true);
    }
  });

  test("the new funding_source card kind evidences Other funding sources", () => {
    const k = CARD_KINDS.find(c => c.key === "funding_source");
    expect(k?.itemKey).toBe("other_funding");
    expect(kindsFor("for_profit").some(c => c.key === "funding_source")).toBe(true);
  });

  test("fact keys are unique", () => {
    expect(new Set(FACT_KEYS.map(f => f.key)).size).toBe(FACT_KEYS.length);
  });
});

describe("parseAnalysis", () => {
  test("reads the object, with prose around it", () => {
    const r = parseAnalysis(`Here you go:\n{"document_type":{"type":"IRS_990","reason":"form header","quote":"Form 990"},
      "cards":[{"kind":"program_model","statement":"x","quote":"y","subject":"organization","strength":"covered"}],
      "facts":[{"key":"EIN","value":"34-1234567","quote":"EIN: 34-1234567","subject":"organization"}]}`);
    expect(r.parsed).toBe(true);
    expect(r.docType?.type).toBe("irs_990");
    expect(r.cards).toHaveLength(1);
    expect(r.facts[0].key).toBe("ein");
  });

  test("degrades to cards when the model answers with a bare array", () => {
    const r = parseAnalysis(`[{"kind":"program_model","statement":"s","quote":"q"}]`);
    expect(r.parsed).toBe(true);
    expect(r.docType).toBeNull();
    expect(r.cards).toHaveLength(1);
  });

  test("garbage is not parsed", () => {
    expect(parseAnalysis("sorry, I cannot").parsed).toBe(false);
  });
});

describe("pickDocType", () => {
  test("the first window that names a real type wins over later ones", () => {
    const a = { type: "irs_990", reason: "", quote: "" };
    const b = { type: "annual_report", reason: "", quote: "" };
    expect(pickDocType([null, a, b])?.type).toBe("irs_990");
  });
  test("'other' only when nothing better was said; unknown keys never", () => {
    expect(pickDocType([{ type: "other", reason: "", quote: "" }, { type: "pitch_deck", reason: "", quote: "" }])?.type).toBe("pitch_deck");
    expect(pickDocType([{ type: "made_up", reason: "", quote: "" }])).toBeNull();
  });
});

describe("checkFact", () => {
  const ok = (key: string, value: string, quote: string) => checkFact({ key, value, quote, subject: "organization" }, DOC);

  test("an EIN is normalised and must be in its quote", () => {
    const r = ok("ein", "341234567", "EIN: 34-1234567.");
    expect(r.ok && r.fact.value).toBe("34-1234567");
    expect(ok("ein", "34-7654321", "EIN: 34-1234567.").ok).toBe(false);
    expect(ok("ein", "12345", "EIN: 34-1234567.").ok).toBe(false);
  });

  test("a state is a code, and the quote must name it", () => {
    const r = ok("state", "Ohio", "nonprofit based in Cleveland, Ohio");
    expect(r.ok && r.fact.value).toBe("OH");
    expect(ok("state", "PA", "nonprofit based in Cleveland, Ohio").ok).toBe(false);
    expect(ok("state", "Narnia", "nonprofit based in Cleveland, Ohio").ok).toBe(false);
  });

  test("a budget's figures must be in its quote", () => {
    expect(ok("annual_budget", "$1,250,000 (FY2025)", "Our annual operating budget for FY2025 is $1,250,000.").ok).toBe(true);
    expect(ok("annual_budget", "$1.25 million", "Our annual operating budget for FY2025 is $1,250,000.").ok).toBe(false);
  });

  test("enum facts use the eligibility form's vocabulary", () => {
    expect(ok("tax_status", "501C3", "Bright Paths Youth Center is a 501(c)(3) nonprofit").ok).toBe(true);
    expect(ok("tax_status", "charity", "Bright Paths Youth Center is a 501(c)(3) nonprofit").ok).toBe(false);
  });

  test("a year must be in its quote", () => {
    const r = ok("founded_year", "2009", "Founded in 2009, we serve youth");
    expect(r.ok && r.fact.value).toBe("2009");
    expect(ok("founded_year", "2010", "Founded in 2009, we serve youth").ok).toBe(false);
  });

  test("quotes must be real, and facts must be about the client", () => {
    expect(ok("population", "youth aged 14 to 18", "we serve teenagers across the whole state").ok).toBe(false);
    expect(checkFact({ key: "annual_budget", value: "$3,000,000", quote: "Northside Mentors, raised $3,000,000 last year", subject: "competitor" }, DOC))
      .toEqual({ ok: false, reason: "competitor" });
    expect(checkFact({ key: "state", value: "OH", quote: "based in Cleveland, Ohio", subject: "third_party" }, DOC))
      .toEqual({ ok: false, reason: "not_about_client" });
    expect(ok("nonsense", "x", "based in Cleveland, Ohio").ok).toBe(false);
  });

  test("a text fact may not add a figure", () => {
    expect(ok("population", "youth aged 14 to 18", "we serve youth aged 14 to 18 in Cuyahoga County").ok).toBe(true);
    expect(ok("population", "youth aged 12 to 18", "we serve youth aged 14 to 18 in Cuyahoga County").ok).toBe(false);
  });

  test("stateCode handles names and codes", () => {
    expect(stateCode("new york")).toBe("NY");
    expect(stateCode("dc")).toBe("DC");
    expect(stateCode("Ohio.")).toBe("OH");
    expect(stateCode("Ontario")).toBeNull();
  });
});

const window = (over: Partial<ParsedRead>): ParsedRead => ({ docType: null, cards: [], facts: [], parsed: true, ...over });
const card = {
  kind: "program_model", subject: "organization" as const, strength: "covered" as const,
  statement: "Bright Paths runs weekly mentoring sessions at nine partner schools, reaching 412 students in 2025.",
  quote: "In 2025 we ran weekly mentoring sessions at nine partner schools, reaching 412 students.",
};

describe("decideDocument", () => {
  test("cards use the Card Library's checks, and duplicates across windows collapse", () => {
    const out = decideDocument({
      windows: [
        window({ docType: { type: "annual_report", reason: "", quote: "Bright Paths Youth Center is a 501(c)(3)" }, cards: [card] }),
        window({ cards: [card, { ...card, statement: "Bright Paths reached 500 students across nine partner schools every week.", quote: card.quote }] }),
      ],
      text: DOC, layer: "II", allowedKinds: allowed,
    });
    expect(out.docType?.type).toBe("annual_report");
    expect(out.docTypeProven).toBe(true);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].layer).toBe("II");
    expect(out.rejected.map(r => r.reason)).toEqual(["untraced_figures"]);
  });

  test("the new kind is accepted", () => {
    const out = decideDocument({
      windows: [window({ cards: [{
        kind: "funding_source", subject: "organization", strength: "covered",
        statement: "The Gund Foundation awarded Bright Paths $75,000 in general operating support in 2024.",
        quote: "The Gund Foundation awarded us $75,000 in general operating support in 2024.",
      }] })],
      text: DOC, layer: "II", allowedKinds: allowed,
    });
    expect(out.cards.map(c => c.kind)).toEqual(["funding_source"]);
  });

  test("a funder's own form yields no cards and no facts", () => {
    const out = decideDocument({
      windows: [window({
        docType: { type: "funder_form", reason: "blank RFP", quote: "" },
        cards: [card],
        facts: [{ key: "state", value: "OH", quote: "based in Cleveland, Ohio", subject: "organization" }],
      })],
      text: DOC, layer: "II", allowedKinds: allowed,
    });
    expect(out.cards).toHaveLength(0);
    expect(out.facts).toHaveLength(0);
    expect(out.rejected.every(r => r.reason === "funder_document")).toBe(true);
    expect(out.docTypeProven).toBe(false);
  });

  test("facts are de-duplicated by key and value", () => {
    const f = { key: "state", value: "Ohio", quote: "based in Cleveland, Ohio", subject: "organization" as const };
    const out = decideDocument({ windows: [window({ facts: [f, { ...f, value: "OH" }] })], text: DOC, layer: "I", allowedKinds: allowed });
    expect(out.facts).toHaveLength(1);
  });
});

describe("across documents", () => {
  test("the preview library merges the same claim from two documents into one card", () => {
    const accepted = { ...card, hasFigures: true, speaker: null, layer: "II" };
    const lib = previewLibrary([
      { documentId: "d1", cards: [accepted] },
      { documentId: "d2", cards: [{ ...accepted, layer: "I" }] },
    ]);
    expect(lib).toHaveLength(1);
    expect(lib[0].evidence.map(e => e.documentId).sort()).toEqual(["d1", "d2"]);
    expect(lib[0].fingerprint).toBe(cardFingerprint(card.kind, card.statement));
  });

  test("facts are summarised by key, and one-value conflicts are called out", () => {
    const s = summarizeFacts([
      { documentId: "d1", facts: [{ key: "ein", value: "34-1234567", quote: "q1", speaker: null }] },
      { documentId: "d2", facts: [{ key: "ein", value: "34-7654321", quote: "q2", speaker: null },
        { key: "population", value: "youth", quote: "q3", speaker: null }] },
      { documentId: "d3", facts: [{ key: "population", value: "Youth", quote: "q4", speaker: null }] },
    ]);
    const ein = s.find(f => f.key === "ein")!;
    const pop = s.find(f => f.key === "population")!;
    expect(ein.conflicting).toBe(true);
    expect(pop.conflicting).toBe(false);
    expect(pop.values).toHaveLength(1);
    expect(pop.values[0].sources).toHaveLength(2);
    expect(s[0].key).toBe("ein");   // FACT_KEYS order
  });

  const lib = (n: number, docs: string[]) => Array.from({ length: n }, (_, i) => ({
    fingerprint: `fp${i}`, evidence: [{ documentId: docs[i % docs.length] }],
  }));

  test("a library of 100 or fewer is reviewed in full", () => {
    expect(reviewTarget(85)).toBe(85);
    expect(reviewTarget(100)).toBe(100);
    expect(reviewTarget(230)).toBe(100);
    const all = reviewSample(lib(85, ["d1"]), "t", new Set());
    expect(all).toHaveLength(85);
  });

  test("a larger library gives 100 cards, shared across documents in proportion", () => {
    // 150 cards from d1, 50 from d2, 30 from d3: shares of 100 are 65, 22, 13.
    const cards = [
      ...lib(150, ["d1"]).map(c => ({ ...c, fingerprint: `a${c.fingerprint}` })),
      ...lib(50, ["d2"]).map(c => ({ ...c, fingerprint: `b${c.fingerprint}` })),
      ...lib(30, ["d3"]).map(c => ({ ...c, fingerprint: `c${c.fingerprint}` })),
    ];
    const s1 = reviewSample(cards, "tenant-1", new Set());
    expect(s1).toHaveLength(100);
    const by = (d: string) => s1.filter(c => c.evidence[0].documentId === d).length;
    expect([by("d1"), by("d2"), by("d3")]).toEqual([65, 22, 13]);
    // Stable, and different per client.
    expect(reviewSample([...cards].reverse(), "tenant-1", new Set()).map(c => c.fingerprint).sort())
      .toEqual(s1.map(c => c.fingerprint).sort());
    expect(reviewSample(cards, "tenant-2", new Set()).map(c => c.fingerprint).sort())
      .not.toEqual(s1.map(c => c.fingerprint).sort());
  });

  test("cards already reviewed stay in the sample and count toward their document", () => {
    const cards = lib(230, ["d1", "d2"]);
    const first = reviewSample(cards, "t", new Set());
    const outside = cards.find(c => !first.includes(c))!;
    const again = reviewSample(cards, "t", new Set([outside.fingerprint]));
    expect(again.map(c => c.fingerprint)).toContain(outside.fingerprint);
    expect(again).toHaveLength(100);
  });

  test("flagged pairs come from the library's duplicate flags", () => {
    expect(duplicatePairs([
      { fingerprint: "a", possibleDuplicateOf: null },
      { fingerprint: "b", possibleDuplicateOf: "a" },
      { fingerprint: "c", possibleDuplicateOf: "gone" },
    ])).toEqual([{ card: "b", other: "a" }]);
  });

  test("the gate: 90% fully supported, zero competitor, every pair decided, duplicates under 10% of the library", () => {
    const good = { verdict: "supported" as const, competitor: false, duplicate: false };
    const marks = (n: number, over: Partial<typeof good>[] = []) =>
      Array.from({ length: n }, (_, i) => ({ ...good, ...(over[i] ?? {}) }));
    const noPairs = { total: 0, decided: 0, same: 0 };
    expect(reviewTally(marks(85), 85, 85, noPairs).passes).toBe(true);
    expect(reviewTally(marks(84), 85, 85, noPairs).checks.enough).toBe(false);
    expect(reviewTally(marks(100, Array.from({ length: 10 }, () => ({ verdict: "unsupported" as const }))), 100, 230, noPairs)
      .checks.supported).toBe(true);                                          // 90/100
    expect(reviewTally(marks(100, Array.from({ length: 11 }, () => ({ verdict: "partly" as const }))), 100, 230, noPairs)
      .checks.supported).toBe(false);                                         // partly is not supported
    expect(reviewTally(marks(100, [{ competitor: true }]), 100, 230, noPairs).passes).toBe(false);
    expect(reviewTally(marks(100), 100, 230, { total: 4, decided: 3, same: 0 }).checks.pairs).toBe(false);
    // Duplicates over the whole library: 22 same-claim pairs of 230 is 9.6%, 23 is 10%.
    expect(reviewTally(marks(100), 100, 230, { total: 30, decided: 30, same: 22 }).checks.duplicates).toBe(true);
    expect(reviewTally(marks(100), 100, 230, { total: 30, decided: 30, same: 23 }).checks.duplicates).toBe(false);
    // Unflagged duplicates noticed in review add to the count.
    expect(reviewTally(marks(100, [{ duplicate: true }]), 100, 230, { total: 30, decided: 30, same: 22 }).checks.duplicates).toBe(false);
    expect(reviewTally([], 0, 0, noPairs).passes).toBe(false);
  });
});

test("DOC_TYPE_MAP has every type", () => {
  for (const t of DOC_TYPES) expect(DOC_TYPE_MAP[t.key]).toBe(t);
});
