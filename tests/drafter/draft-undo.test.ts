import { describe, expect, test } from "vitest";
import { planRestore, pushUndo, restoreProblem, sameState, undoState, UNDO_DEPTH, type StoredBlock, type UndoBlock } from "@/lib/draft-undo";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const card = (n: number, c: number, extra: Partial<UndoBlock> = {}): UndoBlock => ({
  id: id(n), kind: "card", cardId: id(100 + c), cardVersion: 1, text: null, edited: false, breakBefore: false, proposed: false, ...extra,
});
const stored = (b: UndoBlock, i: number): StoredBlock => ({
  id: b.id, kind: b.kind, card_id: b.cardId, card_version: b.cardVersion, text: b.text,
  edited: b.edited, break_before: b.breakBefore, proposed: b.proposed, sort_order: i,
});

describe("Undo for everything", () => {
  test("remembers what is stored, leaving out blocks still being saved", () => {
    const s = undoState([
      { id: "tmp-x", kind: "card", cardId: id(101), cardVersion: 1, ownText: null, edited: false, breakBefore: false, proposed: false },
      { id: id(2), kind: "bridge", cardId: null, cardVersion: null, ownText: "And so", edited: false, breakBefore: false, proposed: true },
      { id: id(3), kind: "human", cardId: null, cardVersion: null, ownText: "Mine", edited: false, breakBefore: true, proposed: true },
    ]);
    expect(s.map(b => b.id)).toEqual([id(2), id(3)]);
    expect(s[0].proposed).toBe(true);
    expect(s[1].proposed).toBe(false); // only bridges are ever proposed
  });

  test("keeps at most UNDO_DEPTH changes and skips a repeat", () => {
    let list: { label: string; state: UndoBlock[] }[] = [];
    for (let i = 0; i < UNDO_DEPTH + 5; i++) list = pushUndo(list, { label: `c${i}`, state: [card(1, i)] });
    expect(list).toHaveLength(UNDO_DEPTH);
    expect(list[list.length - 1].label).toBe(`c${UNDO_DEPTH + 4}`);
    const again = pushUndo(list, { label: "same", state: [card(1, UNDO_DEPTH + 4)] });
    expect(again).toBe(list);
    expect(sameState([card(1, 1)], [card(1, 1, { text: "x" })])).toBe(false);
  });

  test("putting back a removed card inserts it with its own id, in place", () => {
    const before = [card(1, 1), card(2, 2), card(3, 3)];
    const now = [before[0], before[2]].map(stored);
    const plan = planRestore(now, before);
    expect(plan.deletes).toEqual([]);
    expect(plan.inserts).toEqual([{ id: id(2), row: expect.objectContaining({ sort_order: 1, kind: "card", card_id: id(102) }) }]);
    expect(plan.updates).toEqual([{ id: id(3), set: { sort_order: 2 } }]);
    expect(plan.cardsIn).toEqual([id(102)]);
    expect(plan.cardsOut).toEqual([]);
  });

  test("undoing an add deletes it; undoing an edit restores the words; undoing a move restores the order", () => {
    const before = [card(1, 1), card(2, 2, { text: "Edited here", edited: true })];
    const now: StoredBlock[] = [
      stored(card(2, 2), 0), stored(card(1, 1), 1), stored(card(9, 9), 2),
    ];
    const plan = planRestore(now, before);
    expect(plan.deletes).toEqual([id(9)]);
    expect(plan.cardsOut).toEqual([id(109)]);
    expect(plan.updates).toContainEqual({ id: id(1), set: { sort_order: 0 } });
    expect(plan.updates).toContainEqual({ id: id(2), set: { sort_order: 1, text: "Edited here", edited: true } });
  });

  test("a weave undone takes its proposed bridges out; text turned into a card comes back as text", () => {
    const human: UndoBlock = { id: id(5), kind: "human", cardId: null, cardVersion: null, text: "We served 40 families.", edited: false, breakBefore: false, proposed: false };
    const now: StoredBlock[] = [
      { id: id(5), kind: "card", card_id: id(150), card_version: 1, text: null, edited: false, break_before: false, proposed: false, sort_order: 0 },
      { id: id(6), kind: "bridge", card_id: null, card_version: null, text: "Building on that,", edited: false, break_before: false, proposed: true, sort_order: 1 },
    ];
    const plan = planRestore(now, [human]);
    expect(plan.deletes).toEqual([id(6)]);
    expect(plan.updates).toEqual([{ id: id(5), set: { kind: "human", card_id: null, card_version: null, text: "We served 40 families." } }]);
    expect(plan.cardsOut).toEqual([id(150)]);
  });

  test("what the page sends is checked", () => {
    expect(restoreProblem([card(1, 1), card(2, 2)])).toBeNull();
    expect(restoreProblem([])).toBeNull();
    expect(restoreProblem([card(1, 1), card(1, 2)])).toMatch(/could not/);
    expect(restoreProblem([card(1, 1), card(2, 1)])).toMatch(/could not/);
    expect(restoreProblem([{ ...card(1, 1), id: "tmp-1" }])).toMatch(/could not/);
    expect(restoreProblem([{ ...card(1, 1), kind: "image" as never }])).toMatch(/could not/);
    expect(restoreProblem(Array.from({ length: 201 }, (_, i) => ({ ...card(i, i), kind: "human" as const, cardId: null })))).toMatch(/too long/);
  });
});
