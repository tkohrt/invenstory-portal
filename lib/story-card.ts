// Story Cards: the pure half.
//
// A Story Card is one claim-sized piece of a client's story with the verbatim
// quote that proves it. This file holds every rule that decides whether a
// candidate the model proposed may become a card, and how cards found in
// different documents are recognised as the same card. Everything here is pure
// and free of `server-only`, so each rule can be tested without a database or a
// model, the same split as lib/search-profile.ts.
//
// The discipline is the readiness engine's, carried over deliberately: the
// prompt ASKS for a verbatim quote and the right subject; this file DECIDES.
// A rule that lives only in a prompt is a request, and the readiness work showed
// what requests are worth under load.

export type CardSubject = "organization" | "competitor" | "third_party";
export type CardLayer = "I" | "II" | "III";
export type CardStrength = "covered" | "thin";
export type CardStatus = "suggested" | "verified" | "retired";

export interface CardKind {
  key: string;
  label: string;
  /** Who it applies to. Mirrors checklistFor(): for_profit is the startup branch. */
  audience: "all" | "nonprofit" | "startup";
  /** The readiness checklist item this kind evidences, when one applies. */
  itemKey: string | null;
  /** What a card of this kind says. Shown to the model and in the library. */
  describe: string;
  /**
   * Whether a fact ABOUT SOMEONE ELSE may make this kind of card. Only the
   * relationship and voice kinds: a partner's commitment is evidence of a
   * partnership, a participant's own words are evidence of impact. Everywhere
   * else a third-party fact describes somebody who is not the client.
   */
  allowsThirdParty: boolean;
}

/** Spec section 2, approved as written on 29 September 2026. */
export const CARD_KINDS: CardKind[] = [
  { key: "mission_values", label: "Mission & values", audience: "all", itemKey: "mission", allowsThirdParty: false,
    describe: "what the organization exists to do, and the values it works by" },
  { key: "origin_history", label: "Origin & history", audience: "all", itemKey: "capacity", allowsThirdParty: false,
    describe: "how and why it started, and milestones in its history" },
  { key: "need_data", label: "Need: the data", audience: "all", itemKey: "need", allowsThirdParty: false,
    describe: "the problem it addresses, stated with figures or statistics" },
  { key: "need_story", label: "Need: the story", audience: "all", itemKey: "need", allowsThirdParty: false,
    describe: "the problem it addresses, told through a specific situation, place or person" },
  { key: "population_geography", label: "Who & where", audience: "all", itemKey: null, allowsThirdParty: false,
    describe: "who it serves and where, as specifically as the document says" },
  { key: "program_model", label: "Program model", audience: "all", itemKey: "program", allowsThirdParty: false,
    describe: "what it actually delivers and how the work runs" },
  { key: "outcome_metric", label: "Outcome or metric", audience: "all", itemKey: "outcomes", allowsThirdParty: false,
    describe: "a result it achieved or a measure it tracks, with the figure" },
  { key: "beneficiary_story", label: "Beneficiary story", audience: "all", itemKey: "client_story", allowsThirdParty: true,
    describe: "a specific person, family or group it served and what changed for them" },
  { key: "client_voice", label: "In their words", audience: "all", itemKey: "client_story", allowsThirdParty: true,
    describe: "a first-person line from someone it serves or works with, in their own words" },
  { key: "leadership_team", label: "Leadership & team", audience: "all", itemKey: "leadership", allowsThirdParty: false,
    describe: "who leads the work and the experience they bring" },
  { key: "capacity_track_record", label: "Track record", audience: "all", itemKey: "capacity", allowsThirdParty: false,
    describe: "what it has already delivered: years operating, people served, projects completed" },
  { key: "partnership", label: "Partnership", audience: "all", itemKey: "partnerships", allowsThirdParty: true,
    describe: "a named partner and what the partnership does" },
  { key: "finance_budget", label: "Finances", audience: "all", itemKey: "budget", allowsThirdParty: false,
    describe: "its budget, revenue, costs or funding, with figures" },
  { key: "sustainability", label: "Sustainability", audience: "all", itemKey: "sustainability", allowsThirdParty: false,
    describe: "how the work continues beyond a single grant" },
  { key: "equity_approach", label: "Equity approach", audience: "all", itemKey: "equity", allowsThirdParty: false,
    describe: "how it approaches equity, access and inclusion in the work" },
  { key: "differentiator", label: "What sets it apart", audience: "all", itemKey: null, allowsThirdParty: false,
    describe: "what a program officer would remember about it that others in the field cannot claim" },
  { key: "traction", label: "Traction", audience: "startup", itemKey: "traction", allowsThirdParty: false,
    describe: "paying customers, contracts, revenue, pilots or usage, with figures" },
  { key: "market", label: "Market", audience: "startup", itemKey: "go_to_market", allowsThirdParty: false,
    describe: "the market it sells into, its size, and how it reaches customers" },
];

export const CARD_KIND_MAP: Record<string, CardKind> =
  Object.fromEntries(CARD_KINDS.map(k => [k.key, k]));

/** The kinds for a client's org type, using checklistFor()'s rule. */
export function kindsFor(orgType: string | null | undefined): CardKind[] {
  const branch = orgType === "for_profit" ? "startup" : "nonprofit";
  return CARD_KINDS.filter(k => k.audience === "all" || k.audience === branch);
}

// ---------------------------------------------------------------------------
// Text normalisation, shared by the quote check and the fingerprint.
// ---------------------------------------------------------------------------

/**
 * Lower-case, straighten quotes and dashes, collapse whitespace.
 *
 * Documents arrive through PDF and Word extraction, which is where curly quotes,
 * non-breaking spaces and hyphenation break an exact comparison. None of those
 * changes what a sentence says, so none of them may decide whether a quote is
 * real.
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00ad/g, "")               // soft hyphen, invisible in the source
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this quote actually in the document?
 *
 * The single most important check in the Card Library. A card whose quote is not
 * in its document is a fabrication with a citation attached, which is worse than
 * no card, because the citation makes it look checked.
 *
 * Tolerates exactly one kind of model editing: an ellipsis joining pieces of the
 * source. Each piece must then appear, in order, and be long enough to mean
 * something. Nothing else is tolerated: a paraphrase, however faithful, fails.
 */
export const MIN_QUOTE_CHARS = 20;
const MIN_PIECE_CHARS = 12;

export function quoteInText(quote: string, text: string): boolean {
  const q = normalizeText(quote).replace(/^["']+|["']+$/g, "").trim();
  if (q.length < MIN_QUOTE_CHARS) return false;
  const t = normalizeText(text);
  if (t.includes(q)) return true;

  const pieces = q.split(/\s*(?:\.\.\.|\u2026|\[\.\.\.\])\s*/).map(p => p.trim()).filter(Boolean);
  if (pieces.length < 2) return false;
  if (pieces.some(p => p.length < MIN_PIECE_CHARS)) return false;
  let from = 0;
  for (const p of pieces) {
    const at = t.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

/** Where the quote starts in the ORIGINAL text, for speaker attribution. -1 if not found. */
export function quoteOffset(quote: string, text: string): number {
  const first = quote.split(/\s*(?:\.\.\.|\u2026)\s*/)[0]?.trim() ?? "";
  if (!first) return -1;
  const direct = text.indexOf(first);
  if (direct >= 0) return direct;
  // Fall back to a case-insensitive search on the first few words.
  const head = first.split(/\s+/).slice(0, 6).join(" ").toLowerCase();
  return head ? text.toLowerCase().indexOf(head) : -1;
}

// ---------------------------------------------------------------------------
// Figures.
// ---------------------------------------------------------------------------

/**
 * Every number in a piece of text, normalised so "$7,000" and "7000" match.
 *
 * Deliberately literal. "7K" and "seven thousand" do not become 7000, because a
 * statement that says 7,000 where the source says "about seven thousand" has
 * changed the claim's precision, and a funder reads precision as a promise.
 */
export function figuresIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    let n = m[0].replace(/,/g, "");
    if (n.includes(".")) n = n.replace(/\.?0+$/, "");
    if (n) out.add(n);
  }
  return [...out];
}

/**
 * The figures a statement uses that its quote does not contain.
 *
 * Empty means every figure is traceable. A card's statement is written by the
 * model, and the one edit it must never make is a number: rounding, converting a
 * percentage, adding a year. Any figure it introduces fails the candidate.
 */
export function untracedFigures(statement: string, quote: string): string[] {
  const inQuote = new Set(figuresIn(quote));
  return figuresIn(statement).filter(n => !inQuote.has(n));
}

// ---------------------------------------------------------------------------
// Subject.
// ---------------------------------------------------------------------------

/**
 * What a candidate's subject means for the card, or null to refuse it.
 *
 * Competitor facts never become cards, of any kind: a card is something a writer
 * may put in the client's own application. Third-party facts only for the kinds
 * that exist to hold them.
 */
export function cardSubject(kind: string, subject: CardSubject): "organization" | "third_party" | null {
  if (subject === "competitor") return null;
  if (subject === "third_party") return CARD_KIND_MAP[kind]?.allowsThirdParty ? "third_party" : null;
  return "organization";
}

// ---------------------------------------------------------------------------
// Candidates: what the model proposes, and whether it may become a card.
// ---------------------------------------------------------------------------

export interface CardCandidate {
  kind: string;
  statement: string;
  quote: string;
  subject: CardSubject;
  strength: CardStrength;
}

/** A candidate that passed every check, carrying what the checks established. */
export interface AcceptedCandidate extends CardCandidate {
  subject: "organization" | "third_party";
  hasFigures: boolean;
  speaker: string | null;
}

export interface RejectedCandidate {
  kind: string;
  statement: string;
  quote: string;
  reason: RejectReason;
}

export type RejectReason =
  | "unknown_kind" | "no_quote" | "quote_not_found" | "untraced_figures"
  | "competitor" | "third_party_not_allowed" | "too_short" | "too_long";

const SUBJECTS = new Set<CardSubject>(["organization", "competitor", "third_party"]);

/**
 * Parse the model's answer into candidates. Lenient about shape, strict about
 * nothing yet: validation is a separate step so a refusal can say why.
 */
export function parseCandidates(raw: string): CardCandidate[] {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr: unknown;
  try { arr = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: CardCandidate[] = [];
  for (const o of arr) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const subject = SUBJECTS.has(r.subject as CardSubject) ? r.subject as CardSubject : "organization";
    out.push({
      kind: str(r.kind),
      statement: str(r.statement).slice(0, 900),
      quote: str(r.quote).slice(0, 1200),
      subject,
      strength: r.strength === "covered" ? "covered" : "thin",
    });
  }
  return out;
}

export const MIN_STATEMENT_WORDS = 8;
export const MAX_STATEMENT_WORDS = 90;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Decide one candidate against the document it came from.
 *
 * `text` is the WHOLE document, not the window, so a quote that straddles a
 * window boundary is still found. `allowedKinds` is the client's list from
 * kindsFor(). `reattribute`, when given, moves a first-person quote by an
 * outsider in a transcript away from the organization (see
 * lib/transcript-speakers.ts) and names the speaker.
 */
export function checkCandidate(
  c: CardCandidate, text: string, allowedKinds: Set<string>,
  reattribute?: (quote: string, subject: CardSubject) => { subject: CardSubject; speaker: string | null },
): { ok: true; card: AcceptedCandidate } | { ok: false; rejected: RejectedCandidate } {
  const reject = (reason: RejectReason) => ({
    ok: false as const,
    rejected: { kind: c.kind, statement: c.statement, quote: c.quote, reason },
  });

  if (!allowedKinds.has(c.kind)) return reject("unknown_kind");
  if (!c.quote) return reject("no_quote");
  const n = words(c.statement);
  if (n < MIN_STATEMENT_WORDS) return reject("too_short");
  if (n > MAX_STATEMENT_WORDS) return reject("too_long");
  if (!quoteInText(c.quote, text)) return reject("quote_not_found");
  if (untracedFigures(c.statement, c.quote).length) return reject("untraced_figures");

  const who = reattribute ? reattribute(c.quote, c.subject) : { subject: c.subject, speaker: null };
  if (who.subject === "competitor") return reject("competitor");
  const subject = cardSubject(c.kind, who.subject);
  if (!subject) return reject("third_party_not_allowed");

  return {
    ok: true,
    card: {
      ...c, subject,
      hasFigures: figuresIn(c.quote).length > 0,
      speaker: who.speaker,
    },
  };
}

// ---------------------------------------------------------------------------
// Identity: when are two candidates the same card?
// ---------------------------------------------------------------------------

/** Words that carry no claim. Removed before comparing two statements. */
const STOP = new Set((
  "a an the and or but of to in on at for with by from as is are was were be been being it its this that these those " +
  "their they them we our us has have had do does did will would can could should may might not no than then so such " +
  "into over under about through across per each every also which who whom whose what when where how all any some more most"
).split(" "));

/** The content words of a statement, singular-ish, de-duplicated and sorted. */
export function claimTokens(statement: string): string[] {
  const toks = normalizeText(statement)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t && !STOP.has(t))
    .map(t => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
  return [...new Set(toks)].sort();
}

/** FNV-1a, 32-bit. Stable across runtimes; not a security hash and not used as one. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The identity of a card across documents.
 *
 * Built from the kind and the claim's content words, order ignored, so the same
 * sentence found in the website capture and the board deck becomes one card
 * with two pieces of evidence rather than two cards. Exact by design: anything
 * looser belongs in similarity(), which may only SUGGEST a merge.
 */
export function cardFingerprint(kind: string, statement: string): string {
  const toks = claimTokens(statement);
  return `${kind}:${toks.length}:${fnv(toks.join(" "))}`;
}

/** Overlap of two statements' content words, 0 to 1 (Jaccard). */
export function similarity(a: string, b: string): number {
  const A = new Set(claimTokens(a));
  const B = new Set(claimTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Above this, two cards of the same kind are flagged as a possible duplicate
 * for an admin to merge or dismiss. Never merged automatically.
 */
export const DUPLICATE_THRESHOLD = 0.6;

export interface DupCard { id: string; kind: string; statement: string; createdAt: string; dismissed: boolean }

/**
 * For each card that looks like an earlier card of the same kind, the earlier
 * card's id. The newer card is the one flagged, so the older one (usually the
 * one already reviewed) is the suggested survivor.
 */
export function findPossibleDuplicates(cards: DupCard[]): Map<string, string> {
  const out = new Map<string, string>();
  const byKind = new Map<string, DupCard[]>();
  for (const c of cards) {
    const list = byKind.get(c.kind) ?? [];
    list.push(c);
    byKind.set(c.kind, list);
  }
  for (const list of byKind.values()) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (let i = 1; i < sorted.length; i++) {
      const c = sorted[i];
      if (c.dismissed) continue;
      let best: { id: string; score: number } | null = null;
      for (let j = 0; j < i; j++) {
        const s = similarity(c.statement, sorted[j].statement);
        if (s >= DUPLICATE_THRESHOLD && (!best || s > best.score)) best = { id: sorted[j].id, score: s };
      }
      if (best) out.set(c.id, best.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembling a card from its evidence.
// ---------------------------------------------------------------------------

/**
 * Which layer a card shows as.
 *
 * Living voice first, because it is the rarest material and the kind a drafted
 * answer most often lacks: a card backed by both an interview and the website
 * should be recognisable as having a voice behind it. Then internal, then public.
 */
const LAYER_RANK: Record<CardLayer, number> = { III: 3, II: 2, I: 1 };
export function displayLayer(layers: (string | null | undefined)[]): CardLayer | null {
  let best: CardLayer | null = null;
  for (const l of layers) {
    if (l !== "I" && l !== "II" && l !== "III") continue;
    if (!best || LAYER_RANK[l] > LAYER_RANK[best]) best = l;
  }
  return best;
}

export function strongest(a: CardStrength, b: CardStrength): CardStrength {
  return a === "covered" || b === "covered" ? "covered" : "thin";
}

/**
 * A cheap fingerprint of a document's text, in search_profile_doc's format, so a
 * document re-processed in place is re-read rather than trusted forever.
 */
export function contentHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** Plain-language reasons, for the audit column in the library. */
export const REJECT_LABEL: Record<RejectReason, string> = {
  unknown_kind: "not one of this client's card kinds",
  no_quote: "no supporting quote",
  quote_not_found: "quote is not in the document",
  untraced_figures: "statement uses a figure the quote does not contain",
  competitor: "about a competitor",
  third_party_not_allowed: "about someone else, in a kind that must describe the client",
  too_short: "statement too short to stand alone",
  too_long: "statement too long to be one card",
};
