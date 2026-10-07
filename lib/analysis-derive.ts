// Inven(s)tory Analysis, Phase B: everything else, worked out in code.
//
// Phase A reads each document once and stores its type, its Story Cards and its
// facts (lib/analysis.ts). This file turns those into the three things the
// portal currently reads documents for separately, with no further model call:
//
//   1. Readiness: each checklist item covered, thin or missing, from the
//      document types and the card kinds, with the quote behind each.
//   2. Funding Eligibility suggestions: answers for the client to confirm, each
//      with the line it came from. Nothing here is ever saved silently.
//   3. The Funder Matches search profile: the facts a funder search uses.
//
// Nothing reads these yet except the comparison on the Analysis (trial) page.
// The current readiness, eligibility and search profile are untouched until the
// comparison has been looked at by a person (spec, Proving it).
//
// Pure and free of `server-only`, so every rule is tested without a database.

import { checklistFor, TIER_WEIGHT, type ChecklistItem } from "./checklist";
import { CARD_KIND_MAP } from "./story-card";
import { BUDGET_BANDS, ORG_TYPES, TAX_STATUS, type EligibilityProfile } from "./eligibility-fields";
import { DOC_TYPE_MAP, FACT_KEY_MAP, type AnalysisCard, type AnalysisFact } from "./analysis";
import type { Facet, ProfileFact } from "./search-profile";
import type { SpeakerRoster } from "./transcript-speakers";

export type ItemState = "covered" | "thin" | "missing";
const RANK: Record<ItemState, number> = { missing: 0, thin: 1, covered: 2 };

/** One analysed document, as Phase B needs it. */
export interface AnalysedDoc {
  id: string;
  title: string;
  layer: string | null;
  docType: string | null;
  docTypeProven: boolean;
  docTypeQuote: string | null;
  /**
   * The type a person gave the document (decision 33): at upload, by
   * confirming the analysis's suggestion (docType), or by picking another.
   * Null until someone has. Only a tagged type evidences a file item.
   */
  typeTag?: string | null;
  cards: AnalysisCard[];
  facts: AnalysisFact[];
  /** Who speaks in it, when it is a transcript (0038). */
  roster: SpeakerRoster | null;
}

export interface DerivedSource { id: string; title: string; quote?: string; via: "type" | "card" | "fact" }
export interface DerivedItem { key: string; state: ItemState; sources: DerivedSource[]; why: string }

// ---------------------------------------------------------------------------
// 1. Readiness.
// ---------------------------------------------------------------------------

/**
 * Card kinds that evidence a checklist item beyond the item each kind names
 * itself (CARD_KIND_MAP[kind].itemKey). Kept here, in one table, so the mapping
 * the comparison is judging can be read and argued with.
 *
 *  - competition: the reader refuses competitor facts as cards, so the startup
 *    "Competitive landscape" item is evidenced by the client's own statement of
 *    what sets it apart. A known difference from the current read, which
 *    accepts a competitor's facts for this one item.
 *  - strategic_partners: the startup "Strategic partners / LOIs" item is
 *    evidenced by partnership cards, as "Partnerships" is.
 */
export const EXTRA_KIND_ITEMS: Record<string, string[]> = {
  differentiator: ["competition"],
  partnership: ["strategic_partners"],
};

/** Kinds that can only make their item thin. A need told as a story is not a data-backed need. */
export const THIN_ONLY_KINDS = new Set(["need_story"]);

/**
 * Tagged types that cover one more item besides their own (decision 34, 7
 * October 2026, Shane). For Granted's Layer I Deep Research Report is built to
 * capture the organization's public story (it scrapes the client's website and
 * public sources), so a document tagged Research report covers the public
 * story, the same as a website capture. It evidences nothing else on its own
 * (decision 15), which is why the type itself has no itemKey.
 */
export const TYPE_EXTRA_ITEMS: Record<string, string> = { research_report: "public_story" };

/** Facts that evidence an item, at most thin: one figure is not an operating budget. */
export const FACT_ITEMS: Record<string, string> = { annual_budget: "budget" };

/**
 * The founder or leader interview: a document typed `interview` with at least
 * one speaker from the client is covered; a meeting transcript with one is
 * thin; an interview with no roster to show who spoke is thin. The roster says
 * who is FROM the client, not who is the founder, so a person still judges the
 * edge cases in the comparison.
 */
function founderVoice(d: AnalysedDoc): ItemState {
  const clientSpeaks = !!d.roster?.speakers.some(s => s.isClient === true);
  // A person's type wins; the analysis's own type stands in until then, since
  // an interview is judged by who speaks in it, not by being a file.
  const type = d.typeTag ?? d.docType;
  if (type === "interview") return clientSpeaks ? "covered" : "thin";
  if (type === "meeting_transcript" && clientSpeaks) return "thin";
  return "missing";
}

/** Readiness for one client from its analysed documents. */
export function deriveReadiness(orgType: string | null, docs: AnalysedDoc[]): DerivedItem[] {
  const items = checklistFor(orgType);
  const keys = new Set(items.map(i => i.key));
  const acc = new Map<string, { state: ItemState; sources: DerivedSource[]; why: Set<string> }>();
  const add = (key: string, state: ItemState, src: DerivedSource, why: string) => {
    if (!keys.has(key)) return;
    const cur = acc.get(key) ?? { state: "missing" as ItemState, sources: [], why: new Set<string>() };
    if (RANK[state] > RANK[cur.state]) cur.state = state;
    if (cur.sources.length < 6 && !cur.sources.some(s => s.id === src.id && s.via === src.via && s.quote === src.quote)) cur.sources.push(src);
    cur.why.add(why);
    acc.set(key, cur);
  };

  for (const d of docs) {
    // A file item (a 990, a pitch deck, a budget) is covered by a document a
    // person has tagged as that type (decision 33). The analysis's own guess is
    // only a suggestion to confirm: on 7 October 2026 it called two RE-Assist
    // presentations pitch decks on quotes that showed nothing of the kind, and
    // whether a file IS a pitch deck cannot be read off a quote. Untagged, the
    // item stays missing.
    const t = d.typeTag ? DOC_TYPE_MAP[d.typeTag] : undefined;
    if (t?.itemKey) {
      add(t.itemKey, "covered", { id: d.id, title: d.title, via: "type" }, `${t.label} in the Inven(s)tory (tagged)`);
    }
    const extraItem = d.typeTag ? TYPE_EXTRA_ITEMS[d.typeTag] : undefined;
    if (extraItem && t) {
      add(extraItem, "covered", { id: d.id, title: d.title, via: "type" }, `${t.label} capturing the public story (tagged)`);
    }
    const fv = founderVoice(d);
    if (fv !== "missing") {
      add("founder_voice", fv, { id: d.id, title: d.title, via: "type" },
        fv === "covered" ? "an interview in which someone from the organization speaks" : "a recorded conversation with someone from the organization");
    }

    for (const c of d.cards) {
      const kind = CARD_KIND_MAP[c.kind];
      if (!kind) continue;
      const targets = [kind.itemKey, ...(EXTRA_KIND_ITEMS[c.kind] ?? [])].filter((x): x is string => !!x);
      const state: ItemState = THIN_ONLY_KINDS.has(c.kind) || c.strength !== "covered" ? "thin" : "covered";
      for (const key of targets) {
        add(key, state, { id: d.id, title: d.title, quote: c.quote, via: "card" },
          `${kind.label} card${state === "thin" ? " (general, or told as a story)" : ""}`);
      }
    }

    for (const f of d.facts) {
      const key = FACT_ITEMS[f.key];
      if (key) add(key, "thin", { id: d.id, title: d.title, quote: f.quote, via: "fact" }, `${FACT_KEY_MAP[f.key]?.label ?? f.key} stated`);
    }
  }

  return items.map(i => {
    const a = acc.get(i.key);
    return a
      ? { key: i.key, state: a.state, sources: a.sources, why: [...a.why].join("; ") }
      : { key: i.key, state: "missing", sources: [], why: "nothing in the analysis evidences it" };
  });
}

/**
 * The readiness percentage, exactly as the current checklist scores it
 * (readiness() in lib/server/gap-agent.ts): tier-weighted, covered counts 1,
 * thin counts half. Repeated here because that file is server-only; the test
 * pins the two formulas to the same answers.
 */
export function readinessScore(items: ChecklistItem[], state: (key: string) => ItemState): number {
  const total = items.reduce((a, i) => a + TIER_WEIGHT[i.tier], 0) || 1;
  const got = items.reduce((a, i) => {
    const st = state(i.key);
    return a + TIER_WEIGHT[i.tier] * (st === "covered" ? 1 : st === "thin" ? 0.5 : 0);
  }, 0);
  return Math.round((got / total) * 100);
}

/** Feature unlock (decided 2 October 2026): Funder Matches opens once every Essential is at least thin. */
export function essentialsAtLeastThin(orgType: string | null, state: (key: string) => ItemState): boolean {
  return checklistFor(orgType).filter(i => i.tier === "essential").every(i => state(i.key) !== "missing");
}

// ---------------------------------------------------------------------------
// 2. Funding Eligibility suggestions.
// ---------------------------------------------------------------------------

/**
 * A money figure as written ("$1,250,000", "$1.2 million", "850K") as a number,
 * or null. Only for choosing a budget band; the figure itself is shown to the
 * client as written.
 */
export function parseMoney(v: string): number | null {
  const m = v.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(million|mil|mm|m|thousand|k|billion|bn|b)?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const mult = unit.startsWith("b") ? 1e9 : ["million", "mil", "mm", "m"].includes(unit) ? 1e6 : ["thousand", "k"].includes(unit) ? 1e3 : 1;
  return n * mult;
}

/** The eligibility form's budget band for an amount. */
export function budgetBand(amount: number): string {
  if (amount < 100_000) return "lt_100k";
  if (amount < 500_000) return "100k_500k";
  if (amount < 1_000_000) return "500k_1m";
  if (amount < 5_000_000) return "1m_5m";
  if (amount < 10_000_000) return "5m_10m";
  return "gt_10m";
}

export type EligField =
  | "org_type" | "tax_status" | "ein" | "fiscal_sponsor" | "state_code" | "county"
  | "service_area" | "budget_band" | "populations" | "cause_areas" | "federal_registration";

export interface Suggestion {
  field: EligField;
  label: string;
  /** In the form's own vocabulary: a code for enums and states, the text for the rest. */
  values: { value: string; display: string; sources: { id: string; title: string; quote: string }[] }[];
  /** A one-value field with more than one candidate: the client chooses. */
  conflicting: boolean;
  /** Against what the client's profile holds today. */
  compare: "new" | "matches" | "differs" | "adds";
  current: string[];
}

const FIELD_LABEL: Record<EligField, string> = {
  org_type: "Organization type", tax_status: "Tax status", ein: "EIN", fiscal_sponsor: "Fiscal sponsor",
  state_code: "Home state", county: "County", service_area: "States served", budget_band: "Annual budget",
  populations: "Populations served", cause_areas: "Cause areas", federal_registration: "SAM.gov registration",
};
const MANY: ReadonlySet<EligField> = new Set(["service_area", "populations", "cause_areas"]);
const FACT_FIELD: Record<string, EligField> = {
  org_type: "org_type", tax_status: "tax_status", ein: "ein", fiscal_sponsor: "fiscal_sponsor",
  state: "state_code", county: "county", service_state: "service_area", annual_budget: "budget_band",
  population: "populations", cause_area: "cause_areas", sam_registration: "federal_registration",
};
const optionLabel = (list: { v: string | number; l: string }[], v: string) => list.find(o => String(o.v) === v)?.l ?? v;

function display(field: EligField, value: string): string {
  if (field === "org_type") return optionLabel(ORG_TYPES, value);
  if (field === "tax_status") return optionLabel(TAX_STATUS, value);
  if (field === "budget_band") return optionLabel(BUDGET_BANDS, value);
  if (field === "federal_registration") return value === "sam_uei_active" ? "Registered (SAM.gov and UEI active)" : "Not registered";
  return value;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function currentValues(field: EligField, p: EligibilityProfile): string[] {
  const v = (p as unknown as Record<string, unknown>)[field];
  if (Array.isArray(v)) return v.map(String);
  if (v == null || v === "") return [];
  if (field === "federal_registration" && v === "none") return [];   // the form's default, not an answer
  if (field === "ein") return [String(v).replace(/\D/g, "")];
  return [String(v)];
}

/**
 * Suggested answers for the Funding Eligibility form, from the facts, compared
 * with what the client's profile holds. Always suggestions: the client confirms
 * each one on a screen that shows the line it came from (decided 2 October 2026).
 */
export function deriveEligibility(docs: AnalysedDoc[], profile: EligibilityProfile): Suggestion[] {
  const by = new Map<EligField, Map<string, Suggestion["values"][number]>>();
  for (const d of docs) for (const f of d.facts) {
    const field = FACT_FIELD[f.key];
    if (!field) continue;
    let value = f.value;
    if (field === "budget_band") {
      const amount = parseMoney(f.value);
      if (amount == null) continue;
      value = budgetBand(amount);
    }
    const key = field === "ein" ? value.replace(/\D/g, "") : norm(value);
    const vals = by.get(field) ?? new Map();
    const cur = vals.get(key) ?? { value, display: display(field, value), sources: [] };
    if (!cur.sources.some((s: { id: string }) => s.id === d.id)) cur.sources.push({ id: d.id, title: d.title, quote: f.quote });
    vals.set(key, cur);
    by.set(field, vals);
  }

  return (Object.keys(FIELD_LABEL) as EligField[]).filter(f => by.has(f)).map(field => {
    const values = [...by.get(field)!.values()].sort((a, b) => b.sources.length - a.sources.length || a.value.localeCompare(b.value));
    const current = currentValues(field, profile);
    const cmp = (v: string) => field === "ein" ? v.replace(/\D/g, "") : norm(v);
    const have = new Set(current.map(cmp));
    let compare: Suggestion["compare"];
    if (!current.length) compare = "new";
    else if (MANY.has(field)) compare = values.every(v => have.has(cmp(v.value))) ? "matches" : "adds";
    else compare = values.some(v => have.has(cmp(v.value))) && values.length === 1 ? "matches" : "differs";
    return {
      field, label: FIELD_LABEL[field], values,
      conflicting: !MANY.has(field) && values.length > 1, compare,
      current: current.map(v => display(field, v)),
    };
  });
}

// ---------------------------------------------------------------------------
// 3. The search profile.
// ---------------------------------------------------------------------------

/**
 * Which card kinds and facts feed which search facet. `beneficiaries` stays
 * quarantined exactly as it is today: GRANT_FACETS in lib/search-profile.ts
 * leaves it out of grant searches, and nothing here changes that.
 */
export const KIND_FACET: Record<string, Facet> = {
  program_model: "work",
  outcome_metric: "evidence", capacity_track_record: "evidence", traction: "evidence", funding_source: "evidence",
  population_geography: "geography",
  differentiator: "distinctive",
  mission_values: "identity",
};
export const FACT_FACET: Record<string, Facet> = {
  identity: "identity", funding_need: "need", constraint: "constraints",
  population: "beneficiaries", service_area: "geography", county: "geography",
};

/**
 * The search profile's facts, in the shape search_profile.facts already uses,
 * so the comparison can set them side by side and Phase D can swap one for the
 * other. Every line keeps its document and verbatim quote.
 */
export function deriveSearchFacts(docs: AnalysedDoc[]): ProfileFact[] {
  const out: ProfileFact[] = [];
  const seen = new Set<string>();
  const push = (f: ProfileFact) => {
    const k = `${f.facet}|${norm(f.text)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };
  for (const d of docs) {
    const layer = (["I", "II", "III"].includes(d.layer ?? "") ? d.layer : null) as ProfileFact["layer"];
    for (const c of d.cards) {
      const facet = KIND_FACET[c.kind];
      if (facet) push({ facet, text: c.statement, quote: c.quote, documentId: d.id, documentTitle: d.title, layer, subject: c.subject });
    }
    for (const f of d.facts) {
      const facet = FACT_FACET[f.key];
      if (facet) push({ facet, text: f.value, quote: f.quote, documentId: d.id, documentTitle: d.title, layer, subject: "organization" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The comparison gate.
// ---------------------------------------------------------------------------

export interface ReadinessRow {
  key: string; label: string; tier: string;
  current: ItemState; derived: ItemState;
  agree: boolean;
  /** A person's judgement of a disagreement, if it still matches what is being compared. */
  verdict: Verdict | null;
}
export type Verdict = "new_correct" | "old_correct" | "both_acceptable" | "neither";

export const VERDICT_LABEL: Record<Verdict, string> = {
  new_correct: "The new read is right",
  old_correct: "The current read is right",
  both_acceptable: "Either is acceptable",
  neither: "Neither is right",
};

/**
 * Every checklist item, current against derived. A recorded verdict counts only
 * while both states are still the ones it was given for: a re-read that changes
 * either side puts the item back in front of a person.
 */
export function compareReadiness(
  orgType: string | null,
  current: (key: string) => ItemState,
  derived: DerivedItem[],
  verdicts: Map<string, { verdict: Verdict; oldState: string; newState: string }>,
): ReadinessRow[] {
  const d = new Map(derived.map(x => [x.key, x.state]));
  return checklistFor(orgType).map(i => {
    const cur = current(i.key);
    const der = d.get(i.key) ?? "missing";
    const v = verdicts.get(i.key);
    return {
      key: i.key, label: i.label, tier: i.tier, current: cur, derived: der, agree: cur === der,
      verdict: v && v.oldState === cur && v.newState === der ? v.verdict : null,
    };
  });
}

/**
 * The gate for switching a client over (spec, Proving it): every disagreement
 * looked at by a person. An answer of "the current read is right" or "neither"
 * still counts as looked at, but is reported, because each one is a fix to make
 * before Phase D.
 */
export function comparisonGate(rows: ReadinessRow[]): {
  disagreements: number; judged: number; toFix: number; passes: boolean;
} {
  const dis = rows.filter(r => !r.agree);
  const judged = dis.filter(r => r.verdict).length;
  const toFix = dis.filter(r => r.verdict === "old_correct" || r.verdict === "neither").length;
  return { disagreements: dis.length, judged, toFix, passes: judged === dis.length && toFix === 0 };
}
