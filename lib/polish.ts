// Polish (Storyboarding Tool, Phase 4): the pure half. Tested in tests/drafter/polish.test.ts.
//
// Shane, 9 October 2026:
//   - Nothing in Polish runs until Begin Polishing is pressed.
//   - An answer over its limit is offered both: shorter wording for pieces
//     (drafted with AI, each passing the code check below or discarded unseen)
//     and pieces that could be dropped (worked out here, free). Nothing changes
//     until the writer accepts.
//   - The figure audit: a number in the answer that the pieces' sources do not
//     hold is flagged. A flag stops the answer leaving every way it can: Copy,
//     Mark completed, Mark submitted, and approving a Standard Answer. Anyone
//     drafting (For Granted, and a client) may clear a flag, with an optional
//     reason; who cleared it and when is kept.
//
// The figure audit is a code check, so it costs nothing. The finish line runs it
// whether or not Polish has been opened, so a number with no source cannot
// leave unseen; Polish is where the flags are listed and dealt with.
import { figuresIn } from "./story-card";
import { countFor } from "./section-answer";

// ---------------------------------------------------------------------------
// The figure audit.
// ---------------------------------------------------------------------------

export interface AuditBlock {
  id: string;
  kind: string;
  cardId: string | null;
  text: string;
  proposed?: boolean;
}

export interface FigureClearance {
  blockId: string; figure: string;
  by: string | null; role: "admin" | "client" | string; reason: string | null; at: string;
}

export interface FigureFlag {
  blockId: string;
  figure: string;
  /** Where its number was looked for: the card's own sources, or the sources of every card in the answer. */
  where: "card" | "answer";
  cleared: FigureClearance | null;
}

/**
 * Every number in an answer that its sources do not hold.
 *
 * A card's number is looked for in that card's sources. A number in the
 * writer's own words, or in a bridge, is looked for in the sources of every card
 * in the answer: it must come from somewhere the answer already cites. Proposed
 * bridges are not part of the answer and are skipped (Weave already refuses any
 * bridge that adds a number).
 */
export function figureAudit(
  blocks: AuditBlock[],
  quotesOf: (cardId: string) => string[],
  clearances: FigureClearance[] = [],
): FigureFlag[] {
  const live = blocks.filter(b => !b.proposed && b.text.trim());
  const answerQuotes = live.filter(b => b.kind === "card" && b.cardId).flatMap(b => quotesOf(b.cardId as string)).join("\n");
  const inAnswer = new Set(figuresIn(answerQuotes));
  const cleared = new Map(clearances.map(c => [`${c.blockId}|${c.figure}`, c]));
  const out: FigureFlag[] = [];
  for (const b of live) {
    const isCard = b.kind === "card" && !!b.cardId;
    const have = isCard ? new Set(figuresIn(quotesOf(b.cardId as string).join("\n"))) : inAnswer;
    for (const f of figuresIn(b.text)) {
      if (have.has(f)) continue;
      out.push({ blockId: b.id, figure: f, where: isCard ? "card" : "answer", cleared: cleared.get(`${b.id}|${f}`) ?? null });
    }
  }
  return out;
}

/** Flags nobody has fixed or cleared: these stop the answer leaving. */
export const openFlags = (flags: FigureFlag[]) => flags.filter(f => !f.cleared);

/** One plain sentence for a refusal at the finish line. */
export function describeFigureFlags(n: number, what = "this application"): string {
  return n ? `${n} number${n === 1 ? "" : "s"} in ${what} ${n === 1 ? "has" : "have"} no source in the Story Cards. Trace ${n === 1 ? "it" : "each"}, change ${n === 1 ? "it" : "them"}, or clear ${n === 1 ? "it" : "each"} in Polish.` : "";
}

export const CLEAR_REASON_MAX = 300;

// ---------------------------------------------------------------------------
// Repetition: two pieces of one answer saying the same thing in the same words.
// ---------------------------------------------------------------------------

export interface Repeat { a: string; b: string; phrase: string }

const SHINGLE = 6;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** Pairs of pieces sharing a run of six or more words, with the first such run. */
export function repeats(blocks: AuditBlock[]): Repeat[] {
  const live = blocks.filter(b => !b.proposed && b.text.trim());
  const grams = live.map(b => {
    const w = norm(b.text);
    const m = new Map<string, number>();
    for (let i = 0; i + SHINGLE <= w.length; i++) m.set(w.slice(i, i + SHINGLE).join(" "), i);
    return { id: b.id, words: w, m };
  });
  const out: Repeat[] = [];
  for (let i = 0; i < grams.length; i++) {
    for (let j = i + 1; j < grams.length; j++) {
      const hit = [...grams[i].m.keys()].find(g => grams[j].m.has(g));
      if (!hit) continue;
      // Grow the shared run as far as it goes, for a readable phrase.
      const start = grams[i].m.get(hit)!, other = grams[j].m.get(hit)!;
      let n = SHINGLE;
      while (grams[i].words[start + n] && grams[i].words[start + n] === grams[j].words[other + n]) n++;
      out.push({ a: grams[i].id, b: grams[j].id, phrase: grams[i].words.slice(start, start + n).join(" ") });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Length: which pieces could go.
// ---------------------------------------------------------------------------

export interface LengthPiece extends AuditBlock { breakBefore?: boolean }

export interface DropOption {
  /** The pieces to take out, in the answer's order. */
  blockIds: string[];
  /** The count once they are gone. */
  after: number;
  saves: number;
}

const textOf = (pieces: LengthPiece[], unit: "words" | "characters") =>
  countFor(pieces.filter(p => !p.proposed).map(p => p.text.replace(/\s+/g, " ").trim()).filter(Boolean).join(" "), unit);

/**
 * Up to three ways to come under the limit by taking pieces out, the gentlest
 * first. A piece is a better one to drop when another piece in the answer
 * already gives the same kind of card, and when it ranked lower for this
 * question. The only card of a kind the question asks for is offered last.
 */
export function dropOptions(input: {
  pieces: LengthPiece[];
  limit: number;
  unit: "words" | "characters";
  kindOf: (cardId: string) => string | null;
  wantedKinds: string[];
  /** The ranking's score for this question; higher is a better fit. */
  scoreOf: (cardId: string) => number;
}): DropOption[] {
  const live = input.pieces.filter(p => !p.proposed && p.text.trim());
  const total = textOf(live, input.unit);
  if (!input.limit || total <= input.limit) return [];
  const kindCount = new Map<string, number>();
  for (const p of live) {
    const k = p.cardId ? input.kindOf(p.cardId) : null;
    if (k) kindCount.set(k, (kindCount.get(k) ?? 0) + 1);
  }
  // Lower is a better piece to drop.
  const keepScore = (p: LengthPiece) => {
    if (p.kind !== "card" || !p.cardId) return p.kind === "bridge" ? 0.5 : 1;
    const k = input.kindOf(p.cardId);
    const onlyOfWanted = !!k && input.wantedKinds.includes(k) && (kindCount.get(k) ?? 0) <= 1;
    return (onlyOfWanted ? 10 : 2) + input.scoreOf(p.cardId);
  };
  const ranked = [...live].sort((a, b) => keepScore(a) - keepScore(b));
  const order = new Map(live.map((p, i) => [p.id, i]));
  const after = (ids: string[]) => textOf(live.filter(p => !ids.includes(p.id)), input.unit);

  const out: DropOption[] = [];
  const seen = new Set<string>();
  const add = (ids: string[]) => {
    const sorted = [...ids].sort((a, b) => order.get(a)! - order.get(b)!);
    const key = sorted.join(",");
    if (seen.has(key) || sorted.length >= live.length) return;
    seen.add(key);
    const n = after(sorted);
    out.push({ blockIds: sorted, after: n, saves: total - n });
  };
  // One piece that is enough on its own, gentlest first.
  for (const p of ranked) {
    if (after([p.id]) <= input.limit) add([p.id]);
    if (out.length >= 3) break;
  }
  // Otherwise, the fewest of the gentlest pieces that together are enough.
  if (!out.length) {
    const pick: string[] = [];
    for (const p of ranked) {
      pick.push(p.id);
      if (after(pick) <= input.limit) { add(pick); break; }
    }
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Shorter wording, drafted with AI: the code check every proposal must pass.
// ---------------------------------------------------------------------------

export type ShortenRefusal = "not_shorter" | "too_short" | "number" | "name" | "quote";

export const SHORTEN_REASON: Record<ShortenRefusal, string> = {
  not_shorter: "it was not shorter",
  too_short: "it cut the piece to almost nothing",
  number: "it changed or added a number",
  name: "it added a name the piece does not hold",
  quote: "it changed the words inside a quotation",
};

const capitalised = (t: string) => {
  const out: { w: string; starts: boolean }[] = [];
  let start = true;
  for (const raw of t.split(/\s+/)) {
    const w = raw.replace(/^[("'‘“[]+/, "").replace(/[)"'’”\].,;:!?]+$/, "");
    if (w && /^[A-Z]/.test(w)) out.push({ w, starts: start });
    if (raw) start = /[.!?:]["'’”)\]]*$/.test(raw);
  }
  return out;
};
const quotesIn = (t: string) => [...t.matchAll(/["“]([^"”]{3,})["”]/g)].map(m => m[1].trim());

/**
 * Why a shortened piece is refused, or null when it may be shown. It must be
 * shorter, keep at least a third of the piece, keep every number exactly
 * (dropping one is allowed; changing or adding one is not), add no name, and
 * leave any quotation either whole or out.
 */
export function checkShortening(original: string, shortened: string): ShortenRefusal | null {
  const o = original.replace(/\s+/g, " ").trim(), s = shortened.replace(/\s+/g, " ").trim();
  const ow = o ? o.split(" ").length : 0, sw = s ? s.split(" ").length : 0;
  if (!sw || sw >= ow) return "not_shorter";
  if (sw < Math.max(3, Math.ceil(ow / 3))) return "too_short";
  const figs = new Set(figuresIn(o));
  if (figuresIn(s).some(f => !figs.has(f))) return "number";
  const words = new Set(o.split(/[^A-Za-z0-9'’-]+/).filter(Boolean));
  const lower = new Set([...words].map(w => w.toLowerCase()));
  for (const c of capitalised(s)) {
    const known = words.has(c.w) || words.has(c.w.replace(/['’]s$/, ""));
    if (!known && !(c.starts && lower.has(c.w.toLowerCase()))) return "name";
  }
  const oq = quotesIn(o);
  for (const q of quotesIn(s)) if (!oq.some(x => x === q)) return "quote";
  return null;
}

export interface ShortenProposal { blockId: string; text: string; saves: number }

/** Read the model's reply: {"pieces":[{"n":2,"text":"..."}]}, numbered from 1 in the order given. */
export function parsePolish(raw: string, ids: string[]): { blockId: string; text: string }[] | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { pieces?: { n?: unknown; text?: unknown }[] };
    if (!Array.isArray(j.pieces)) return null;
    const out: { blockId: string; text: string }[] = [];
    const used = new Set<number>();
    for (const p of j.pieces) {
      const n = Number(p?.n);
      if (!Number.isInteger(n) || n < 1 || n > ids.length || used.has(n) || typeof p?.text !== "string") continue;
      used.add(n);
      out.push({ blockId: ids[n - 1], text: p.text.replace(/\s+/g, " ").trim() });
    }
    return out;
  } catch { return null; }
}

/** Keep the proposals that pass the check, with what each saves. */
export function screenShortenings(proposed: { blockId: string; text: string }[], originals: Map<string, string>, unit: "words" | "characters") {
  const kept: ShortenProposal[] = [], refused: { blockId: string; reason: ShortenRefusal }[] = [];
  for (const p of proposed) {
    const o = originals.get(p.blockId);
    if (o == null) continue;
    const why = checkShortening(o, p.text);
    if (why) { refused.push({ blockId: p.blockId, reason: why }); continue; }
    kept.push({ blockId: p.blockId, text: p.text, saves: countFor(o.replace(/\s+/g, " ").trim(), unit) - countFor(p.text, unit) });
  }
  return { kept, refused };
}
