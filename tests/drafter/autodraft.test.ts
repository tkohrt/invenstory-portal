import { describe, expect, it } from "vitest";
import { arrangeUser, fitToBudget, parseArrangeReply, planRun, shortlist, stageBlocks } from "@/lib/autodraft";
import type { Ranked } from "@/lib/story-card-rank";

const r = (id: string, kind: string, position: number, status: "suggested" | "verified" | "retired" = "verified"): Ranked => ({
  card: { id, kind, itemKey: null, strength: "covered", status, layer: "II", statement: `${id} statement`, newestEvidenceAt: null },
  score: 100 - position, parts: {} as Ranked["parts"], position,
});

describe("auto-draft (Auto-Draft patch 6)", () => {
  describe("which questions a run touches", () => {
    const sections = [
      { id: "s1", status: "empty", pieces: 0, standardAnswerSectionId: "sa1" },
      { id: "s2", status: "drafting", pieces: 2, standardAnswerSectionId: "sa2" },
      { id: "s3", status: "done", pieces: 3 },
      { id: "s4", status: "empty", pieces: 0 },
    ];
    it("starts an empty answer from its approved Standard Answer, and arranges the rest", () => {
      const p = planRun({ purpose: "application", sections });
      expect(p.run).toEqual([{ id: "s1", start: "standard_answer" }, { id: "s2", start: "arrange" }, { id: "s4", start: "arrange" }]);
    });
    it("leaves a question marked done alone", () => {
      expect(planRun({ purpose: "application", sections }).skipped).toEqual([{ id: "s3", reason: "done" }]);
    });
    it("never copies a Standard Answer over an answer already started", () => {
      expect(planRun({ purpose: "application", sections }).run.find(x => x.id === "s2")?.start).toBe("arrange");
    });
    it("in the Standard Answers draft, treats approved questions as sources and arranges the rest", () => {
      const p = planRun({ purpose: "standard_answers", sections: [
        { id: "a", status: "drafting", pieces: 3, approved: true },
        { id: "b", status: "empty", pieces: 0, standardAnswerSectionId: "x" },
      ] });
      expect(p.skipped).toEqual([{ id: "a", reason: "approved" }]);
      expect(p.run).toEqual([{ id: "b", start: "arrange" }]);
    });
    it("runs one question only, for the per-question button", () => {
      const p = planRun({ purpose: "application", sections, only: "s4" });
      expect(p.run).toEqual([{ id: "s4", start: "arrange" }]);
      expect(p.skipped).toEqual([]);
    });
  });

  describe("the shortlist", () => {
    const ranked = [r("a", "need", 1), r("b", "need", 2), r("c", "outcome", 3, "suggested"), r("d", "program", 4), r("e", "outcome", 5)];
    it("puts the best card of each wanted kind in, then the next best, in rank order", () => {
      const s = shortlist(ranked, { wantedKinds: ["outcome", "program"], inAnswer: new Set(), usedInDraft: new Set(), size: 3 });
      expect(s.map(x => x.card.id)).toEqual(["a", "c", "d"]);
    });
    it("offers cards that still need review, since the run may place them", () => {
      const s = shortlist(ranked, { wantedKinds: [], inAnswer: new Set(), usedInDraft: new Set() });
      expect(s.map(x => x.card.id)).toContain("c");
    });
    it("never offers a card already in this answer or elsewhere in the draft, or a retired one", () => {
      const s = shortlist([...ranked, r("z", "need", 6, "retired")], { wantedKinds: [], inAnswer: new Set(["a"]), usedInDraft: new Set(["b"]) });
      expect(s.map(x => x.card.id)).toEqual(["c", "d", "e"]);
    });
  });

  describe("reading the model's choice", () => {
    it("reads an order and paragraph breaks", () => {
      expect(parseArrangeReply('Here: {"order": [3, 1, 5], "breaks_before": [5]}', 6)).toEqual({ order: [3, 1, 5], breaksBefore: [5] });
    });
    it("accepts no cards at all", () => {
      expect(parseArrangeReply('{"order": []}', 6)).toEqual({ order: [], breaksBefore: [] });
    });
    it("drops a break on the first card or on a card not chosen", () => {
      expect(parseArrangeReply('{"order": [2, 4], "breaks_before": [2, 6, 4]}', 6)).toEqual({ order: [2, 4], breaksBefore: [4] });
    });
    it("refuses a number off the list, a repeat, or something that is not a choice", () => {
      expect(parseArrangeReply('{"order": [1, 7]}', 6)).toBeNull();
      expect(parseArrangeReply('{"order": [1, 1]}', 6)).toBeNull();
      expect(parseArrangeReply('{"order": [1.5]}', 6)).toBeNull();
      expect(parseArrangeReply('{"text": "a new paragraph"}', 6)).toBeNull();
      expect(parseArrangeReply("no json here", 6)).toBeNull();
    });
  });

  describe("holding the choice to the length", () => {
    it("places cards in order while they fit", () => {
      expect(fitToBudget([40, 50, 60], 0, 100)).toBe(2);
    });
    it("always places the first card into an empty answer", () => {
      expect(fitToBudget([150, 20], 0, 100)).toBe(1);
    });
    it("counts what the answer already holds, and may place nothing", () => {
      expect(fitToBudget([30], 90, 100)).toBe(0);
    });
    it("places at most eight", () => {
      expect(fitToBudget(Array(12).fill(1), 0, 1000)).toBe(8);
    });
  });

  describe("the Weave and Polish gate", () => {
    it("stops on anything at the finish line before a draft is auto-drafted", () => {
      for (const i of ["unverified", "sensitive", "retired", "reworded"] as const) expect(stageBlocks(i, false)).toBe(true);
    });
    it("once auto-drafted, stops only on a retired card", () => {
      expect(stageBlocks("retired", true)).toBe(true);
      for (const i of ["unverified", "sensitive", "reworded"] as const) expect(stageBlocks(i, true)).toBe(false);
      expect(stageBlocks(null, true)).toBe(false);
    });
  });

  it("builds a prompt that sends only what is given, trimmed", () => {
    const u = arrangeUser({
      question: "Describe   your program.", guidance: null, limit: { value: 250, unit: "words" }, budgetWords: 200,
      wantedKindLabels: ["Program model"], existing: [], voiceProfile: "", application: "", clientContext: "",
      funderContext: "x".repeat(7000),
      cards: [{ n: 1, kindLabel: "Program model", layer: "II", words: 3, text: "We teach coding." }],
    });
    expect(u).toContain("<question>\nDescribe your program.\n</question>");
    expect(u).toContain("1. [Program model, Layer II, 3 words] We teach coding.");
    expect(u).not.toContain("<voice_profile>");
    expect(u).not.toContain("<client_context>");
    expect(u).toMatch(/<funder_context>\nx{6000}…\n<\/funder_context>/);
  });
});
