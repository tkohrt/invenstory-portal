// A section's answer, as ordered blocks. The pure half.
//
// An answer is never one text field (spec Decision 5). It is a list of blocks,
// each a Story Card (as placed, or as edited in this draft) or text a person
// wrote. Everything a writer sees as "the answer" (the count against the limit,
// the text copied into a funder's portal, the Standard Answer approved into the
// Answer Library) is assembled here from those blocks, so all three always agree.
//
// Free of `server-only`; tested in tests/drafter/section-answer.test.ts.

export type BlockKind = "card" | "bridge" | "human";

export interface AnswerBlock {
  id: string;
  kind: BlockKind;
  text: string;
  breakBefore: boolean;
}

/**
 * The answer as plain text: blocks in order, a space between them, a blank line
 * where a block starts a new paragraph. Whitespace inside a card is collapsed;
 * a person's own line breaks inside a written block are kept.
 */
export function assembleAnswer(blocks: Pick<AnswerBlock, "kind" | "text" | "breakBefore">[]): string {
  let out = "";
  for (const b of blocks) {
    const t = b.kind === "human" ? b.text.trim() : b.text.replace(/\s+/g, " ").trim();
    if (!t) continue;
    out += out ? (b.breakBefore ? "\n\n" : " ") + t : t;
  }
  return out;
}

/** Words as a funder's portal counts them: runs of non-space. Characters include spaces. */
export function countFor(text: string, unit: "words" | "characters"): number {
  if (unit === "characters") return text.length;
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export type LimitState = "none" | "under" | "near" | "over";

/** Near is the last tenth of the limit: worth a glance, not yet a problem. */
export function limitState(count: number, limit: number | null | undefined): LimitState {
  if (!limit || limit <= 0) return "none";
  if (count > limit) return "over";
  if (count >= limit * 0.9) return "near";
  return "under";
}

/** Move one item in a list. Out-of-range moves return the list unchanged. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const a = [...list];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

// ---------------------------------------------------------------------------
// Tidy: the model proposes an order; code decides whether it is one.
// ---------------------------------------------------------------------------

export interface TidyProposal { order: string[]; rationale: string }

/**
 * Read the model's proposed order.
 *
 * Accepted only if it is exactly a reordering of the blocks it was given: every
 * block once, nothing added, nothing dropped. Tidy may change the ORDER of an
 * answer and nothing else, so anything other than a permutation is refused
 * whole rather than repaired. The model is asked for 1-based numbers, which it
 * is far less likely to garble than ids.
 */
export function parseTidy(raw: string, ids: string[]): TidyProposal | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: unknown;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const o = j as { order?: unknown; rationale?: unknown };
  if (!Array.isArray(o.order) || o.order.length !== ids.length) return null;
  const nums = o.order.map(n => (typeof n === "string" ? Number(n) : n));
  if (!nums.every(n => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= ids.length)) return null;
  if (new Set(nums).size !== ids.length) return null;
  const rationale = typeof o.rationale === "string" ? o.rationale.trim().replace(/\s+/g, " ").slice(0, 280) : "";
  if (!rationale) return null;
  return { order: (nums as number[]).map(n => ids[n - 1]), rationale };
}

/** Whether a proposed order is the order the answer already has. */
export function sameOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The short form of an approved answer, for the Answer Library's summary line:
 * whole sentences from the start, up to about sixty words. Never cut mid-sentence;
 * if the first sentence alone is longer, it is used whole.
 */
export function shortFrom(text: string, maxWords = 60): string {
  const first = text.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  const sentences = first.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [first];
  let out = "";
  for (const s of sentences) {
    const next = (out + s).trim();
    if (out && countFor(next, "words") > maxWords) break;
    out = next + " ";
  }
  return out.trim();
}
