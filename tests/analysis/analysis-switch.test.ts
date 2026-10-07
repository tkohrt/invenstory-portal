// Phase D: switching a client over to the analysis (decision 29).
import { describe, expect, test } from "vitest";
import { isOnAnalysis, switchGate, coverageFromDerived, describeLibraryChange, arrivalPlan, PROVING_TENANT_ID } from "@/lib/analysis-switch";
import { planMerge, type MergeCard } from "@/lib/card-merge";
import { cardFingerprint } from "@/lib/story-card";

const OTHER = "a89dd30f-bc2a-40b4-98ec-c43a55fb5b6d";
const proof = "2026-10-08T12:00:00Z";

describe("who is on the analysis", () => {
  test("switched by hand", () => {
    expect(isOnAnalysis({ switched_at: "2026-10-09T00:00:00Z", switched_off_at: null }, "2026-01-01T00:00:00Z", null)).toBe(true);
  });
  test("a client created after the proof starts on it; one created before does not", () => {
    expect(isOnAnalysis(null, "2026-10-20T00:00:00Z", proof)).toBe(true);
    expect(isOnAnalysis(null, "2026-09-01T00:00:00Z", proof)).toBe(false);
  });
  test("no proof yet: nobody is on it unless switched", () => {
    expect(isOnAnalysis(null, "2026-10-20T00:00:00Z", null)).toBe(false);
  });
  test("switched back stays back, even for a client created after the proof", () => {
    expect(isOnAnalysis({ switched_at: null, switched_off_at: "2026-10-21T00:00:00Z" }, "2026-10-20T00:00:00Z", proof)).toBe(false);
  });
});

describe("the gate", () => {
  const passing = {
    review: { passes: true, reviewed: 100, target: 100, supportedPct: 93 },
    compare: { passes: true, disagreements: 4, judged: 4, toFix: 0 },
  };

  test("RE-Assist switches only when its own review and Compare pass", () => {
    expect(switchGate({ tenantId: PROVING_TENANT_ID, pendingDocs: 0, analysedDocs: 15, proofAt: null, ...passing }).allowed).toBe(true);
    const r = switchGate({ tenantId: PROVING_TENANT_ID, pendingDocs: 0, analysedDocs: 15, proofAt: null,
      review: { passes: false, reviewed: 61, target: 100, supportedPct: 88 }, compare: { passes: false, disagreements: 6, judged: 0, toFix: 0 } });
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(" ")).toContain("61 of 100 reviewed");
    expect(r.reasons.join(" ")).toContain("0 of 6 disagreements judged");
  });

  test("a judgement that the new read is wrong blocks RE-Assist", () => {
    const r = switchGate({ tenantId: PROVING_TENANT_ID, pendingDocs: 0, analysedDocs: 15, proofAt: null,
      review: passing.review, compare: { passes: false, disagreements: 4, judged: 4, toFix: 1 } });
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(" ")).toContain("fix those first");
  });

  test("every other client needs only RE-Assist's proof, no review of its own", () => {
    expect(switchGate({ tenantId: OTHER, pendingDocs: 0, analysedDocs: 5, proofAt: null }).allowed).toBe(false);
    expect(switchGate({ tenantId: OTHER, pendingDocs: 0, analysedDocs: 5, proofAt: proof }).allowed).toBe(true);
  });

  test("everything must be analysed first, for every client", () => {
    expect(switchGate({ tenantId: OTHER, pendingDocs: 2, analysedDocs: 5, proofAt: proof }).reasons[0]).toContain("2 documents are still waiting");
    expect(switchGate({ tenantId: OTHER, pendingDocs: 0, analysedDocs: 0, proofAt: proof }).allowed).toBe(false);
  });
});

describe("readiness in eligibility_gap's shape", () => {
  test("states and sources, one source per document, none for a missing item", () => {
    const cov = coverageFromDerived([
      { key: "mission", state: "covered", why: "", sources: [
        { id: "d1", title: "Deck", quote: "Our mission is...", via: "card" },
        { id: "d1", title: "Deck", quote: "Again", via: "card" },
        { id: "d2", title: "990", via: "type" },
      ] },
      { key: "budget", state: "missing", why: "", sources: [{ id: "d3", title: "x", via: "fact" }] },
    ]);
    expect(cov.mission).toEqual({ state: "covered", sources: [{ id: "d1", title: "Deck", quote: "Our mission is..." }, { id: "d2", title: "990" }] });
    expect(cov.budget).toEqual({ state: "missing", sources: [] });
  });
});

describe("what the switch would do to the library", () => {
  const card = (id: string, statement: string, over: Partial<MergeCard> = {}): MergeCard => ({
    id, kind: "program_model", statement, fingerprint: cardFingerprint("program_model", statement), status: "suggested",
    retired_reason: null, merged_into: null, created_from: "extraction", created_at: "2026-10-01T00:00:00Z",
    duplicate_dismissed: false, possible_duplicate_of: null, strength: "covered", layer: "II", has_figures: false, subject: "organization", ...over,
  });
  test("cards the analysis also finds are kept; others retire; retiring cards in use are named", () => {
    const cards = [card("c1", "RE-Assist coordinates care after discharge."), card("c2", "RE-Assist runs a call centre."), card("c3", "RE-Assist trains nurses.")];
    const plan = planMerge({
      docs: [{ documentId: "d1", candidates: [
        { kind: "program_model", statement: "RE-Assist coordinates care after discharge.", quote: "coordinates care after discharge", subject: "organization", strength: "covered" },
        { kind: "program_model", statement: "RE-Assist pairs patients with a care navigator.", quote: "pairs patients with a care navigator", subject: "organization", strength: "covered" },
      ] }],
      cards, evidence: [],
    });
    const ch = describeLibraryChange(plan, cards, { placed: new Set(["c2"]), verified: new Set(["c2", "c3"]), edited: new Set() });
    expect(ch).toMatchObject({ created: 1, kept: 1, retired: 2 });
    expect(ch.retiringInUse.map(c => [c.id, c.why])).toEqual([["c2", ["placed in a draft", "verified"]], ["c3", ["verified"]]]);
  });

  test("a card in use that the analysis does not find keeps the evidence it has, instead of retiring", () => {
    const cards = [card("c2", "RE-Assist runs a call centre."), card("c3", "RE-Assist trains nurses.")];
    const evidence = [
      { id: "e2", card_id: "c2", document_id: "d1", quote: "we run a call centre for discharged patients" },
      { id: "e3", card_id: "c3", document_id: "gone", quote: "we train nurses" },
    ];
    const docs = [{ documentId: "d1", candidates: [
      { kind: "program_model", statement: "RE-Assist pairs patients with a care navigator.", quote: "pairs patients with a care navigator", subject: "organization" as const, strength: "covered" as const },
    ] }];
    const plan = planMerge({
      docs, cards, evidence, inUse: new Set(["c2", "c3"]),
      // c3's only evidence is from a document no longer in the Inven(s)tory.
      evidenceStillGood: e => e.document_id !== "gone",
    });
    expect(plan.update.find(u => u.id === "c2")).toBeUndefined();          // unchanged, still live
    expect(plan.update.find(u => u.id === "c3")?.patch.status).toBe("retired");
    expect(plan.dropEvidence).toEqual(["e3"]);
    const ch = describeLibraryChange(plan, cards, { placed: new Set(["c2"]), verified: new Set(["c3"]), edited: new Set() });
    expect(ch.keptOnOldEvidence.map(c => c.id)).toEqual(["c2"]);
    expect(ch.retiringInUse.map(c => c.id)).toEqual(["c3"]);
  });
});

describe("read on upload", () => {
  const base = { onAnalysis: true, pendingDocs: 1, actor: "client" as const, readsToday: 0, uploadReadsPerDay: 30, running: false };
  test("a client not on the analysis keeps the old upload read", () => {
    expect(arrivalPlan({ ...base, onAnalysis: false })).toBe("not_on_analysis");
  });
  test("an upload with nothing new to read starts nothing", () => {
    expect(arrivalPlan({ ...base, pendingDocs: 0 })).toBe("nothing_new");
  });
  test("a new document starts a run, or joins the one going", () => {
    expect(arrivalPlan(base)).toBe("start");
    expect(arrivalPlan({ ...base, running: true })).toBe("join");
  });
  test("past 30 reads a day a client's read waits; For Granted's never does", () => {
    expect(arrivalPlan({ ...base, readsToday: 30 })).toBe("deferred");
    expect(arrivalPlan({ ...base, actor: "admin", readsToday: 99 })).toBe("start");
  });
});
