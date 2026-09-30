/**
 * planMerge decides what a Card Library rebuild may do to cards people have
 * already reviewed. The rules here are what make verification worth doing: a
 * rebuild must never un-verify, rewrite, delete or silently duplicate a card.
 */
import { describe, expect, test } from "vitest";
import { planMerge, NEW, type MergeCard, type MergeCandidate } from "@/lib/card-merge";
import { cardFingerprint } from "@/lib/story-card";

const STMT = "In 2025 the Collective served 1,240 students across 9 partner sites.";
const QUOTE = "In 2025 we served 1,240 students across 9 partner sites";

const cand = (o: Partial<MergeCandidate> = {}): MergeCandidate => ({
  kind: "outcome_metric", statement: STMT, quote: QUOTE, subject: "organization",
  strength: "covered", hasFigures: true, speaker: null, layer: "II", ...o,
});

const card = (o: Partial<MergeCard> = {}): MergeCard => ({
  id: "c1", kind: "outcome_metric", statement: STMT, fingerprint: cardFingerprint("outcome_metric", STMT),
  status: "verified", retired_reason: null, merged_into: null, created_from: "extraction",
  created_at: "2026-09-01", duplicate_dismissed: false, possible_duplicate_of: null,
  strength: "covered", layer: "II", has_figures: true, subject: "organization", ...o,
});

describe("planMerge", () => {
  test("a new claim becomes a suggested card, never a verified one", () => {
    const p = planMerge({ docs: [{ documentId: "d1", candidates: [cand()] }], cards: [], evidence: [] });
    expect(p.create).toHaveLength(1);
    expect(p.create[0].patch.status).toBe("suggested");
    expect(p.evidence[0].target).toBe(NEW + p.create[0].fingerprint);
    expect(p.summary.created).toBe(1);
  });

  test("the same claim in two documents is one card with two pieces of evidence", () => {
    const p = planMerge({
      docs: [
        { documentId: "d1", candidates: [cand()] },
        { documentId: "d2", candidates: [cand({ statement: "The Collective served 1,240 students across 9 partner sites in 2025.", layer: "III" })] },
      ],
      cards: [], evidence: [],
    });
    expect(p.create).toHaveLength(1);
    expect(p.evidence).toHaveLength(2);
    expect(p.create[0].patch.layer).toBe("III");
  });

  test("a verified card found again stays verified and untouched", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand()] }],
      cards: [card()],
      evidence: [{ id: "e1", card_id: "c1", document_id: "d1", quote: QUOTE }],
    });
    expect(p.create).toHaveLength(0);
    expect(p.update).toHaveLength(0);
    expect(p.dropEvidence).toHaveLength(0);
  });

  test("a reworded claim with the same proof stays the same card", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand({ statement: "The Collective reached 1,240 young learners at 9 partner locations during 2025." })] }],
      cards: [card()],
      evidence: [{ id: "e1", card_id: "c1", document_id: "d1", quote: QUOTE }],
    });
    expect(p.create).toHaveLength(0);
    expect(p.evidence).toEqual([{ target: "c1", documentId: "d1", quote: QUOTE, speaker: null }]);
    expect(p.update).toHaveLength(0);
  });

  test("the same proof under a different kind is not borrowed", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand({ kind: "capacity_track_record", statement: "The Collective has reached 1,240 students at 9 sites." })] }],
      cards: [card()],
      evidence: [{ id: "e1", card_id: "c1", document_id: "d1", quote: QUOTE }],
    });
    expect(p.create).toHaveLength(1);
  });

  test("a card whose evidence is gone is retired, not deleted", () => {
    const p = planMerge({
      docs: [], cards: [card()],
      evidence: [{ id: "e1", card_id: "c1", document_id: "d1", quote: QUOTE }],
    });
    expect(p.update).toEqual([expect.objectContaining({ id: "c1", patch: expect.objectContaining({ status: "retired", retired_reason: "source_removed" }) })]);
    expect(p.dropEvidence).toEqual(["e1"]);
    expect(p.summary.retired).toBe(1);
  });

  test("and comes back as suggested when its evidence returns", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand()] }],
      cards: [card({ status: "retired", retired_reason: "source_removed" })],
      evidence: [],
    });
    expect(p.update[0].patch.status).toBe("suggested");
    expect(p.summary.revived).toBe(1);
  });

  test("a card a person retired stays retired whatever the documents say", () => {
    for (const reason of ["inaccurate", "superseded"]) {
      const p = planMerge({
        docs: [{ documentId: "d1", candidates: [cand()] }],
        cards: [card({ status: "retired", retired_reason: reason })],
        evidence: [],
      });
      expect(p.create).toHaveLength(0);
      const patch = p.update.find(u => u.id === "c1")?.patch;
      expect(patch?.status ?? "retired").toBe("retired");
    }
  });

  test("a merged card forwards its evidence to the card it was merged into", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand()] }],
      cards: [
        card({ id: "src", status: "retired", retired_reason: "merged", merged_into: "dst" }),
        card({ id: "dst", fingerprint: "other", statement: "Served 1,240 students across nine sites in the 2025 school year." }),
      ],
      evidence: [],
    });
    expect(p.create).toHaveLength(0);
    expect(p.evidence).toEqual([expect.objectContaining({ target: "dst", documentId: "d1" })]);
    expect(p.update.find(u => u.id === "src")).toBeUndefined();
  });

  test("a merge cycle written by hand does not hang", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand()] }],
      cards: [card({ id: "a", merged_into: "b" }), card({ id: "b", fingerprint: "x", merged_into: "a" })],
      evidence: [],
    });
    expect(p.evidence).toHaveLength(1);
  });

  test("a manual or gap card without evidence is not retired by a rebuild", () => {
    const p = planMerge({ docs: [], cards: [card({ created_from: "manual" })], evidence: [] });
    expect(p.update).toHaveLength(0);
  });

  test("derived fields follow the evidence", () => {
    const p = planMerge({
      docs: [{ documentId: "d1", candidates: [cand({ strength: "thin", hasFigures: false, layer: "I" })] }],
      cards: [card({ strength: "covered", has_figures: true, layer: "II" })],
      evidence: [],
    });
    expect(p.update[0].patch).toEqual(expect.objectContaining({ strength: "thin", has_figures: false, layer: "I", status: "verified" }));
  });

  test("a near-duplicate new card is flagged against the existing one, never merged", () => {
    const OLD = "Weekly outdoor learning sessions for third graders at nature centers.";
    const p = planMerge({
      docs: [
        { documentId: "d1", candidates: [cand({ kind: "program_model", statement: OLD, quote: "weekly outdoor learning sessions for third graders at nature centers" })] },
        { documentId: "d2", candidates: [cand({
        kind: "program_model", statement: "Weekly outdoor learning sessions for third graders at partner nature centers.",
        quote: "weekly outdoor learning sessions for third graders at partner nature centers",
      })] },
      ],
      cards: [card({
        id: "old", kind: "program_model", statement: "Weekly outdoor learning sessions for third graders at nature centers.",
        fingerprint: cardFingerprint("program_model", "Weekly outdoor learning sessions for third graders at nature centers."),
      })],
      evidence: [],
    });
    expect(p.create).toHaveLength(1);
    expect(p.create[0].patch.possible_duplicate_of).toBe("old");
  });

  test("unknown kinds in stored candidates are ignored", () => {
    const p = planMerge({ docs: [{ documentId: "d1", candidates: [cand({ kind: "gossip" })] }], cards: [], evidence: [] });
    expect(p.create).toHaveLength(0);
  });
});
