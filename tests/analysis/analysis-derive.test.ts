// Inven(s)tory Analysis, Phase B: readiness, eligibility and the search profile, worked out in code.
import { describe, expect, test } from "vitest";
import {
  deriveReadiness, readinessScore, essentialsAtLeastThin, parseMoney, budgetBand, deriveEligibility,
  deriveSearchFacts, compareReadiness, comparisonGate, EXTRA_KIND_ITEMS, KIND_FACET, FACT_FACET,
  type AnalysedDoc, type ItemState,
} from "@/lib/analysis-derive";
import { CHECKLIST, checklistFor, TIER_WEIGHT } from "@/lib/checklist";
import { CARD_KIND_MAP } from "@/lib/story-card";
import { FACT_KEY_MAP, type AnalysisCard, type AnalysisFact } from "@/lib/analysis";
import { EMPTY_PROFILE } from "@/lib/eligibility-fields";

const card = (kind: string, strength: "covered" | "thin" = "covered", quote = `quote for ${kind}`): AnalysisCard => ({
  kind, statement: `A ${kind} statement about the organization.`, quote, subject: "organization", strength,
  hasFigures: false, speaker: null, layer: "II",
});
const fact = (key: string, value: string, quote = `${key}: ${value}`): AnalysisFact => ({ key, value, quote, speaker: null, layer: "I" });
const doc = (over: Partial<AnalysedDoc>): AnalysedDoc => ({
  id: "d1", title: "Doc", layer: "II", docType: null, docTypeProven: false, docTypeQuote: null, cards: [], facts: [], roster: null, ...over,
});
const stateOf = (items: { key: string; state: ItemState }[], key: string) => items.find(i => i.key === key)?.state;

describe("the mapping tables", () => {
  const keys = new Set(CHECKLIST.map(i => i.key));
  test("every extra item a card kind maps to is a real checklist item", () => {
    for (const [kind, items] of Object.entries(EXTRA_KIND_ITEMS)) {
      expect(CARD_KIND_MAP[kind], kind).toBeTruthy();
      for (const k of items) expect(keys.has(k), k).toBe(true);
    }
  });
  test("every facet source is a real card kind or fact key", () => {
    for (const k of Object.keys(KIND_FACET)) expect(CARD_KIND_MAP[k], k).toBeTruthy();
    for (const k of Object.keys(FACT_FACET)) expect(FACT_KEY_MAP[k], k).toBeTruthy();
  });
});

describe("deriveReadiness", () => {
  test("a document's type covers its item when quoted, thin when judged", () => {
    const r = deriveReadiness("nonprofit_501c3", [
      doc({ id: "a", docType: "irs_990", docTypeProven: true, docTypeQuote: "Form 990" }),
      doc({ id: "b", docType: "board_roster", docTypeProven: false }),
    ]);
    expect(stateOf(r, "irs_990")).toBe("covered");
    expect(stateOf(r, "board_roster")).toBe("thin");
    expect(stateOf(r, "determination")).toBe("missing");
  });

  test("cards cover their item, thin cards make it thin, and the strongest wins", () => {
    const r = deriveReadiness("nonprofit_501c3", [
      doc({ id: "a", cards: [card("program_model", "thin")] }),
      doc({ id: "b", cards: [card("program_model", "covered"), card("leadership_team", "thin")] }),
    ]);
    expect(stateOf(r, "program")).toBe("covered");
    expect(stateOf(r, "leadership")).toBe("thin");
  });

  test("a need told only as a story is never data-backed", () => {
    const r = deriveReadiness(null, [doc({ cards: [card("need_story", "covered")] })]);
    expect(stateOf(r, "need")).toBe("thin");
    const r2 = deriveReadiness(null, [doc({ cards: [card("need_story"), card("need_data")] })]);
    expect(stateOf(r2, "need")).toBe("covered");
  });

  test("the new funding_source kind evidences Other funding sources", () => {
    expect(stateOf(deriveReadiness(null, [doc({ cards: [card("funding_source")] })]), "other_funding")).toBe("covered");
  });

  test("startup items: competition from what sets it apart, strategic partners from partnerships", () => {
    const r = deriveReadiness("for_profit", [doc({ cards: [card("differentiator"), card("partnership", "thin"), card("traction"), card("market")] })]);
    expect(stateOf(r, "competition")).toBe("covered");
    expect(stateOf(r, "strategic_partners")).toBe("thin");
    expect(stateOf(r, "traction")).toBe("covered");
    expect(stateOf(r, "go_to_market")).toBe("covered");
    expect(stateOf(deriveReadiness("nonprofit_501c3", [doc({ cards: [card("differentiator")] })]), "competition")).toBeUndefined();
  });

  test("the founder interview needs someone from the organization speaking", () => {
    const client = { chars: 100, speakers: [{ label: "Speaker 1", isClient: true }, { label: "Speaker 2", isClient: false }] };
    const outsiders = { chars: 100, speakers: [{ label: "Speaker 1", isClient: false }] };
    expect(stateOf(deriveReadiness(null, [doc({ docType: "interview", roster: client })]), "founder_voice")).toBe("covered");
    expect(stateOf(deriveReadiness(null, [doc({ docType: "interview", roster: null })]), "founder_voice")).toBe("thin");
    expect(stateOf(deriveReadiness(null, [doc({ docType: "meeting_transcript", roster: client })]), "founder_voice")).toBe("thin");
    expect(stateOf(deriveReadiness(null, [doc({ docType: "meeting_transcript", roster: outsiders })]), "founder_voice")).toBe("missing");
  });

  test("a stated annual budget makes the budget item thin, not covered", () => {
    expect(stateOf(deriveReadiness(null, [doc({ facts: [fact("annual_budget", "$1,200,000")] })]), "budget")).toBe("thin");
  });

  test("every checklist item for the org type comes back, each with its reason", () => {
    const r = deriveReadiness("for_profit", []);
    expect(r.map(i => i.key)).toEqual(checklistFor("for_profit").map(i => i.key));
    expect(r.every(i => i.state === "missing" && i.why)).toBe(true);
  });
});

describe("readinessScore", () => {
  test("matches the current checklist's formula: tier weights, thin counts half", () => {
    const items = checklistFor(null);
    const total = items.reduce((a, i) => a + TIER_WEIGHT[i.tier], 0);
    expect(readinessScore(items, () => "covered")).toBe(100);
    expect(readinessScore(items, () => "missing")).toBe(0);
    expect(readinessScore(items, () => "thin")).toBe(50);
    const first = items[0];
    expect(readinessScore(items, k => (k === first.key ? "covered" : "missing")))
      .toBe(Math.round((TIER_WEIGHT[first.tier] / total) * 100));
  });

  test("Funder Matches opens only when every Essential is at least thin", () => {
    const ess = checklistFor(null).filter(i => i.tier === "essential").map(i => i.key);
    expect(essentialsAtLeastThin(null, k => (ess.includes(k) ? "thin" : "missing"))).toBe(true);
    expect(essentialsAtLeastThin(null, k => (k === ess[0] ? "missing" : "covered"))).toBe(false);
  });
});

describe("eligibility suggestions", () => {
  test("money as written becomes a band", () => {
    expect(parseMoney("$1,250,000 (FY2025)")).toBe(1_250_000);
    expect(parseMoney("$1.2 million")).toBe(1_200_000);
    expect(parseMoney("850K")).toBe(850_000);
    expect(parseMoney("about a lot")).toBeNull();
    expect(budgetBand(99_999)).toBe("lt_100k");
    expect(budgetBand(1_250_000)).toBe("1m_5m");
    expect(budgetBand(10_000_000)).toBe("gt_10m");
  });

  test("facts become suggestions in the form's vocabulary, compared with the profile", () => {
    const docs = [
      doc({ id: "a", title: "990", facts: [fact("ein", "34-1234567"), fact("state", "OH"), fact("annual_budget", "$1,250,000"), fact("population", "youth aged 14 to 18")] }),
      doc({ id: "b", title: "Deck", facts: [fact("state", "OH"), fact("population", "veterans")] }),
    ];
    const profile = { ...EMPTY_PROFILE, ein: "341234567", state_code: "PA", populations: ["youth aged 14 to 18"] };
    const s = deriveEligibility(docs, profile);
    const by = (f: string) => s.find(x => x.field === f)!;
    expect(by("ein").compare).toBe("matches");
    expect(by("state_code").compare).toBe("differs");
    expect(by("state_code").values[0].sources).toHaveLength(2);
    expect(by("budget_band").values[0].value).toBe("1m_5m");
    expect(by("budget_band").values[0].display).toBe("$1M–$5M");
    expect(by("budget_band").compare).toBe("new");
    expect(by("populations").compare).toBe("adds");
    expect(by("populations").conflicting).toBe(false);
  });

  test("two different EINs are a conflict for the client to settle", () => {
    const s = deriveEligibility([doc({ facts: [fact("ein", "34-1234567"), fact("ein", "34-7654321")] })], EMPTY_PROFILE);
    expect(s[0].conflicting).toBe(true);
  });

  test("the form's default SAM.gov answer is not treated as an answer", () => {
    const s = deriveEligibility([doc({ facts: [fact("sam_registration", "sam_uei_active")] })], EMPTY_PROFILE);
    expect(s[0].compare).toBe("new");
  });
});

describe("search profile", () => {
  test("cards and facts land in their facets, with their quotes, once each", () => {
    const facts = deriveSearchFacts([
      doc({ id: "a", cards: [card("program_model"), card("outcome_metric"), card("leadership_team")], facts: [fact("funding_need", "two more case managers"), fact("population", "veterans")] }),
      doc({ id: "b", cards: [card("program_model")] }),
    ]);
    const facets = facts.map(f => f.facet).sort();
    expect(facets).toEqual(["beneficiaries", "evidence", "need", "work"]);
    expect(facts.every(f => f.quote && f.documentId)).toBe(true);
  });
});

describe("the comparison gate", () => {
  const derived = deriveReadiness(null, [doc({ docType: "irs_990", docTypeProven: true, cards: [card("mission_values")] })]);

  test("agreements need nothing; every disagreement needs a judgement", () => {
    const rows = compareReadiness(null, k => (k === "mission" ? "covered" : "missing"), derived, new Map());
    const gate = comparisonGate(rows);
    expect(gate.disagreements).toBe(1);          // irs_990: missing today, covered now
    expect(gate.passes).toBe(false);
    const judged = compareReadiness(null, k => (k === "mission" ? "covered" : "missing"), derived,
      new Map([["irs_990", { verdict: "new_correct" as const, oldState: "missing", newState: "covered" }]]));
    expect(comparisonGate(judged).passes).toBe(true);
  });

  test("a judgement goes stale when either side changes", () => {
    const rows = compareReadiness(null, k => (k === "mission" ? "covered" : k === "irs_990" ? "thin" : "missing"), derived,
      new Map([["irs_990", { verdict: "new_correct" as const, oldState: "missing", newState: "covered" }]]));
    expect(rows.find(r => r.key === "irs_990")!.verdict).toBeNull();
  });

  test("the new read being wrong is a fix, so the gate does not pass", () => {
    const rows = compareReadiness(null, k => (k === "mission" ? "covered" : "missing"), derived,
      new Map([["irs_990", { verdict: "old_correct" as const, oldState: "missing", newState: "covered" }]]));
    const gate = comparisonGate(rows);
    expect(gate.judged).toBe(1);
    expect(gate.toFix).toBe(1);
    expect(gate.passes).toBe(false);
  });
});
