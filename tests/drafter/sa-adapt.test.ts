import { describe, expect, it } from "vitest";
import {
  adaptBudget, adaptableCopy, adaptationLive, adaptationOpen, numberedPieces, parseAdaptReply, parseAdaptation, planAdaptation, summaryLine, wordDiff,
  type SaAdaptation, type SourcePiece,
} from "@/lib/sa-adapt";

const card = (id: string, text: string, breakBefore = false): SourcePiece => ({ kind: "card", cardId: id, text, breakBefore });
const own = (text: string, breakBefore = false): SourcePiece => ({ kind: "human", cardId: null, text, breakBefore });
const bridge = (text: string): SourcePiece => ({ kind: "bridge", cardId: null, text, breakBefore: false });

// P1 = card a, (bridge), P2 = card b, P3 = your words
const source = [card("a", "We mentor 240 students a year."), bridge("That work starts early."), card("b", "Mentors meet weekly."), own("Our program at Lincoln High grows each year.", true)];
const offered = [{ id: "x", words: 6 }, { id: "y", words: 200 }];

describe("adapting a Standard Answer (Auto-Draft patch 7)", () => {
  it("numbers every piece but the bridges", () => {
    expect(numberedPieces(source)).toEqual([0, 2, 3]);
  });

  describe("reading the reply", () => {
    it("reads an order, rewrites and paragraph breaks", () => {
      const r = parseAdaptReply('{"order":["P2","C1","P1"],"rewrites":[],"breaks_before":["P1"]}', 3, 2);
      expect(r).not.toBe("keep");
      if (r && r !== "keep") {
        expect(r.order).toEqual([{ p: 2 }, { c: 1 }, { p: 1 }]);
        expect([...r.breaks!]).toEqual(["P1"]);
      }
    });
    it("reads keep", () => {
      expect(parseAdaptReply('{"keep": true}', 3, 2)).toBe("keep");
    });
    it("refuses an empty order, or one of new cards only, which would replace the Standard Answer", () => {
      expect(parseAdaptReply('{"order": []}', 3, 2)).toBeNull();
      expect(parseAdaptReply('{"order": ["C1","C2"]}', 3, 2)).toBeNull();
    });
    it("refuses a piece or card it was not shown, a repeat, or a rewrite of a piece left out", () => {
      expect(parseAdaptReply('{"order":["P4"]}', 3, 2)).toBeNull();
      expect(parseAdaptReply('{"order":["C3"]}', 3, 2)).toBeNull();
      expect(parseAdaptReply('{"order":["P1","P1"]}', 3, 2)).toBeNull();
      expect(parseAdaptReply('{"order":["P1"],"rewrites":[{"p":3,"text":"x"}]}', 3, 2)).toBeNull();
      expect(parseAdaptReply("no json", 3, 2)).toBeNull();
    });
    it("keeps the Standard Answer's own breaks when none are given", () => {
      const r = parseAdaptReply('{"order":["P1","P2","P3"]}', 3, 2);
      expect(r && r !== "keep" && r.breaks).toBeNull();
    });
  });

  describe("the plan", () => {
    const reply = (json: string) => { const r = parseAdaptReply(json, 3, 2); if (!r || r === "keep") throw new Error("bad"); return r; };

    it("is no change when the order and words are the same", () => {
      const p = planAdaptation({ source, offered, reply: reply('{"order":["P1","P2","P3"]}'), budgetWords: 500 });
      expect(p.changed).toBe(false);
      expect(p.items.map(i => (i.from === "source" ? i.index : i.cardId))).toEqual([0, 1, 2, 3]);
    });

    it("keeps a bridge only between its own two pieces, side by side", () => {
      const kept = planAdaptation({ source, offered, reply: reply('{"order":["P1","P2"]}'), budgetWords: 500 });
      expect(kept.items.map(i => (i.from === "source" ? i.index : i.cardId))).toEqual([0, 1, 2]);
      const swapped = planAdaptation({ source, offered, reply: reply('{"order":["P2","P1","P3"]}'), budgetWords: 500 });
      expect(swapped.items.map(i => (i.from === "source" ? i.index : i.cardId))).toEqual([2, 0, 3]);
      expect(swapped.summary.reordered).toBe(true);
    });

    it("counts cards added, pieces taken out and reordering", () => {
      const p = planAdaptation({ source, offered, reply: reply('{"order":["P2","C1"]}'), budgetWords: 500 });
      expect(p.summary).toEqual({ added: 1, removed: 2, reordered: false, reworded: 0 });
      expect(p.changed).toBe(true);
    });

    it("counts the length on the words that will stand, not on a rewrite it set aside", () => {
      const long = "Our program at Lincoln High " + "grows ".repeat(60);
      const p = planAdaptation({ source, offered, budgetWords: 30,
        reply: reply(`{"order":["P1","P2","P3","C1"],"rewrites":[{"p":3,"text":${JSON.stringify(long)}}]}`) });
      expect(p.refusedRewrites).toBe(1);
      expect(p.droppedForLength).toBe(0);
      expect(p.items.some(i => i.from === "card")).toBe(true);
    });

    it("drops added cards from the end while over the budget, never the Standard Answer's own pieces", () => {
      const p = planAdaptation({ source, offered, reply: reply('{"order":["C2","P1","P2","P3"]}'), budgetWords: 30 });
      expect(p.droppedForLength).toBe(1);
      expect(p.items.some(i => i.from === "card")).toBe(false);
    });

    it("rewords the writer's own words when the facts stay the same", () => {
      const p = planAdaptation({ source, offered, budgetWords: 500,
        reply: reply('{"order":["P1","P2","P3"],"rewrites":[{"p":3,"text":"Our program at Lincoln High keeps growing."}]}') });
      expect(p.summary.reworded).toBe(1);
      expect(p.items[3]).toMatchObject({ from: "source", index: 3, text: "Our program at Lincoln High keeps growing." });
    });

    it("sets aside new wording that adds a number or a name, or rewords a Story Card", () => {
      const num = planAdaptation({ source, offered, budgetWords: 500,
        reply: reply('{"order":["P1","P2","P3"],"rewrites":[{"p":3,"text":"Our program at Lincoln High grew 40% last year."}]}') });
      expect(num.summary.reworded).toBe(0);
      expect(num.refusedRewrites).toBe(1);
      const name = planAdaptation({ source, offered, budgetWords: 500,
        reply: reply('{"order":["P1","P2","P3"],"rewrites":[{"p":3,"text":"Our program at Lincoln High, funded by Kresge, grows."}]}') });
      expect(name.refusedRewrites).toBe(1);
      const cardRewrite = planAdaptation({ source, offered, budgetWords: 500,
        reply: reply('{"order":["P1","P2","P3"],"rewrites":[{"p":1,"text":"We mentor students."}]}') });
      expect(cardRewrite.summary.reworded).toBe(0);
      expect(cardRewrite.refusedRewrites).toBe(1);
    });

    it("never starts the answer with a paragraph break", () => {
      const p = planAdaptation({ source, offered, reply: reply('{"order":["P3","P1"],"breaks_before":["P3","P1"]}'), budgetWords: 500 });
      expect(p.items[0].breakBefore).toBe(false);
      expect(p.items[1].breakBefore).toBe(true);
    });
  });

  describe("the record on the question", () => {
    const rec: SaAdaptation = { fromSectionId: "sa1", state: "open", adaptedAt: "2026-10-14T00:00:00Z",
      summary: { added: 1, removed: 0, reordered: true, reworded: 0 }, original: [] };
    it("reads back what was stored, and nothing malformed", () => {
      expect(parseAdaptation(rec)?.state).toBe("open");
      expect(parseAdaptation({ ...rec, state: "maybe" })).toBeNull();
      expect(parseAdaptation(null)).toBeNull();
    });
    it("is open only while unchosen and the answer still holds a piece auto-draft placed", () => {
      const r = { ...rec, blockIds: ["b1", "b2"] };
      expect(adaptationOpen(r, ["b1", "z"])).toBe(true);
      expect(adaptationOpen(r, [])).toBe(false);
      expect(adaptationOpen(r, ["new1", "new2"])).toBe(false);
      expect(adaptationOpen({ ...r, state: "kept" }, ["b1"])).toBe(false);
      expect(adaptationLive({ ...r, state: "kept" }, ["b1"])).toBe(true);
    });
    it("is open again after Go back is undone, bringing the adapted pieces back", () => {
      const r = { ...rec, state: "reverted" as const, blockIds: ["b1"] };
      expect(adaptationOpen(r, ["o1", "o2"])).toBe(false);
      expect(adaptationOpen(r, ["b1"])).toBe(true);
    });
    it("adapts only a copy that Go back could restore", () => {
      expect(adaptableCopy([{ kind: "card", card_id: "a" }, { kind: "human", card_id: null }], 200)).toBe(true);
      expect(adaptableCopy([{ kind: "card", card_id: "a" }, { kind: "card", card_id: "a" }], 200)).toBe(false);
      expect(adaptableCopy([], 200)).toBe(false);
      expect(adaptableCopy(Array(3).fill({ kind: "human", card_id: null }), 2)).toBe(false);
    });
    it("says what changed in a line", () => {
      expect(summaryLine({ added: 2, removed: 1, reordered: true, reworded: 1 })).toBe("2 cards added, 1 piece taken out, reordered, your words reworded");
    });
  });

  it("holds an adapted answer to the funder's limit, or near the Standard Answer's length with none", () => {
    expect(adaptBudget(250, "words", 400)).toBe(250);
    expect(adaptBudget(1200, "characters", 400)).toBe(200);
    expect(adaptBudget(null, null, 200)).toBe(340);
  });

  it("compares two answers word by word", () => {
    expect(wordDiff("We mentor students weekly.", "We mentor teens weekly.")).toEqual([
      { kind: "same", text: "We mentor " }, { kind: "del", text: "students" }, { kind: "add", text: "teens" }, { kind: "same", text: " weekly." },
    ]);
  });
});
