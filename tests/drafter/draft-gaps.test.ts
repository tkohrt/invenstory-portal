import { describe, expect, test } from "vitest";
import { askDraft, askProblem, draftProgress, questionGaps, type GapAsk } from "@/lib/draft-gaps";

const cards = [
  { id: "c1", kind: "program_model", status: "verified", placeable: true },
  { id: "c2", kind: "outcome_metric", status: "suggested", placeable: true },
  { id: "c3", kind: "outcome_metric", status: "retired", placeable: true },
  { id: "c4", kind: "need_story", status: "verified", placeable: false },
  { id: "c9", kind: "finance_budget", status: "verified", placeable: true },
];
const ask = (over: Partial<GapAsk>): GapAsk => ({
  id: "a1", sectionId: "s1", kind: "finance_budget", question: "Tell us about your budget, with figures.",
  status: "open", answer: null, cardId: null, askedAt: "2026-10-09T12:00:00Z", answeredAt: null, ...over,
});

describe("the gap panel", () => {
  test("each kind the question calls for, and where it stands", () => {
    const rows = questionGaps({
      sectionId: "s1",
      wantedKinds: ["program_model", "outcome_metric", "need_story", "leadership_team", "program_model"],
      blocks: [{ kind: "card", cardId: "c1" }, { kind: "human", cardId: null }],
      cards, asks: [],
    });
    expect(rows.map(r => [r.kind, r.state, r.inLibrary])).toEqual([
      ["program_model", "in_answer", 0],
      ["outcome_metric", "in_library", 1], // the retired one does not count
      ["need_story", "none", 0], // sensitive and undecided: not on offer
      ["leadership_team", "none", 0],
    ]);
  });

  test("a question to the client, waiting and then answered", () => {
    const base = { sectionId: "s1", wantedKinds: ["finance_budget"], blocks: [], cards: cards.filter(c => c.id !== "c9") };
    expect(questionGaps({ ...base, asks: [ask({})] })[0].state).toBe("asked");
    expect(questionGaps({ ...base, asks: [ask({ status: "withdrawn" })] })[0].state).toBe("none");
    expect(questionGaps({ ...base, asks: [ask({ sectionId: "other" })] })[0].state).toBe("none");
    const answered = ask({ status: "answered", answer: "Our budget is $400,000.", cardId: "c9" });
    expect(questionGaps({ ...base, cards, asks: [answered] })[0].state).toBe("answered");
    // Once the client's card is in the answer, it is simply in the answer.
    expect(questionGaps({ ...base, cards, blocks: [{ kind: "card", cardId: "c9" }], asks: [answered] })[0].state).toBe("in_answer");
  });

  test("the question to the client, ready to edit", () => {
    const q = askDraft("Describe your organization's budget and how this grant fits.", "Finances", "its budget, revenue, costs or funding, with figures");
    expect(q).toContain("finances in your own words: its budget");
    expect(q).not.toContain("—");
    expect(askDraft("x ".repeat(200), "Finances", "d").length).toBeLessThan(260);
    expect(askProblem("short")).toMatch(/Write/);
    expect(askProblem(q)).toBeNull();
  });

  test("the progress strip counts across the application", () => {
    const sections = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    const p = draftProgress({
      sections,
      blocksBy: { s1: [{ kind: "card", proposed: false }], s2: [{ kind: "bridge", proposed: true }, { kind: "bridge", proposed: true }], s3: [{ kind: "card", proposed: false }] },
      statusBy: { s1: "done", s2: "drafting", s3: "drafting" },
      toReview: 2,
      figuresIn: (sid) => (sid === "s3" ? 1 : 0),
      gapsBy: { s1: [], s2: [{ kind: "x", state: "asked", inLibrary: 0, ask: null }], s3: [{ kind: "y", state: "answered", inLibrary: 0, ask: null }] },
    });
    expect(p).toMatchObject({ questions: 3, done: 1, toReview: 2, bridgesWaiting: 2, figuresToTrace: 1, asksOpen: 1, answersReady: 1, firstBridge: 1, firstFigure: 2, firstAsk: 1 });
  });
});
