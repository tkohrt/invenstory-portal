// Weave: short connecting sentences between the pieces of an answer. The pure half.
//
// The model proposes a bridge between two neighbouring pieces; code decides
// whether it may be shown (spec 7.3). A bridge may join, never inform: it may
// not bring in a number, a name, or a quotation that the two pieces it sits
// between do not already contain. A bridge that fails is discarded, not shown,
// and nothing a writer has not accepted reaches the answer's text.
//
// Free of `server-only`; tested in tests/drafter/weave.test.ts.

export interface WeavePiece {
  id: string;
  kind: "card" | "bridge" | "human";
  text: string;
  breakBefore: boolean;
}

/**
 * Where a bridge may go: after piece i, before piece i + 1, when both are
 * written pieces (a card or a writer's own words) with text, inside one
 * paragraph, and no bridge already sits between them. Returns the index of the
 * piece the bridge would follow.
 */
export function bridgeGaps(pieces: WeavePiece[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pieces.length; i++) {
    const a = pieces[i], b = pieces[i + 1];
    if (a.kind === "bridge" || b.kind === "bridge") continue;
    if (!a.text.trim() || !b.text.trim()) continue;
    if (b.breakBefore) continue;
    out.push(i);
  }
  return out;
}

export interface ProposedBridge { after: number; text: string }

/**
 * Read the model's reply: {"bridges": [{"after": 2, "text": "..."}]}, where
 * `after` is the 1-based number of the piece the bridge follows. Only gaps that
 * were offered are kept, at most one bridge per gap. Returns null when the
 * reply is not that shape at all.
 */
export function parseWeave(raw: string, gaps: number[]): ProposedBridge[] | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: unknown;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const list = (j as { bridges?: unknown }).bridges;
  if (!Array.isArray(list)) return null;
  const offered = new Set(gaps);
  const seen = new Set<number>();
  const out: ProposedBridge[] = [];
  for (const x of list) {
    const o = x as { after?: unknown; text?: unknown };
    const n = typeof o.after === "string" ? Number(o.after) : o.after;
    if (typeof n !== "number" || !Number.isInteger(n)) continue;
    const at = n - 1;
    if (!offered.has(at) || seen.has(at)) continue;
    if (typeof o.text !== "string") continue;
    const text = o.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    seen.add(at);
    out.push({ after: at, text });
  }
  return out.sort((a, b) => a.after - b.after);
}

/** Bridges are short: a clause or a sentence, never a paragraph. */
export const BRIDGE_WORDS = { min: 3, max: 30 };

const NUMBER_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
  "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "million",
  "millions", "billion", "billions", "dozen", "dozens", "half", "twice", "triple", "double", "percent",
  "first", "second", "third", "fourth", "fifth", "tenth",
]);

/**
 * Words that may open a sentence with a capital without being a name. A
 * capitalised word that is not one of these, and is not in the neighbouring
 * pieces, is treated as a name and refuses the bridge: a wrongly refused bridge
 * costs a writer nothing, a wrongly admitted name could put an invented
 * partner or place into a grant.
 */
const STARTERS = new Set([
  "a", "an", "the", "this", "these", "that", "those", "it", "its", "they", "their", "them", "we", "our", "us",
  "and", "but", "so", "yet", "or", "nor", "also", "as", "at", "by", "for", "from", "in", "into", "of", "on",
  "to", "with", "without", "within", "through", "throughout", "beyond", "behind", "alongside", "across",
  "after", "before", "because", "since", "while", "when", "where", "which", "who", "whose", "how", "why",
  "what", "each", "every", "both", "all", "such", "many", "most", "more", "much", "other", "another", "some",
  "together", "building", "drawing", "taken", "put", "here", "there", "then", "now", "today", "still",
  "even", "just", "only", "beyond", "above", "below", "further", "furthermore", "moreover", "however",
  "meanwhile", "likewise", "similarly", "indeed", "in", "if", "once", "until", "over", "under", "between",
  "among", "against", "toward", "towards", "upon", "rather", "instead", "thus", "therefore", "accordingly",
  "consequently", "ultimately", "finally", "first", "next", "beyond", "crucially", "importantly", "notably",
  "equally", "not", "no", "my", "your", "his", "her", "he", "she", "one", "i",
]);

export type BridgeRefusal = "length" | "number" | "name" | "quotation" | "symbol";

export const REFUSAL_REASON: Record<BridgeRefusal, string> = {
  length: "too short or too long for a bridge",
  number: "a number not in the cards beside it",
  name: "a name not in the cards beside it",
  quotation: "a quotation",
  symbol: "a figure symbol ($, %, #)",
};

const wordsOf = (t: string) => t.match(/[A-Za-z][A-Za-z'’.-]*|\d[\d,.]*/g) ?? [];

/**
 * May this bridge be shown between these two pieces? Returns the reason it may
 * not, or null when it may.
 *
 *   - Length: BRIDGE_WORDS.
 *   - Numbers: no digit, and no number word (three, dozen, percent, first),
 *     unless that same word or figure is in the neighbouring pieces.
 *   - Symbols: no $, %, # at all; figures belong to cards.
 *   - Quotations: no double quotation marks at all.
 *   - Names: every capitalised word, and every acronym, must appear in the
 *     neighbouring pieces, except a common word opening a sentence.
 */
export function checkBridge(text: string, before: string, after: string): BridgeRefusal | null {
  const t = text.replace(/\s+/g, " ").trim();
  const n = t ? t.split(" ").length : 0;
  if (n < BRIDGE_WORDS.min || n > BRIDGE_WORDS.max) return "length";
  if (/["“”„«»]/.test(t)) return "quotation";
  if (/[$%#€£]/.test(t)) return "symbol";

  const around = `${before} ${after}`;
  const bare = (w: string) => w.replace(/[.,]+$/, "").replace(/['’]s$/, "");
  const aroundWords = new Set(wordsOf(around).flatMap(w => [w.replace(/[.,]+$/, ""), bare(w)]));
  const aroundLower = new Set([...aroundWords].map(w => w.toLowerCase()));

  // Numbers.
  for (const d of t.match(/\d[\d,.]*/g) ?? []) {
    const fig = d.replace(/[.,]+$/, "");
    if (!aroundWords.has(fig)) return "number";
  }
  for (const w of wordsOf(t)) {
    const lw = w.replace(/[.,]+$/, "").toLowerCase();
    if (NUMBER_WORDS.has(lw) && !aroundLower.has(lw)) {
      // "first" and "second" are ordinary connectives ("First, ...", "the first step"); allowed.
      if (lw === "first" || lw === "second") continue;
      return "number";
    }
  }

  // Names: walk the words, knowing which open a sentence.
  const tokens = t.split(" ");
  let sentenceStart = true;
  for (const raw of tokens) {
    const w = raw.replace(/^[(\['‘’]+/, "").replace(/[)\]'‘’.,;:!?—–-]+$/, "");
    if (w && /^[A-Z]/.test(w)) {
      const acronym = /^[A-Z]{2,}s?$/.test(w);
      const known = aroundWords.has(w) || aroundWords.has(bare(w));
      const starter = sentenceStart && !acronym && (STARTERS.has(w.toLowerCase()) || aroundLower.has(w.toLowerCase()));
      if (!known && !starter) return "name";
    }
    if (w) sentenceStart = /[.!?:]['’")\]]*$/.test(raw);
  }
  return null;
}

/** The bridges that pass, and how many were set aside, by reason. */
export function screenBridges(proposed: ProposedBridge[], pieces: WeavePiece[]):
  { kept: ProposedBridge[]; refused: { after: number; text: string; reason: BridgeRefusal }[] } {
  const kept: ProposedBridge[] = [];
  const refused: { after: number; text: string; reason: BridgeRefusal }[] = [];
  for (const p of proposed) {
    const a = pieces[p.after], b = pieces[p.after + 1];
    if (!a || !b) continue;
    const reason = checkBridge(p.text, a.text, b.text);
    if (reason) refused.push({ ...p, reason }); else kept.push(p);
  }
  return { kept, refused };
}

// ---------------------------------------------------------------------------
// The reminder before weaving.
// ---------------------------------------------------------------------------

/** Used until real weaves have been measured: about four and a half cents a question. */
export const WEAVE_COST_FALLBACK_MICROS = 45_000;

/**
 * The share of a monthly allowance one weave uses, as a person reads it:
 * "about 0.2%". Rounded to one decimal place, never shown as 0%.
 */
export function weaveShareLabel(costMicros: number, allowanceMicros: number): string {
  if (allowanceMicros <= 0) return "a small part";
  const pct = (costMicros / allowanceMicros) * 100;
  if (pct < 0.1) return "less than 0.1%";
  return `about ${(Math.round(pct * 10) / 10).toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * Should the reminder show? Always, unless the person turned it off; and
 * even then once the client has used 80% of the month's allowance, when it is
 * worth knowing again.
 */
export function weaveReminderDue(remindersOn: boolean, shareUsed: number): boolean {
  return remindersOn || shareUsed >= 0.8;
}
