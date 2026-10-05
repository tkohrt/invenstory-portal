// Inven(s)tory Analysis: the pure half of the one read.
//
// Phase A of "Inven(s)tory Analysis: Read Once, Unlock Everything" (spec draft,
// 1 October 2026). One model read of each document returns three things:
//
//   1. what kind of document it is (a 990, a determination letter, a pitch deck,
//      a founder interview, ...),
//   2. the Story Cards in it, each with its verbatim quote,
//   3. the facts in it (EIN, budget, state, populations served, ...), each with
//      its verbatim quote.
//
// Phase B derives readiness, eligibility suggestions and the search profile
// from these in code, with no further reading. Nothing here is wired into any
// of those yet: Phase A runs beside the current reads and changes nothing a
// client sees.
//
// The discipline is the readiness engine's and the Card Library's: the prompt
// ASKS, this file DECIDES. Cards go through exactly the same checkCandidate()
// as the Card Library, so the 50-card review judges the same rules. Facts get
// checks of their own, below. Pure and free of `server-only`, so every rule is
// tested without a database or a model.

import {
  parseCandidates, checkCandidate, quoteInText, normalizeText, stripMarkup, figuresIn, untracedFigures,
  cardFingerprint, CARD_KIND_MAP,
  type CardCandidate, type AcceptedCandidate, type CardSubject, type RejectReason,
} from "./story-card";
import { ORG_TYPES, TAX_STATUS, US_STATES } from "./eligibility-fields";
import { normalizeEin } from "./ein";
import { planMerge, NEW, type MergeCandidate } from "./card-merge";

type Layer = "I" | "II" | "III" | null;

// ---------------------------------------------------------------------------
// 1. Document types.
// ---------------------------------------------------------------------------

export interface DocType {
  key: string;
  label: string;
  /**
   * The readiness checklist item a document of this type evidences BY BEING
   * that document (a 990 covers "IRS 990" whatever it says). Null when the
   * type evidences nothing on its own and only its cards count. Phase B reads
   * this; Phase A only records it.
   */
  itemKey: string | null;
  describe: string;
}

/**
 * Every type the reader may name. Spec "Readiness mapping": the document-type
 * items for both branches, plus the types an Inven(s)tory actually holds that
 * evidence nothing on their own. `funder_form` is the funder's material, never
 * the client's story (Build Spec 16.4): its cards and facts are refused.
 */
export const DOC_TYPES: DocType[] = [
  { key: "irs_990", label: "IRS Form 990", itemKey: "irs_990",
    describe: "an IRS Form 990, 990-EZ or 990-N filing" },
  { key: "determination_letter", label: "Determination letter", itemKey: "determination",
    describe: "the IRS letter confirming 501(c)(3) or other tax-exempt status" },
  { key: "board_roster", label: "Board roster", itemKey: "board_roster",
    describe: "a list of the board of directors or governance structure, with names and roles" },
  { key: "annual_report", label: "Annual report", itemKey: "annual_report",
    describe: "a report on a year's activities, results and finances" },
  { key: "operating_budget", label: "Operating budget", itemKey: "budget",
    describe: "the organization-wide budget for a year, with revenue and expense figures" },
  { key: "financial_statement", label: "Financial statement", itemKey: "budget",
    describe: "audited or internal financial statements: balance sheet, income statement, audit" },
  { key: "program_budget", label: "Program budget", itemKey: "program_budgets",
    describe: "a budget for one program or project, with its own line items" },
  { key: "funder_list", label: "Funder list", itemKey: "funder_list",
    describe: "a list of the organization's funders, grants received or grant history" },
  { key: "evaluation_report", label: "Evaluation report", itemKey: "eval_reports",
    describe: "an evaluation or assessment of its programs, especially by a third party" },
  { key: "past_application", label: "Past grant application", itemKey: "past_grants",
    describe: "a grant application or proposal the organization wrote and submitted, with its answers" },
  { key: "website_capture", label: "Website capture", itemKey: "public_story",
    describe: "text captured from the organization's website or public pages" },
  { key: "pitch_deck", label: "Pitch deck", itemKey: "pitch_deck",
    describe: "slides presenting the company or organization to investors or funders" },
  { key: "cap_table", label: "Cap table", itemKey: "cap_table",
    describe: "ownership, share classes, entity structure or raise history" },
  { key: "investor_update", label: "Investor update", itemKey: "investor_updates",
    describe: "a periodic update or newsletter to investors or supporters" },
  { key: "financial_model", label: "Financial model", itemKey: "financial_model",
    describe: "projections or a forecast of revenue, costs and growth" },
  { key: "research_report", label: "Research report", itemKey: null,
    describe: "a research report or profile ABOUT the organization compiled by someone else (a consultant, For Granted, an analyst) from public sources, calls or interviews, rather than a transcript of the conversation itself" },
  { key: "interview", label: "Interview", itemKey: null,
    describe: "an interview, Q&A or recorded conversation in which someone FROM the organization speaks about it at length. Phase B counts it as the founder interview when a founder or leader is a speaker" },
  { key: "meeting_transcript", label: "Meeting transcript", itemKey: null,
    describe: "a recorded call or meeting about the organization that is not an interview of its own people (an advisory call, a strategy session)" },
  { key: "strategic_plan", label: "Strategic plan", itemKey: null,
    describe: "a strategic, business or operating plan" },
  { key: "program_description", label: "Program description", itemKey: null,
    describe: "a description of a program, product or service, such as a one-pager or brochure" },
  { key: "letter_of_support", label: "Letter of support or MOU", itemKey: null,
    describe: "a letter of support, letter of intent, memorandum of understanding or partnership agreement" },
  { key: "contract", label: "Contract", itemKey: null,
    describe: "a contract, statement of work, invoice or service agreement" },
  { key: "press", label: "Press or media", itemKey: null,
    describe: "an article, press release or media coverage about the organization" },
  { key: "funder_form", label: "Funder's form or RFP", itemKey: null,
    describe: "a FUNDER's blank application form, request for proposals or guidelines, not filled in by the organization" },
  { key: "other", label: "Other", itemKey: null,
    describe: "none of the above" },
];

export const DOC_TYPE_MAP: Record<string, DocType> = Object.fromEntries(DOC_TYPES.map(t => [t.key, t]));

export interface DocTypeAnswer { type: string; reason: string; quote: string }

/** The type for the whole document, from what each window said. */
export function pickDocType(answers: (DocTypeAnswer | null)[]): DocTypeAnswer | null {
  const valid = answers.filter((a): a is DocTypeAnswer => !!a && !!DOC_TYPE_MAP[a.type]);
  // The opening window first: it holds the title page, the letterhead or the
  // form number, which is where a document says what it is.
  return valid.find(a => a.type !== "other") ?? valid[0] ?? null;
}

// ---------------------------------------------------------------------------
// 2. Facts.
// ---------------------------------------------------------------------------

export type FactShape = "text" | "enum" | "ein" | "state" | "money" | "year" | "uei";

export interface FactKey {
  key: string;
  label: string;
  shape: FactShape;
  /** For enum facts: the allowed values, in the eligibility form's vocabulary. */
  options?: readonly string[];
  /** The Funding Eligibility field a confirmed fact would fill, for Phase B. */
  field: string | null;
  /** May a document hold several (several populations), or only one (one EIN)? */
  many: boolean;
  describe: string;
}

export const FACT_KEYS: FactKey[] = [
  { key: "org_type", label: "Organization type", shape: "enum", options: ORG_TYPES.map(o => o.v),
    field: "org_type", many: false,
    describe: `what kind of entity it is. Value is one of: ${ORG_TYPES.map(o => `${o.v} (${o.l})`).join(", ")}` },
  { key: "tax_status", label: "Tax status", shape: "enum", options: TAX_STATUS.map(o => o.v),
    field: "tax_status", many: false,
    describe: `its tax-exempt status. Value is one of: ${TAX_STATUS.map(o => `${o.v} (${o.l})`).join(", ")}` },
  { key: "ein", label: "EIN", shape: "ein", field: "ein", many: false,
    describe: "its own federal Employer Identification Number, as written (NN-NNNNNNN)" },
  { key: "uei", label: "SAM.gov UEI", shape: "uei", field: null, many: false,
    describe: "its own 12-character SAM.gov Unique Entity ID" },
  { key: "sam_registration", label: "SAM.gov registration", shape: "enum", options: ["sam_uei_active", "none"],
    field: "federal_registration", many: false,
    describe: "whether it is registered in SAM.gov. Value is sam_uei_active or none, only when the document says so" },
  { key: "fiscal_sponsor", label: "Fiscal sponsor", shape: "text", field: "fiscal_sponsor", many: false,
    describe: "the name of its fiscal sponsor, if it has one" },
  { key: "state", label: "Home state", shape: "state", field: "state_code", many: false,
    describe: "the US state where it is based or incorporated, as a two-letter code" },
  { key: "county", label: "County", shape: "text", field: "county", many: false,
    describe: "the county where it is based" },
  { key: "service_state", label: "State served", shape: "state", field: "service_area", many: true,
    describe: "a US state where it delivers its work, as a two-letter code. One fact per state" },
  { key: "service_area", label: "Area served", shape: "text", field: null, many: true,
    describe: "a city, county or region where it delivers its work" },
  { key: "annual_budget", label: "Annual budget", shape: "money", field: "budget_band", many: false,
    describe: "its total annual operating budget or annual revenue, as the figure is written, with the year if stated" },
  { key: "founded_year", label: "Year founded", shape: "year", field: null, many: false,
    describe: "the year it was founded or incorporated" },
  { key: "population", label: "Population served", shape: "text", field: "populations", many: true,
    describe: "a group of people it serves (\"youth aged 14 to 18\", \"veterans\"). One fact per group" },
  { key: "cause_area", label: "Cause area", shape: "text", field: "cause_areas", many: true,
    describe: "a field or cause its work belongs to (\"workforce development\", \"maternal health\"). One fact per cause" },
  { key: "identity", label: "What kind of organization", shape: "text", field: null, many: true,
    describe: "what kind of organization it is, as a funder would classify it (\"a youth mentoring nonprofit\", \"a healthtech startup\")" },
  { key: "funding_need", label: "What it wants funded", shape: "text", field: null, many: true,
    describe: "something specific it wants money for: a project, a role, equipment, a pilot, capacity" },
  { key: "constraint", label: "Eligibility constraint", shape: "text", field: null, many: true,
    describe: "anything that limits which money it can apply for (no 501(c)(3), fiscally sponsored, not registered in SAM.gov, tiny budget)" },
];

export const FACT_KEY_MAP: Record<string, FactKey> = Object.fromEntries(FACT_KEYS.map(f => [f.key, f]));

export interface FactCandidate { key: string; value: string; quote: string; subject: CardSubject }

export interface AcceptedFact {
  key: string;
  /** Normalised: an EIN as NN-NNNNNNN, a state as its code, an enum as its option. */
  value: string;
  quote: string;
  speaker: string | null;
}

export type FactRejectReason =
  | "unknown_fact" | "no_quote" | "quote_not_found" | "competitor" | "not_about_client"
  | "bad_value" | "value_not_in_quote" | "untraced_figures" | "too_long";

export const FACT_REJECT_LABEL: Record<FactRejectReason, string> = {
  unknown_fact: "not one of the facts the read collects",
  no_quote: "no supporting quote",
  quote_not_found: "quote is not in the document",
  competitor: "about a competitor",
  not_about_client: "about someone other than the client",
  bad_value: "the value is not in the expected form",
  value_not_in_quote: "the value is not in its quote",
  untraced_figures: "the value uses a figure the quote does not contain",
  too_long: "too long to be one fact",
};

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
const CODE_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([n, c]) => [c, n]));

/** A state as its two-letter code, from a code or a full name. Null if neither. */
export function stateCode(v: string): string | null {
  const s = v.trim();
  if (/^[A-Za-z]{2}$/.test(s) && US_STATES.includes(s.toUpperCase())) return s.toUpperCase();
  return STATE_NAMES[s.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "")] ?? null;
}

/** Does the quote name this state, by its name or as a standalone code ("Cleveland, OH")? */
function quoteNamesState(code: string, quote: string): boolean {
  const name = CODE_NAME[code];
  if (name && normalizeText(quote).includes(name)) return true;
  return new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`).test(quote);
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
export const MAX_FACT_WORDS = 25;

/**
 * A fact's quote may be shorter than a card's: "EIN: 34-1234567" is the whole
 * proof. Short quotes must match exactly (after normalisation); anything else,
 * including an ellipsis joining pieces, goes through the Card Library's check.
 */
export const MIN_FACT_QUOTE_CHARS = 6;
export function factQuoteInText(quote: string, text: string): boolean {
  const q = normalizeText(stripMarkup(quote)).replace(/^["']+|["']+$/g, "").replace(/[.;,]+$/, "").trim();
  if (q.length < MIN_FACT_QUOTE_CHARS) return false;
  return normalizeText(stripMarkup(text)).includes(q) || quoteInText(quote, text);
}

/**
 * Decide one fact against the document it came from.
 *
 * Facts describe the CLIENT: a partner's EIN or a funder's state is not the
 * client's, so only `organization` facts are kept, and a transcript's
 * first-person claims by an outsider are moved off the client first, exactly
 * as for cards. Then the value must have the right shape and be traceable to
 * its quote, because an eligibility answer the client is asked to confirm must
 * show the line it came from.
 */
export function checkFact(
  f: FactCandidate, text: string,
  reattribute?: (quote: string, subject: CardSubject) => { subject: CardSubject; speaker: string | null },
): { ok: true; fact: AcceptedFact } | { ok: false; reason: FactRejectReason } {
  const def = FACT_KEY_MAP[f.key];
  if (!def) return { ok: false, reason: "unknown_fact" };
  if (!f.quote) return { ok: false, reason: "no_quote" };
  if (!f.value.trim()) return { ok: false, reason: "bad_value" };
  if (!factQuoteInText(f.quote, text)) return { ok: false, reason: "quote_not_found" };

  const who = reattribute ? reattribute(f.quote, f.subject) : { subject: f.subject, speaker: null };
  if (who.subject === "competitor") return { ok: false, reason: "competitor" };
  if (who.subject !== "organization") return { ok: false, reason: "not_about_client" };

  let value = f.value.trim();
  switch (def.shape) {
    case "enum":
      value = value.toLowerCase();
      if (!def.options?.includes(value)) return { ok: false, reason: "bad_value" };
      break;
    case "ein": {
      const d = normalizeEin(value);
      if (d.length !== 9) return { ok: false, reason: "bad_value" };
      if (!normalizeEin(f.quote).includes(d)) return { ok: false, reason: "value_not_in_quote" };
      value = `${d.slice(0, 2)}-${d.slice(2)}`;
      break;
    }
    case "uei": {
      const u = value.toUpperCase().replace(/\s+/g, "");
      if (!/^[A-Z0-9]{12}$/.test(u)) return { ok: false, reason: "bad_value" };
      if (!f.quote.toUpperCase().replace(/\s+/g, "").includes(u)) return { ok: false, reason: "value_not_in_quote" };
      value = u;
      break;
    }
    case "state": {
      const c = stateCode(value);
      if (!c) return { ok: false, reason: "bad_value" };
      if (!quoteNamesState(c, f.quote)) return { ok: false, reason: "value_not_in_quote" };
      value = c;
      break;
    }
    case "money":
      if (!figuresIn(value).length) return { ok: false, reason: "bad_value" };
      if (untracedFigures(value, f.quote).length) return { ok: false, reason: "untraced_figures" };
      if (words(value) > MAX_FACT_WORDS) return { ok: false, reason: "too_long" };
      break;
    case "year": {
      const y = value.match(/\b(1[89]\d\d|20\d\d)\b/)?.[1];
      if (!y) return { ok: false, reason: "bad_value" };
      if (!f.quote.includes(y)) return { ok: false, reason: "value_not_in_quote" };
      value = y;
      break;
    }
    case "text":
      if (words(value) > MAX_FACT_WORDS) return { ok: false, reason: "too_long" };
      if (untracedFigures(value, f.quote).length) return { ok: false, reason: "untraced_figures" };
      break;
  }
  return { ok: true, fact: { key: f.key, value, quote: f.quote, speaker: who.speaker } };
}

/** Two facts are the same fact when the key and the normalised value match. */
export const factIdentity = (f: { key: string; value: string }) => `${f.key}|${normalizeText(f.value)}`;

// ---------------------------------------------------------------------------
// 3. Parsing the model's answer.
// ---------------------------------------------------------------------------

export interface ParsedRead {
  docType: DocTypeAnswer | null;
  cards: CardCandidate[];
  facts: FactCandidate[];
  /** False when no JSON object could be found at all. */
  parsed: boolean;
}

const SUBJECTS = new Set<CardSubject>(["organization", "competitor", "third_party"]);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Lenient about shape, strict about nothing yet: the checks are separate, so a
 * refusal can say why. Accepts the object asked for, and degrades to "cards
 * only" if the model answered with a bare array.
 */
export function parseAnalysis(raw: string): ParsedRead {
  const empty: ParsedRead = { docType: null, cards: [], facts: [], parsed: false };
  const a = raw.indexOf("{"); const b = raw.lastIndexOf("}");
  let obj: Record<string, unknown> | null = null;
  if (a >= 0 && b > a) {
    try { const o = JSON.parse(raw.slice(a, b + 1)); if (o && typeof o === "object" && !Array.isArray(o)) obj = o; }
    catch { obj = null; }
  }
  // An object without any of the three parts is not the answer: most likely
  // one element of a bare array of cards. Read it as cards below.
  if (obj && !("document_type" in obj || "cards" in obj || "facts" in obj)) obj = null;
  if (!obj) {
    const cards = parseCandidates(raw);
    return cards.length ? { ...empty, cards, parsed: true } : empty;
  }

  const dt = obj.document_type as Record<string, unknown> | undefined;
  const docType = dt && typeof dt === "object"
    ? { type: str(dt.type, 60).toLowerCase(), reason: str(dt.reason, 300), quote: str(dt.quote, 600) }
    : null;
  const cards = Array.isArray(obj.cards) ? parseCandidates(JSON.stringify(obj.cards)) : [];
  const facts: FactCandidate[] = [];
  if (Array.isArray(obj.facts)) {
    for (const o of obj.facts) {
      if (!o || typeof o !== "object") continue;
      const r = o as Record<string, unknown>;
      facts.push({
        key: str(r.key, 60).toLowerCase(),
        value: str(r.value, 300),
        quote: str(r.quote, 1200),
        subject: SUBJECTS.has(r.subject as CardSubject) ? r.subject as CardSubject : "organization",
      });
    }
  }
  return { docType: docType?.type ? docType : null, cards, facts, parsed: true };
}

// ---------------------------------------------------------------------------
// 4. One document, decided.
// ---------------------------------------------------------------------------

export interface AnalysisRejection {
  what: "card" | "fact" | "type";
  key: string;
  text: string;
  quote: string;
  reason: RejectReason | FactRejectReason | "funder_document";
}

/** One accepted card as stored in analysis_doc.cards: story_card_doc's shape. */
export interface AnalysisCard extends AcceptedCandidate { layer: Layer }
export interface AnalysisFact extends AcceptedFact { layer: Layer }

export interface DocumentAnalysis {
  docType: DocTypeAnswer | null;
  docTypeProven: boolean;
  cards: AnalysisCard[];
  facts: AnalysisFact[];
  rejected: AnalysisRejection[];
}

/**
 * Turn every window's answer into the document's analysis.
 *
 * `text` is the WHOLE document, so a quote that straddles a window boundary is
 * still found. A funder's own form is recognised and its cards and facts are
 * refused: its words are the funder's, and filing them as the client's story
 * is exactly the mistake the Build Spec rules out (16.4).
 */
export function decideDocument(input: {
  windows: ParsedRead[]; text: string; layer: Layer; allowedKinds: Set<string>;
  reattribute?: (quote: string, subject: CardSubject) => { subject: CardSubject; speaker: string | null };
}): DocumentAnalysis {
  const { windows: parts, text, layer, allowedKinds, reattribute } = input;
  const docType = pickDocType(parts.map(p => p.docType));
  const docTypeProven = !!docType?.quote && quoteInText(docType.quote, text);
  const rejected: AnalysisRejection[] = [];
  const funderForm = docType?.type === "funder_form";

  const cards: AnalysisCard[] = [];
  const seenCards = new Set<string>();
  for (const c of parts.flatMap(p => p.cards)) {
    if (funderForm) {
      rejected.push({ what: "card", key: c.kind, text: c.statement, quote: c.quote, reason: "funder_document" });
      continue;
    }
    const r = checkCandidate(c, text, allowedKinds, reattribute);
    if (!r.ok) {
      rejected.push({ what: "card", key: r.rejected.kind, text: r.rejected.statement, quote: r.rejected.quote, reason: r.rejected.reason });
      continue;
    }
    const fp = cardFingerprint(r.card.kind, r.card.statement);
    if (seenCards.has(fp)) continue;          // overlapping windows
    seenCards.add(fp);
    cards.push({ ...r.card, layer });
  }

  const facts: AnalysisFact[] = [];
  const seenFacts = new Set<string>();
  for (const f of parts.flatMap(p => p.facts)) {
    if (funderForm) {
      rejected.push({ what: "fact", key: f.key, text: f.value, quote: f.quote, reason: "funder_document" });
      continue;
    }
    const r = checkFact(f, text, reattribute);
    if (!r.ok) { rejected.push({ what: "fact", key: f.key, text: f.value, quote: f.quote, reason: r.reason }); continue; }
    const id = factIdentity(r.fact);
    if (seenFacts.has(id)) continue;
    seenFacts.add(id);
    // A one-value fact (an EIN) found with two different values is kept twice:
    // choosing between them is a person's job, and Phase B shows both.
    facts.push({ ...r.fact, layer });
  }

  if (docType && !DOC_TYPE_MAP[docType.type]) {
    rejected.push({ what: "type", key: docType.type, text: docType.reason, quote: docType.quote, reason: "bad_value" });
  }
  return { docType, docTypeProven, cards, facts, rejected };
}

// ---------------------------------------------------------------------------
// 5. Across documents: the would-be library, the facts, and the review.
// ---------------------------------------------------------------------------

export interface PreviewCard {
  fingerprint: string;
  kind: string;
  kindLabel: string;
  statement: string;
  strength: "covered" | "thin";
  layer: string | null;
  /** The fingerprint of an earlier card this one looks like, if any. Never merged. */
  possibleDuplicateOf: string | null;
  evidence: { documentId: string; quote: string; speaker: string | null }[];
}

/**
 * The Card Library this read WOULD produce, from nothing.
 *
 * The same planMerge() the Card Library uses, run against an empty library:
 * identical claims from different documents become one card with several
 * pieces of evidence, and near-duplicates are flagged, not merged. This is what
 * the duplicate count in the review is measured against.
 */
export function previewLibrary(docs: { documentId: string; cards: MergeCandidate[] }[]): PreviewCard[] {
  const plan = planMerge({ docs: docs.map(d => ({ documentId: d.documentId, candidates: d.cards })), cards: [], evidence: [] });
  const ev = new Map<string, PreviewCard["evidence"]>();
  for (const e of plan.evidence) {
    const fp = e.target.startsWith(NEW) ? e.target.slice(NEW.length) : e.target;
    ev.set(fp, [...(ev.get(fp) ?? []), { documentId: e.documentId, quote: e.quote, speaker: e.speaker }]);
  }
  return plan.create.map(c => ({
    fingerprint: c.fingerprint, kind: c.kind, kindLabel: CARD_KIND_MAP[c.kind]?.label ?? c.kind,
    statement: c.statement, strength: c.patch.strength, layer: c.patch.layer,
    possibleDuplicateOf: c.patch.possible_duplicate_of?.startsWith(NEW)
      ? c.patch.possible_duplicate_of.slice(NEW.length) : c.patch.possible_duplicate_of,
    evidence: ev.get(c.fingerprint) ?? [],
  }));
}

export interface FactSummary {
  key: string;
  label: string;
  values: { value: string; sources: { documentId: string; quote: string }[] }[];
  /** A one-value fact (an EIN, a home state) found with more than one value. */
  conflicting: boolean;
}

/** Every fact found, grouped by key and value, in FACT_KEYS order. */
export function summarizeFacts(docs: { documentId: string; facts: AcceptedFact[] }[]): FactSummary[] {
  const byKey = new Map<string, Map<string, FactSummary["values"][number]>>();
  for (const d of docs) for (const f of d.facts ?? []) {
    if (!FACT_KEY_MAP[f.key]) continue;
    const vals = byKey.get(f.key) ?? new Map();
    const id = normalizeText(f.value);
    const v = vals.get(id) ?? { value: f.value, sources: [] };
    if (!v.sources.some((s: { documentId: string }) => s.documentId === d.documentId)) {
      v.sources.push({ documentId: d.documentId, quote: f.quote });
    }
    vals.set(id, v);
    byKey.set(f.key, vals);
  }
  return FACT_KEYS.filter(k => byKey.has(k.key)).map(k => {
    const values = [...byKey.get(k.key)!.values()].sort((a, b) => b.sources.length - a.sources.length || a.value.localeCompare(b.value));
    return { key: k.key, label: k.label, values, conflicting: !k.many && values.length > 1 };
  });
}

/** FNV-1a, 32-bit. Stable across runtimes; not a security hash and not used as one. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * How many cards a person reviews to judge a reader (decided 2 October 2026).
 *
 * A sample's precision depends on how many cards are reviewed, not on how many
 * exist: 46 of 50 supported says the true rate is somewhere from about 85% to
 * 99%, which cannot tell a pass from a fail at 90%. So a small library is
 * reviewed in full (exact), and a large one gets 100 cards (about plus or minus
 * 5 points), drawn from each document in proportion so no source is skipped.
 */
export const REVIEW_ALL_UP_TO = 100;
export const REVIEW_LARGE = 100;
export const reviewTarget = (librarySize: number) =>
  librarySize <= REVIEW_ALL_UP_TO ? librarySize : REVIEW_LARGE;

type Sampled = { fingerprint: string; evidence: { documentId: string }[] };
const docOf = (c: Sampled) => c.evidence[0]?.documentId ?? "";

/**
 * The cards a person reviews, chosen without looking at them.
 *
 * Every card when the library is small. Otherwise each document gets a share of
 * the sample in proportion to the cards it produced (largest remainder), and
 * within a document cards are taken in the order of a hash of the client and
 * the card. So the sample is the same on every visit (a review can be finished
 * across sittings), nobody picks the good ones, and the documents most likely
 * to pad the library are checked as much as their size warrants. Cards already
 * reviewed stay in the sample and count toward their document's share, so no
 * judgement is lost when a later read changes the library.
 */
export function reviewSample<T extends Sampled>(cards: T[], seed: string, reviewed: Set<string>): T[] {
  const order = (a: T, b: T) =>
    fnv(`${seed}|${a.fingerprint}`) - fnv(`${seed}|${b.fingerprint}`) || a.fingerprint.localeCompare(b.fingerprint);
  const n = reviewTarget(cards.length);
  if (n >= cards.length) return [...cards].sort(order);

  const groups = new Map<string, T[]>();
  for (const c of cards) groups.set(docOf(c), [...(groups.get(docOf(c)) ?? []), c]);
  const keys = [...groups.keys()].sort();
  const exact = keys.map(k => ({ k, q: (groups.get(k)!.length / cards.length) * n }));
  const quota = new Map(exact.map(e => [e.k, Math.floor(e.q)]));
  let left = n - [...quota.values()].reduce((a, b) => a + b, 0);
  for (const e of [...exact].sort((a, b) => (b.q - Math.floor(b.q)) - (a.q - Math.floor(a.q)) || a.k.localeCompare(b.k))) {
    if (left <= 0) break;
    quota.set(e.k, quota.get(e.k)! + 1); left -= 1;
  }

  const out: T[] = [];
  for (const k of keys) {
    const list = [...groups.get(k)!].sort(order);
    const done = list.filter(c => reviewed.has(c.fingerprint));
    const rest = list.filter(c => !reviewed.has(c.fingerprint));
    out.push(...done, ...rest.slice(0, Math.max(0, quota.get(k)! - done.length)));
  }
  return out.sort(order);
}

/** Every flagged possible-duplicate pair in the would-be library, newer card first. */
export function duplicatePairs(cards: { fingerprint: string; possibleDuplicateOf: string | null }[]): { card: string; other: string }[] {
  const live = new Set(cards.map(c => c.fingerprint));
  return cards.filter(c => c.possibleDuplicateOf && live.has(c.possibleDuplicateOf))
    .map(c => ({ card: c.fingerprint, other: c.possibleDuplicateOf as string }));
}

export interface ReviewMark { verdict: "supported" | "partly" | "unsupported"; competitor: boolean; duplicate: boolean }

export interface ReviewTally {
  reviewed: number; target: number; librarySize: number;
  supported: number; partly: number; unsupported: number; competitor: number;
  /** Flagged pairs decided, of how many, and how many a person judged the same claim. */
  pairs: { total: number; decided: number; same: number };
  /** Same-claim pairs plus unflagged duplicates noticed in the review. */
  duplicate: number;
  supportedPct: number; duplicatePct: number;
  /** Each threshold from the Build Spec's Phase 1 gate, so the page can say which one fails. */
  checks: { enough: boolean; pairs: boolean; supported: boolean; competitor: boolean; duplicates: boolean };
  passes: boolean;
}

/**
 * The card-quality gate (Build Spec section 12, Phase 1, sized as decided on
 * 2 October 2026): at least 90% of reviewed statements fully supported by their
 * quote, zero competitor facts, and fewer than 1 in 10 cards duplicated.
 *
 * Supported and competitor are measured on the sample. Duplicates are measured
 * on the whole library, because a card is a duplicate of some OTHER card, which
 * a sample usually does not contain: every flagged pair is decided by a person,
 * and any duplicate the reviewer notices that was not flagged is added. "Partly"
 * does not count as supported: the rule is FULLY supported.
 */
export function reviewTally(
  marks: ReviewMark[], target: number, librarySize: number,
  pairs: { total: number; decided: number; same: number },
): ReviewTally {
  const n = marks.length;
  const count = (p: (m: ReviewMark) => boolean) => marks.filter(p).length;
  const supported = count(m => m.verdict === "supported");
  const competitor = count(m => m.competitor);
  const duplicate = pairs.same + count(m => m.duplicate);
  const pct = (x: number, of: number) => (of ? Math.round((x / of) * 1000) / 10 : 0);
  const checks = {
    enough: target > 0 && n >= target,
    pairs: pairs.decided >= pairs.total,
    supported: n > 0 && supported / n >= 0.9,
    competitor: competitor === 0,
    duplicates: librarySize > 0 && duplicate / librarySize < 0.1,
  };
  return {
    reviewed: n, target, librarySize, supported, partly: count(m => m.verdict === "partly"),
    unsupported: count(m => m.verdict === "unsupported"), competitor, pairs, duplicate,
    supportedPct: pct(supported, n), duplicatePct: pct(duplicate, librarySize),
    checks, passes: Object.values(checks).every(Boolean),
  };
}

/** Plain-language reason for any refusal in analysis_doc.rejected. */
export function rejectionLabel(reason: string, cardLabels: Record<string, string>): string {
  if (reason === "funder_document") return "the document is a funder's form, so its words are not the client's";
  return (FACT_REJECT_LABEL as Record<string, string>)[reason] ?? cardLabels[reason] ?? reason;
}
