// Which Story Cards to offer for a question, and why. The pure half.
//
// Spec section 8: version 1 is deterministic and explainable. The model is used
// once per section, upstream, to classify the question into bank slugs and the
// card kinds it calls for (Phase 2 did that, and a person confirmed it). It is
// never used here to route individual facts by label similarity: the readiness
// work showed that similarity of a short label scatters facts into the wrong
// buckets. Similarity is allowed exactly one job below, breaking ties.
//
// Every weight lives in WEIGHTS so it can be tuned in one place, and every score
// carries its parts, so a ranking can always be explained to the writer and
// logged with the event that showed it.
//
// Free of `server-only` so it is unit tested (tests/drafter/story-card-rank.test.ts).

export const WEIGHTS = {
  /** The card is a kind this question calls for. */
  kind: 3.0,
  /** The card evidences a readiness item this question's bank slug draws on. */
  item: 1.5,
  /** The card's evidence is full, not thin. */
  covered: 1.0,
  /** A person has verified the card. */
  verified: 1.0,
  /** Its newest evidence is recent. */
  fresh: 0.5,
  /** A living-voice card, while the answer has none yet. */
  voice: 0.5,
  /** Already used in another section of this application. Negative. */
  usedElsewhere: -1.0,
  /** Word overlap between the question and the statement. Tie-breaker only. */
  similarity: 0.5,
} as const;

/** "Newest evidence within 18 months" (spec section 8). */
export const FRESH_MONTHS = 18;

/** How many cards the panel shows before "show more" (spec 7.1: 8 to 12). */
export const PANEL_SIZE = 10;

/**
 * The readiness checklist items each seeded bank question draws on.
 *
 * The kind weight already says which KINDS a question wants; this says which
 * checklist ITEMS. They differ where the extraction tagged a card to an item its
 * kind does not imply (a track-record card tagged to partnerships, say), which is
 * exactly when the item is the better signal. Keys are lib/checklist.ts keys.
 */
export const SLUG_ITEMS: Record<string, string[]> = {
  "org-overview":   ["mission", "public_story", "program"],
  "leadership":     ["leadership", "capacity", "board_roster"],
  "use-of-funds":   ["budget", "program_budgets", "program"],
  "need":           ["need"],
  "who-you-serve":  ["need", "client_story"],
  "program":        ["program", "partnerships"],
  "goals":          ["outcomes", "program"],
  "outcomes":       ["outcomes", "eval_reports", "client_story"],
  "history":        ["capacity", "annual_report", "past_grants"],
  "financial":      ["budget", "other_funding", "irs_990"],
  "sustainability": ["sustainability", "other_funding", "budget"],
  "partnerships":   ["partnerships", "strategic_partners"],
  "problem":        ["need", "go_to_market"],
  "solution":       ["program", "competition"],
  "market":         ["go_to_market"],
  "traction":       ["traction", "outcomes", "strategic_partners"],
  "business-model": ["budget", "financial_model", "go_to_market"],
  "competition":    ["competition", "partnerships"],
  "milestones":     ["sustainability", "traction", "financial_model"],
};

export interface RankCard {
  id: string;
  kind: string;
  itemKey: string | null;
  strength: "covered" | "thin";
  status: "suggested" | "verified" | "retired";
  layer: "I" | "II" | "III" | null;
  statement: string;
  /** ISO date of the newest document behind the card, or null. */
  newestEvidenceAt: string | null;
}

export interface RankSection {
  prompt: string;
  guidance?: string | null;
  wantedKinds: string[];
  slugs: string[];
}

export interface RankContext {
  now: Date;
  /** Cards placed in OTHER sections of this application. */
  usedElsewhere: ReadonlySet<string>;
  /** Cards already in THIS section: not offered again. */
  inSection: ReadonlySet<string>;
  /** Whether this section's answer already holds a Layer III card. */
  sectionHasVoice: boolean;
  /** Phase 7's preference prior. Zero until then, and nothing passes it yet. */
  prior?: (card: RankCard) => number;
}

export interface ScoreParts {
  kind: number; item: number; covered: number; verified: number;
  fresh: number; voice: number; usedElsewhere: number; similarity: number; prior: number;
}

export interface Ranked {
  card: RankCard;
  score: number;
  parts: ScoreParts;
  /** 1-based position in the ranking, as logged with a `shown` event. */
  position: number;
}

// ---------------------------------------------------------------------------
// Similarity: word overlap, not embeddings.
// ---------------------------------------------------------------------------

const STOP = new Set((
  "a an and are as at be by for from has have how in into is it its of on or our "
  + "that the their them they this to was we were what when where which who will "
  + "with your you describe please provide explain include including any how why "
  + "organization organizations organisation work"
).split(" "));

function words(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)) {
    const t = w.replace(/^-+|-+$/g, "");
    if (t.length < 3 || STOP.has(t)) continue;
    // A crude stem: enough to meet "students" with "student", no more.
    out.add(t.length > 4 ? t.replace(/(ies|es|s)$/, "") : t);
  }
  return out;
}

/**
 * Share of the question's content words that the statement also uses, 0 to 1.
 *
 * Deliberately not embeddings: the cards have none stored, computing them per
 * question would put a slow edge-function round trip in front of every section,
 * and Phase 1 already showed word overlap is good enough to SUGGEST. It never
 * decides anything here; at half a point it can only reorder near-equals.
 */
export function overlap(question: string, statement: string): number {
  const q = words(question);
  if (!q.size) return 0;
  const s = words(statement);
  let hit = 0;
  for (const w of q) if (s.has(w)) hit += 1;
  return hit / q.size;
}

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

function monthsBetween(a: Date, b: Date) {
  return (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

export function scoreCard(card: RankCard, section: RankSection, ctx: RankContext): { score: number; parts: ScoreParts } {
  const items = new Set(section.slugs.flatMap(s => SLUG_ITEMS[s] ?? []));
  const newest = card.newestEvidenceAt ? new Date(card.newestEvidenceAt) : null;
  const parts: ScoreParts = {
    kind: section.wantedKinds.includes(card.kind) ? WEIGHTS.kind : 0,
    item: card.itemKey && items.has(card.itemKey) ? WEIGHTS.item : 0,
    covered: card.strength === "covered" ? WEIGHTS.covered : 0,
    verified: card.status === "verified" ? WEIGHTS.verified : 0,
    fresh: newest && !Number.isNaN(newest.getTime()) && monthsBetween(ctx.now, newest) <= FRESH_MONTHS ? WEIGHTS.fresh : 0,
    voice: card.layer === "III" && !ctx.sectionHasVoice ? WEIGHTS.voice : 0,
    usedElsewhere: ctx.usedElsewhere.has(card.id) ? WEIGHTS.usedElsewhere : 0,
    similarity: WEIGHTS.similarity * overlap(`${section.prompt} ${section.guidance ?? ""}`, card.statement),
    prior: ctx.prior ? ctx.prior(card) : 0,
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  return { score: Math.round(score * 1000) / 1000, parts };
}

/**
 * Every card a writer may place in this section, best first.
 *
 * Retired cards are never offered. Cards already in this section are left out:
 * removing a block is what returns a card to the panel (spec 7.2). Ties break on
 * the similarity part, then on id, so the same inputs always give the same order
 * and a logged position always means the same thing.
 */
export function rankCards(cards: RankCard[], section: RankSection, ctx: RankContext): Ranked[] {
  return cards
    .filter(c => c.status !== "retired" && !ctx.inSection.has(c.id))
    .map(card => ({ card, ...scoreCard(card, section, ctx) }))
    .sort((a, b) => b.score - a.score || b.parts.similarity - a.parts.similarity || a.card.id.localeCompare(b.card.id))
    .map((r, i) => ({ ...r, position: i + 1 }));
}

/**
 * The one-line reason shown on a card in the panel.
 *
 * Built from the parts that actually scored, strongest first, so it can never
 * claim a reason the ranking did not use. `kindLabel` and `source` come from the
 * caller (the kind's display name, the newest document's title).
 */
export function reasonFor(r: Ranked, kindLabel: string, source: string | null): string {
  const bits: string[] = [];
  if (r.parts.kind) bits.push(`the question asks for ${kindLabel.toLowerCase()}`);
  else if (r.parts.item) bits.push("draws on the same readiness item as this question");
  if (r.parts.voice) bits.push("adds a living voice the answer lacks");
  if (r.parts.usedElsewhere) bits.push("already used in another answer here");
  if (!bits.length && r.parts.similarity >= WEIGHTS.similarity * 0.25) bits.push("shares wording with the question");
  if (!bits.length) bits.push("not a kind this question asks for");
  const status = r.card.status === "verified" ? "verified" : "not yet verified";
  const thin = r.card.strength === "thin" ? ", thin evidence" : "";
  const from = source ? `; from ${source}` : "";
  const line = bits.join("; ");
  return `${line[0].toUpperCase()}${line.slice(1)}${from} (${status}${thin}).`;
}
