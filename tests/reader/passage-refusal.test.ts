// "This passage does not support the card" (Document Reader, 0070): a refusal
// that belongs to one card, applied by the Card Library merge and ignored by
// every filter that refuses a quote for every card.
import { describe, expect, test } from "vitest";
import { planMerge, type MergeCard, type MergeCandidate } from "@/lib/card-merge";
import { cardFingerprint } from "@/lib/story-card";
import { passageRefusedFor, withoutRefused, dropRefusedCards, refusalFor, indexRefusals, type Refusal } from "@/lib/refusal";

const STMT = "In 2025 the Collective served 1,240 students across 9 partner sites.";
const QUOTE = "In 2025 we served 1,240 students across 9 partner sites";

const cand = (o: Partial<MergeCandidate> = {}): MergeCandidate => ({
  kind: "outcome_metric", statement: STMT, quote: QUOTE, subject: "organization",
  strength: "covered", hasFigures: true, speaker: null, layer: "II", ...o,
});
const card = (o: Partial<MergeCard> = {}): MergeCard => ({
  id: "c1", kind: "outcome_metric", statement: STMT, fingerprint: cardFingerprint("outcome_metric", STMT),
  status: "suggested", retired_reason: null, merged_into: null, created_from: "extraction",
  created_at: "2026-09-01", duplicate_dismissed: false, possible_duplicate_of: null,
  strength: "covered", layer: "II", has_figures: true, subject: "organization", ...o,
});
const passage = (o: Partial<Refusal> = {}): Refusal => ({
  id: "r1", source: "passage", sourceRef: "c1", documentId: "d1", kind: "outcome_metric",
  statement: STMT, quote: QUOTE, createdAt: "2026-10-17", ...o,
});

describe("the merge", () => {
  test("a refused passage is not attached to its card again; the card's other source stays", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand()] }, { documentId: "d2", candidates: [cand()] }],
      cards: [card()],
      evidence: [{ id: "e2", card_id: "c1", document_id: "d2", quote: QUOTE }],
      passageRefused: passageRefusedFor([passage()]),
    });
    expect(p.evidence.map(e => `${e.target}|${e.documentId}`)).toEqual(["c1|d2"]);
    expect(p.create).toHaveLength(0);
    expect(p.dropEvidence).toHaveLength(0);
  });

  test("a card whose only passage was refused stays retired and is not re-created as a twin", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand()] }],
      cards: [card({ status: "retired", retired_reason: "source_removed" })],
      evidence: [],
      passageRefused: passageRefusedFor([passage()]),
    });
    expect(p.create).toHaveLength(0);
    expect(p.evidence).toHaveLength(0);
    expect(p.update).toHaveLength(0);
  });

  test("it comes back, as suggested, if another document supports it", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand()] }, { documentId: "d3", candidates: [cand()] }],
      cards: [card({ status: "retired", retired_reason: "source_removed" })],
      evidence: [],
      passageRefused: passageRefusedFor([passage()]),
    });
    expect(p.evidence.map(e => e.documentId)).toEqual(["d3"]);
    expect(p.update[0].patch.status).toBe("suggested");
  });

  test("a card in use keeps its other evidence but not the refused passage", () => {
    const p = planMerge({
      docs: [], cards: [card({ status: "verified" })],
      evidence: [{ id: "e1", card_id: "c1", document_id: "d1", quote: QUOTE }, { id: "e2", card_id: "c1", document_id: "d2", quote: "Another sentence that supports it fully." }],
      inUse: new Set(["c1"]),
      passageRefused: passageRefusedFor([passage()]),
    });
    expect(p.dropEvidence).toEqual(["e1"]);
  });

  test("another card may still use the same passage", () => {
    const other = card({ id: "c2", kind: "program_model", statement: "The Collective runs nine partner sites.", fingerprint: cardFingerprint("program_model", "The Collective runs nine partner sites.") });
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand({ kind: "program_model", statement: "The Collective runs nine partner sites." })] }],
      cards: [other],
      evidence: [],
      passageRefused: passageRefusedFor([passage()]),
    });
    expect(p.evidence.map(e => `${e.target}|${e.documentId}`)).toEqual(["c2|d1"]);
  });
});

describe("the filters that refuse a quote for every card ignore a passage refusal", () => {
  test("withoutRefused, dropRefusedCards and refusalFor", () => {
    const docs = [{ documentId: "d1", cards: [{ quote: QUOTE }] }];
    expect(withoutRefused(docs, [passage()]).docs[0].cards).toHaveLength(1);
    expect(dropRefusedCards([{ id: "d1", cards: [{ quote: QUOTE }] }], [passage()])[0].cards).toHaveLength(1);
    expect(refusalFor(QUOTE, indexRefusals([passage()]))).toBeNull();
    // ...while a library refusal of the same quote still refuses it everywhere.
    expect(withoutRefused(docs, [passage({ source: "library" })]).docs[0].cards).toHaveLength(0);
  });

  test("a passage refusal is matched only for its card and its document", () => {
    const f = passageRefusedFor([passage()]);
    expect(f("c1", "d1", QUOTE)).toBe(true);
    expect(f("c1", "d1", `${QUOTE}.`)).toBe(true);
    expect(f("c2", "d1", QUOTE)).toBe(false);
    expect(f("c1", "d9", QUOTE)).toBe(false);
  });
});
