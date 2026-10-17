// Remembered refusals (Build Decisions 19 and 31, 6 October 2026): the pure half.
//
// When For Granted marks a card Not supported in the analysis review, or
// retires a card as Inaccurate in the Card Library, the quote behind it is
// remembered for that client. Every later read is filtered through what is
// remembered, so a card like RE-Assist's substance use disorder contract
// cannot come back after a re-read, however the reader words it next time.
//
// Applied where cards are USED, never inside the read itself:
//   - the would-be library on the trial page, the client's Analyze page and the
//     Compare tab (lib/server/analysis-read.ts, analysis-client-read.ts,
//     analysis-compare.ts);
//   - the Card Library merge (remergeLibrary in lib/server/card-extract.ts).
// So a refusal takes effect at once, for free, with no paid re-read, and the
// read's own output stays intact for the review: the reader keeps being judged
// on everything it produced, including the cards a person has already refused.
// Filtering the refused cards out of the review would let a weak reader pass
// the gate simply because its worst cards had been caught.
//
// What is remembered is the QUOTE (decision 19's wording), for that client, in
// any document and for any kind of card: the reader's wording drifts between
// reads, the quote it leans on does not. Lifting a refusal on the trial page
// lets the quote through again.
import { normalizeText, stripMarkup } from "./story-card";

/**
 * "review" and "library" refuse a quote for every card (decisions 19 and 31).
 * "passage" (Document Reader, 0070) refuses one quote for ONE card only:
 * "This passage does not support the card". It never stops the quote feeding
 * any other card, so the global filters below ignore it; the Card Library
 * merge applies it to its card through passageRefusedFor.
 */
export type RefusalSource = "review" | "library" | "passage";

export interface Refusal {
  id: string;
  source: RefusalSource;
  /** The review's fingerprint, or the Card Library card's id. */
  sourceRef: string;
  documentId: string | null;
  kind: string;
  statement: string;
  quote: string;
  createdAt: string;
}

/** The comparable form of a quote: the quote check's normalisation, then words only. */
export function quoteKey(quote: string): string {
  return normalizeText(stripMarkup(quote ?? ""))
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words in a run, for comparing two quotes that overlap without being equal. */
export const SHINGLE_WORDS = 4;
/** Below this many words a quote is only matched exactly: a short phrase turns up inside many legitimate quotes. */
export const MIN_FUZZY_WORDS = 8;
/**
 * When a new card's quote counts as the refused one (both at least
 * MIN_FUZZY_WORDS long), measured in runs of SHINGLE_WORDS words:
 *
 *   - most of the new quote comes from the refused one (MIN_SHARED of its
 *     runs). A re-read that trims the refused quote, or starts and stops a few
 *     words off, is refused. A part of a long refused passage counts as the
 *     passage: the passage was refused as a whole.
 *   - or the refused quote appears whole inside the new one (CONTAINED of the
 *     refused quote's runs). The quote has come back, whatever surrounds it:
 *     on 6 October 2026 the v3 read quoted RE-Assist's refused "rehab weason"
 *     line with the sentence before it, under a different kind of card.
 *
 * A refused quote shorter than MIN_FUZZY_WORDS is matched only exactly, so a
 * short refused fragment ("code help from CUNY, JumpStart involvement") does
 * not knock out every longer quote that happens to include it.
 */
export const MIN_SHARED = 0.6;
export const CONTAINED = 0.9;

function shingles(key: string): Set<string> {
  const w = key ? key.split(" ") : [];
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= w.length; i++) out.add(w.slice(i, i + SHINGLE_WORDS).join(" "));
  return out;
}
const words = (key: string) => (key ? key.split(" ").length : 0);

interface Prepared { key: string; words: number; runs: Set<string> }
const prepare = (quote: string): Prepared => {
  const key = quoteKey(quote);
  return { key, words: words(key), runs: shingles(key) };
};

/** Is `card`'s quote the refused one come back? See MIN_SHARED and CONTAINED. */
function fromRefused(card: Prepared, refused: Prepared): boolean {
  if (!card.key || !refused.key) return false;
  if (card.key === refused.key) return true;
  if (card.words < MIN_FUZZY_WORDS || refused.words < MIN_FUZZY_WORDS) return false;
  let shared = 0;
  for (const r of card.runs) if (refused.runs.has(r)) shared++;
  return shared / card.runs.size >= MIN_SHARED || shared / refused.runs.size >= CONTAINED;
}

/** Would a card quoting `cardQuote` be refused by a refusal of `refusedQuote`? */
export function quotesMatch(refusedQuote: string, cardQuote: string): boolean {
  return fromRefused(prepare(cardQuote), prepare(refusedQuote));
}

/** Refusals prepared once for matching many cards. */
export interface RefusalIndex { refusals: Refusal[]; prepared: Prepared[] }

export function indexRefusals(refusals: Refusal[]): RefusalIndex {
  const global = refusals.filter(r => r.source !== "passage");
  return { refusals: global, prepared: global.map(r => prepare(r.quote)) };
}

/**
 * A card's own refused passages (source "passage"): does this card's evidence
 * from this document, with this quote, come from a passage refused for it?
 * Matched like every refusal (the same quote after normalising, or most of it),
 * on the same document.
 */
/**
 * Which card a refused passage belongs to. The merge uses it as PROOF: a
 * re-read that words the claim differently, from the same passage, is still
 * that card's claim, and since the passage is refused for it, nothing new is
 * made from it (no twin waiting in Needs review).
 */
export function passageOwnerFor(refusals: Refusal[]): (documentId: string, quote: string) => string | null {
  const own = refusals.filter(r => r.source === "passage").map(r => ({ r, p: prepare(r.quote) }));
  if (!own.length) return () => null;
  return (documentId, quote) => {
    const p = prepare(quote);
    const hit = own.find(({ r, p: rp }) => (r.documentId === null || r.documentId === documentId) && fromRefused(p, rp));
    return hit ? hit.r.sourceRef : null;
  };
}

export function passageRefusedFor(refusals: Refusal[]): (cardId: string, documentId: string, quote: string) => boolean {
  const own = refusals.filter(r => r.source === "passage").map(r => ({ r, p: prepare(r.quote) }));
  if (!own.length) return () => false;
  return (cardId, documentId, quote) => {
    const p = prepare(quote);
    return own.some(({ r, p: rp }) => r.sourceRef === cardId
      && (r.documentId === null || r.documentId === documentId) && fromRefused(p, rp));
  };
}

/** The refusal that blocks a card with this quote, if any. */
export function refusalFor(quote: string, index: RefusalIndex): Refusal | null {
  if (!index.refusals.length) return null;
  const p = prepare(quote);
  for (let i = 0; i < index.prepared.length; i++) {
    if (fromRefused(p, index.prepared[i])) return index.refusals[i];
  }
  return null;
}

export interface Blocked<C> { documentId: string; card: C; refusal: Refusal }

/**
 * Each document's cards with the refused ones taken out, and what was taken out.
 *
 * Works on any document shape with a `cards` list of things carrying a quote,
 * so the trial page, the derivations and the Card Library merge all filter the
 * same way through the same function.
 */
export function withoutRefused<D extends { documentId: string; cards: { quote: string }[] }>(
  docs: D[], refusals: Refusal[],
): { docs: D[]; blocked: Blocked<D["cards"][number]>[] } {
  const index = indexRefusals(refusals);
  if (!index.refusals.length) return { docs, blocked: [] };
  const blocked: Blocked<D["cards"][number]>[] = [];
  const out = docs.map(d => {
    const kept: D["cards"] = [];
    for (const c of d.cards ?? []) {
      const r = refusalFor(c.quote, index);
      if (r) blocked.push({ documentId: d.documentId, card: c, refusal: r });
      else kept.push(c);
    }
    return { ...d, cards: kept };
  });
  return { docs: out, blocked };
}

/** The same filter for documents keyed `id` (the derivations' AnalysedDoc), returning only the kept documents. */
export function dropRefusedCards<D extends { id: string; cards: { quote: string }[] }>(docs: D[], refusals: Refusal[]): D[] {
  const index = indexRefusals(refusals);
  if (!index.refusals.length) return docs;
  return docs.map(d => ({ ...d, cards: (d.cards ?? []).filter(c => !refusalFor(c.quote, index)) }));
}
