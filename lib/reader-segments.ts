// Cutting a document's text into the pieces the reader draws (Document Reader,
// Phase 1). Pure and tested (tests/reader/reader-segments.test.ts).
//
// Highlights overlap: two cards can quote the same sentence, and a search
// match can run across a card's edge. Every place a highlight starts or ends,
// and every page start, becomes a cut, so each piece has one fixed set of
// cards and at most one search match over all of it. Pieces are drawn in
// order; a piece that starts a page carries that page's number for its divider.
import type { PageSpan } from "./doc-text";

export interface Mark { start: number; end: number }
export interface CardMark extends Mark { cardId: string }

export interface Segment {
  start: number;
  end: number;
  /** Cards whose passage covers this piece, in the order given. */
  cards: string[];
  /** Index of the search match covering this piece, or -1. */
  match: number;
  /** The page that begins at this piece, when one does. */
  pageStart: number | null;
}

/** Clamp to the text and drop empty or inverted ranges. */
function clean<T extends Mark>(marks: T[], length: number): T[] {
  return marks
    .map(m => ({ ...m, start: Math.max(0, Math.min(length, m.start)), end: Math.max(0, Math.min(length, m.end)) }))
    .filter(m => m.end > m.start);
}

export function segment(length: number, pages: PageSpan[], cards: CardMark[], matches: Mark[]): Segment[] {
  if (length <= 0) return [];
  const cs = clean(cards, length);
  const ms = clean(matches, length);
  const cuts = new Set<number>([0, length]);
  for (const m of cs) { cuts.add(m.start); cuts.add(m.end); }
  for (const m of ms) { cuts.add(m.start); cuts.add(m.end); }
  const pageAt = new Map<number, number>();
  for (const p of pages) {
    if (p.page === null || p.start >= length) continue;
    cuts.add(p.start);
    if (!pageAt.has(p.start)) pageAt.set(p.start, p.page);
  }
  const points = [...cuts].sort((a, b) => a - b);

  // Sweep: marks sorted by start, a running set of open ones.
  const byStart = [...cs].sort((a, b) => a.start - b.start);
  const order = new Map(cs.map((m, i) => [m, i]));
  const matchByStart = ms.map((m, i) => ({ ...m, i })).sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let ci = 0, mi = 0;
  let open: CardMark[] = [];
  let openMatches: (Mark & { i: number })[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const s = points[k], e = points[k + 1];
    while (ci < byStart.length && byStart[ci].start <= s) open.push(byStart[ci++]);
    open = open.filter(m => m.end > s);
    while (mi < matchByStart.length && matchByStart[mi].start <= s) openMatches.push(matchByStart[mi++]);
    openMatches = openMatches.filter(m => m.end > s);
    const cards = [...open].sort((a, b) => order.get(a)! - order.get(b)!).map(m => m.cardId);
    out.push({
      start: s, end: e,
      cards: [...new Set(cards)],
      match: openMatches.length ? Math.min(...openMatches.map(m => m.i)) : -1,
      pageStart: pageAt.get(s) ?? null,
    });
  }
  return out;
}

/** Position of an index in a list that wraps, for "next" and "previous". */
export function step(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}
