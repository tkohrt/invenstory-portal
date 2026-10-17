// Finding a quote, or a search, in a document's stored text (Document Reader).
//
// Pure and tested (tests/reader/locate.test.ts).
//
// Nothing stores where a quote sits in its document (code audit, 17 October
// 2026): every highlight is found by locating the stored quote in the stored
// text. The comparison is the one the quote check uses (normalizeText and
// stripMarkup in lib/story-card.ts: NFKC, case, curly quotes, dashes, soft
// hyphens, runs of spacing, Markdown emphasis), done character by character
// so every match maps back to positions in the ORIGINAL text.
//
// A quote checked by the analysis was checked against the old stitched text
// (passages joined with a newline, pages joined with nothing). Two passes
// cover what that can leave behind:
//   1. the normalised comparison (spacing collapsed to one space);
//   2. spacing ignored altogether, which finds a quote that ran two pages, or
//      two passages, together.
// A quote may be several pieces joined with "…" (the quote check allows it):
// each piece is located in order, and each becomes its own span.
// A quote found in more than one place reports how many (`places`), and the
// place chosen is the one nearest `near` when given, else the first.
// Anything not found is "missing": the reader lists it, never drops it.

export interface Span { start: number; end: number }

export type Located =
  | { status: "found"; spans: Span[]; places: number; pass: "exact" | "spacing" }
  | { status: "missing" };

interface Folded {
  /** The folded text. */
  s: string;
  /** For each character of s, the raw index it came from. */
  from: number[];
  /** For each character of s, the raw index just after the raw character it came from. */
  to: number[];
}

const SINGLE_QUOTES = /[‘’‚‛′]/;
const DOUBLE_QUOTES = /[“”„‟″]/;
const DASHES = /[‐-―−]/;

/**
 * Fold text the way normalizeText(stripMarkup(..)) does, keeping a map back to
 * the raw positions. `keepSpace` false drops all spacing (the second pass);
 * `keepCase` true skips lower-casing (a case-sensitive search).
 */
export function fold(raw: string, opts: { keepSpace?: boolean; keepCase?: boolean } = {}): Folded {
  const keepSpace = opts.keepSpace ?? true;
  const out: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  let lastWasSpace = true; // drops leading spacing, as trim() does
  let i = 0;
  while (i < raw.length) {
    const cp = raw.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const next = i + ch.length;
    // Markdown emphasis: * and ` always, _ only as part of a run of two or more.
    const isMarkup = ch === "*" || ch === "`" || (ch === "_" && (raw[i + 1] === "_" || raw[i - 1] === "_"));
    if (isMarkup || ch === "­") { i = next; continue; }
    if (/\s/.test(ch)) {
      if (keepSpace && !lastWasSpace) { out.push(" "); from.push(i); to.push(next); }
      lastWasSpace = true;
      i = next;
      continue;
    }
    let f = ch.normalize("NFKC");
    if (!opts.keepCase) f = f.toLowerCase();
    for (const c of f) {
      let x = c;
      if (SINGLE_QUOTES.test(x)) x = "'";
      else if (DOUBLE_QUOTES.test(x)) x = '"';
      else if (DASHES.test(x)) x = "-";
      if (/\s/.test(x)) {
        if (keepSpace && !lastWasSpace) { out.push(" "); from.push(i); to.push(next); lastWasSpace = true; }
        continue;
      }
      out.push(x); from.push(i); to.push(next);
      lastWasSpace = false;
    }
    i = next;
  }
  // trim a trailing space
  if (out.length && out[out.length - 1] === " ") { out.pop(); from.pop(); to.pop(); }
  return { s: out.join(""), from, to };
}

/** The folded query, without positions. */
function foldQuery(q: string, opts: { keepSpace?: boolean; keepCase?: boolean } = {}): string {
  return fold(q, opts).s;
}

/** Every start of `needle` in `hay`, not overlapping. */
function allStarts(hay: string, needle: string, max = 1000): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let at = hay.indexOf(needle);
  while (at >= 0 && out.length < max) {
    out.push(at);
    at = hay.indexOf(needle, at + needle.length);
  }
  return out;
}

const toSpan = (f: Folded, start: number, len: number): Span => ({ start: f.from[start], end: f.to[start + len - 1] });

/** Pieces of a quote joined by an ellipsis ("...", "…", "[...]"), surrounding quote marks removed. */
export function quotePieces(quote: string): string[] {
  const q = (quote ?? "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  return q.split(/\s*(?:\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…)\s*/).map(p => p.trim()).filter(Boolean);
}

/** Folded text for both passes, built once per document and reused for every quote. */
export interface Prepared { raw: string; spaced: Folded; tight: Folded }
export function prepare(text: string): Prepared {
  return { raw: text, spaced: fold(text), tight: fold(text, { keepSpace: false }) };
}

const MIN_LOCATE_CHARS = 8;

function locateIn(f: Folded, pieces: string[], near: number | undefined): { spans: Span[]; places: number } | null {
  if (!pieces.length || pieces.some(p => !p)) return null;
  const firstStarts = allStarts(f.s, pieces[0]);
  if (!firstStarts.length) return null;
  // Try each place the first piece occurs, nearest the hint first.
  const order = [...firstStarts];
  if (near !== undefined) order.sort((a, b) => Math.abs(f.from[a] - near) - Math.abs(f.from[b] - near));
  let places = 0;
  let chosen: Span[] | null = null;
  for (const start of order) {
    const spans: Span[] = [toSpan(f, start, pieces[0].length)];
    let cursor = start + pieces[0].length;
    let ok = true;
    for (const p of pieces.slice(1)) {
      const at = f.s.indexOf(p, cursor);
      if (at < 0) { ok = false; break; }
      spans.push(toSpan(f, at, p.length));
      cursor = at + p.length;
    }
    if (ok) { places++; if (!chosen) chosen = spans; }
  }
  return chosen ? { spans: chosen, places } : null;
}

/**
 * Where a stored quote sits in the stored text.
 * `near` is a raw position to prefer when the quote appears more than once.
 */
export function locateQuote(text: string | Prepared, quote: string, near?: number): Located {
  const p = typeof text === "string" ? prepare(text) : text;
  const rawPieces = quotePieces(quote);
  const spacedPieces = rawPieces.map(x => foldQuery(x));
  if (spacedPieces.join("").length < MIN_LOCATE_CHARS) return { status: "missing" };

  const exact = locateIn(p.spaced, spacedPieces, near);
  if (exact) return { status: "found", spans: exact.spans, places: exact.places, pass: "exact" };

  // A trailing full stop or comma the text does not have (factQuoteInText's tolerance).
  const trimmedLast = [...spacedPieces];
  trimmedLast[trimmedLast.length - 1] = trimmedLast[trimmedLast.length - 1].replace(/[.,;:!?]+$/, "");
  if (trimmedLast[trimmedLast.length - 1] !== spacedPieces[spacedPieces.length - 1]) {
    const t = locateIn(p.spaced, trimmedLast, near);
    if (t) return { status: "found", spans: t.spans, places: t.places, pass: "exact" };
  }

  const tightPieces = rawPieces.map(x => foldQuery(x, { keepSpace: false }));
  const tight = locateIn(p.tight, tightPieces, near)
    ?? locateIn(p.tight, tightPieces.map((x, i) => (i === tightPieces.length - 1 ? x.replace(/[.,;:!?]+$/, "") : x)), near);
  if (tight) return { status: "found", spans: tight.spans, places: tight.places, pass: "spacing" };
  return { status: "missing" };
}

/** Is a raw position at a word boundary? */
const WORDY = /[\p{L}\p{N}]/u;
function boundaryBefore(raw: string, i: number) { return i <= 0 || !WORDY.test(raw[i - 1]); }
function boundaryAfter(raw: string, i: number) { return i >= raw.length || !WORDY.test(raw[i]); }

/**
 * Every match of a search in the text, in order, as raw spans. Case-insensitive
 * by default; spacing is compared loosely, as for quotes. `wholeWord` keeps
 * only matches that start and end on a word boundary. At most `max` matches.
 */
export function findAll(text: string | Prepared, query: string,
  opts: { matchCase?: boolean; wholeWord?: boolean; max?: number } = {}): Span[] {
  const raw = typeof text === "string" ? text : text.raw;
  const q = (query ?? "").trim();
  if (!q) return [];
  const f = opts.matchCase
    ? fold(raw, { keepCase: true })
    : (typeof text === "string" ? fold(raw) : text.spaced);
  const needle = foldQuery(q, { keepCase: !!opts.matchCase });
  if (!needle) return [];
  const out: Span[] = [];
  const max = opts.max ?? 2000;
  let at = f.s.indexOf(needle);
  while (at >= 0 && out.length < max) {
    const span = toSpan(f, at, needle.length);
    if (!opts.wholeWord || (boundaryBefore(raw, span.start) && boundaryAfter(raw, span.end))) out.push(span);
    at = f.s.indexOf(needle, at + Math.max(1, needle.length));
  }
  return out;
}
