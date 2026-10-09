// Undo in the Storyboard (9 October 2026): the pure half.
//
// Every change a writer makes to an answer (placing, moving, removing, editing,
// a paragraph break, accepting or rejecting a bridge, a weave, turning words
// into a card) first remembers the answer as it stood. Undo, or Ctrl+Z, puts
// that answer back: the same pieces, in the same order, with the same words.
//
// The page keeps the remembered answers (one list per question, newest last);
// the server is handed one of them and makes the stored answer match it. Blocks
// still there are updated in place, blocks gone are inserted again with their
// own ids, and blocks added since are deleted. Nothing outside the answer is
// undone: a card saved to the library, or a wording saved to a card, stays.
//
// Free of `server-only`; tested in tests/drafter/draft-undo.test.ts.

/** One piece of an answer as Undo remembers it: exactly what section_block stores. */
export interface UndoBlock {
  id: string;
  kind: "card" | "bridge" | "human";
  cardId: string | null;
  cardVersion: number | null;
  /** The block's own text: an edit, a bridge, the writer's words; null for an unedited card. */
  text: string | null;
  edited: boolean;
  breakBefore: boolean;
  proposed: boolean;
}

/** How many changes back Undo reaches, per question. */
export const UNDO_DEPTH = 30;
/** The most pieces one answer may be put back with. */
export const UNDO_MAX_BLOCKS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's blocks as Undo remembers them. Blocks still being saved (tmp-) are left out. */
export function undoState(blocks: {
  id: string; kind: UndoBlock["kind"]; cardId: string | null; cardVersion: number | null;
  ownText: string | null; edited: boolean; breakBefore: boolean; proposed: boolean;
}[]): UndoBlock[] {
  return blocks.filter(b => UUID.test(b.id)).map(b => ({
    id: b.id, kind: b.kind, cardId: b.cardId, cardVersion: b.cardVersion,
    text: b.ownText, edited: b.edited, breakBefore: b.breakBefore, proposed: b.kind === "bridge" && b.proposed,
  }));
}

/** Two remembered answers are the same: nothing to undo between them. */
export function sameState(a: UndoBlock[], b: UndoBlock[]): boolean {
  return a.length === b.length && a.every((x, i) => {
    const y = b[i];
    return x.id === y.id && x.kind === y.kind && x.cardId === y.cardId && x.cardVersion === y.cardVersion
      && (x.text ?? null) === (y.text ?? null) && x.edited === y.edited && x.breakBefore === y.breakBefore && x.proposed === y.proposed;
  });
}

/** Add a remembered answer to a question's list, newest last, at most UNDO_DEPTH. A repeat of the last is skipped. */
export function pushUndo<T extends { state: UndoBlock[] }>(list: T[], entry: T): T[] {
  const last = list[list.length - 1];
  if (last && sameState(last.state, entry.state)) return list;
  return [...list, entry].slice(-UNDO_DEPTH);
}

/** A stored section_block row, as the server reads it. */
export interface StoredBlock {
  id: string; kind: string; card_id: string | null; card_version: number | null; text: string | null;
  edited: boolean; break_before: boolean; proposed: boolean; sort_order: number;
}

export interface RestorePlan {
  /** Rows to delete: in the answer now, not in the one being put back. */
  deletes: string[];
  /** Rows still there, with the fields to change (sort_order included). */
  updates: { id: string; set: Record<string, unknown> }[];
  /** Rows to insert again, with their own ids. */
  inserts: { id: string; row: Record<string, unknown> }[];
  /** Card ids the answer gains: the server checks each is still this client's, live and placeable. */
  cardsIn: string[];
  /** Card ids the answer loses, for the log. */
  cardsOut: string[];
}

/**
 * Why this remembered answer cannot be put back, or null when it can. The page
 * sent it, so it is checked like any input: ids, kinds, one copy of each card.
 */
export function restoreProblem(target: UndoBlock[]): string | null {
  if (!Array.isArray(target)) return "Nothing to put back.";
  if (target.length > UNDO_MAX_BLOCKS) return "That answer is too long to put back.";
  const ids = new Set<string>(), cards = new Set<string>();
  for (const b of target) {
    if (!b || typeof b.id !== "string" || !UUID.test(b.id)) return "That answer could not be put back.";
    if (ids.has(b.id)) return "That answer could not be put back.";
    ids.add(b.id);
    if (!["card", "bridge", "human"].includes(b.kind)) return "That answer could not be put back.";
    if (b.kind === "card") {
      if (!b.cardId || !UUID.test(b.cardId)) return "That answer could not be put back.";
      if (cards.has(b.cardId)) return "That answer could not be put back.";
      cards.add(b.cardId);
    }
  }
  return null;
}

/** What to change so the stored answer reads exactly as `target`. */
export function planRestore(current: StoredBlock[], target: UndoBlock[]): RestorePlan {
  const now = new Map(current.map(r => [r.id, r]));
  const keep = new Set(target.map(b => b.id));
  const fields = (b: UndoBlock, i: number) => ({
    sort_order: i,
    kind: b.kind,
    card_id: b.kind === "card" ? b.cardId : null,
    card_version: b.kind === "card" && Number.isInteger(b.cardVersion) ? b.cardVersion : null,
    text: b.text == null ? null : String(b.text).slice(0, 8000),
    edited: b.kind !== "human" && !!b.edited,
    break_before: !!b.breakBefore,
    proposed: b.kind === "bridge" && !!b.proposed,
  });

  const updates: RestorePlan["updates"] = [];
  const inserts: RestorePlan["inserts"] = [];
  target.forEach((b, i) => {
    const want = fields(b, i);
    const have = now.get(b.id);
    if (!have) { inserts.push({ id: b.id, row: want }); return; }
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(want)) {
      const h = (have as unknown as Record<string, unknown>)[k];
      if ((h ?? null) !== (v ?? null)) set[k] = v;
    }
    if (Object.keys(set).length) updates.push({ id: b.id, set });
  });

  const before = new Set(current.filter(r => r.kind === "card" && r.card_id).map(r => r.card_id as string));
  const after = new Set(target.filter(b => b.kind === "card" && b.cardId).map(b => b.cardId as string));
  return {
    deletes: current.filter(r => !keep.has(r.id)).map(r => r.id),
    updates, inserts,
    cardsIn: [...after].filter(id => !before.has(id)),
    cardsOut: [...before].filter(id => !after.has(id)),
  };
}
