// Bringing in a funder's application: the pure half.
//
// A funder's application arrives as text (pasted, extracted from a PDF or Word
// file, or fetched from a page). The model reads it in windows and proposes its
// questions; this file decides what those proposals are worth, the same split as
// lib/story-card.ts: the prompt asks, the code decides.
//
// What the code decides here:
//   * whether each proposed question is actually in the funder's text (flagged,
//     never silently dropped: a person confirms the parse anyway, and a missing
//     question is worse than a flagged one);
//   * whether a stated limit is real (a limit the source does not state is
//     removed; a limit the source states and the model missed is filled in);
//   * which questions are the same question seen twice across overlapping
//     windows;
//   * whether a bank match names a real bank question and real card kinds.
//
// Pure and free of `server-only`, so every rule is tested without a model.
import { z } from "zod";
import { normalizeText, claimTokens, kindsFor } from "./story-card";

// ---------------------------------------------------------------------------
// Windows.
// ---------------------------------------------------------------------------

/**
 * The funder's text, cut into overlapping pieces the model can read in one call.
 *
 * Larger than the card pass's windows: finding questions is lighter reading
 * than finding claims, and fewer windows means fewer places a question can be
 * cut in half. The overlap is generous for the same reason. A question cut at a
 * boundary appears whole in one window and partly in the other, and the merge
 * below keeps the whole one.
 */
export const WINDOW_CHARS = 16_000;
export const WINDOW_OVERLAP = 1_500;
/** About 60 pages of dense RFP. Beyond this the text is cut and the page says so. */
export const MAX_WINDOWS = 12;

export function applicationWindows(text: string): { windows: string[]; truncated: boolean } {
  const t = text.trim();
  if (t.length <= WINDOW_CHARS + WINDOW_OVERLAP) return { windows: t ? [t] : [], truncated: false };
  const out: string[] = [];
  let i = 0;
  while (i < t.length && out.length < MAX_WINDOWS) {
    out.push(t.slice(i, i + WINDOW_CHARS));
    i += WINDOW_CHARS - WINDOW_OVERLAP;
  }
  return { windows: out, truncated: i < t.length };
}

// ---------------------------------------------------------------------------
// What the model returns for one window.
// ---------------------------------------------------------------------------

const str = z.string().trim();
const optStr = z.union([str, z.null()]).optional().transform(v => (v ? v : null));
const optInt = z.union([z.number(), z.string(), z.null()]).optional().transform(v => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
});

export const RawQuestionSchema = z.object({
  prompt: str.min(1),
  guidance: optStr,
  limit_value: optInt,
  limit_unit: z.union([z.string(), z.null()]).optional().transform(v => {
    const u = (v ?? "").toLowerCase();
    if (u.startsWith("word")) return "words" as const;
    if (u.startsWith("char")) return "characters" as const;
    return null;
  }),
  criteria: optStr,
});

export const WindowAnswerSchema = z.object({
  title: optStr,
  funder: optStr,
  deadline: optStr,
  attachments: z.array(z.union([str, z.null()])).optional().transform(a => (a ?? []).filter((x): x is string => !!x)),
  questions: z.array(z.unknown()).optional().default([]),
});

export type RawQuestion = z.infer<typeof RawQuestionSchema>;

export interface WindowAnswer {
  title: string | null;
  funder: string | null;
  deadline: string | null;
  attachments: string[];
  questions: RawQuestion[];
  /** Items the model returned that did not validate, counted for the log. */
  invalid: number;
}

/**
 * Parse one window's answer.
 *
 * Lenient about wrapping (a stray sentence around the JSON, a code fence),
 * strict about each question: an item that fails the schema is counted and
 * dropped rather than guessed at. Returns null when there is no JSON at all,
 * which the job treats as the model not answering.
 */
export function parseWindowAnswer(raw: string): WindowAnswer | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  const top = WindowAnswerSchema.safeParse(obj);
  if (!top.success) return null;
  const questions: RawQuestion[] = [];
  let invalid = 0;
  for (const q of top.data.questions) {
    const r = RawQuestionSchema.safeParse(q);
    if (r.success) questions.push(r.data);
    else invalid++;
  }
  return {
    title: top.data.title, funder: top.data.funder, deadline: top.data.deadline,
    attachments: top.data.attachments, questions, invalid,
  };
}

// ---------------------------------------------------------------------------
// Is the question really in the funder's text?
// ---------------------------------------------------------------------------

/**
 * Remove the numbering and labels applications put in front of a question:
 * "3.", "Q4:", "Question 2 -", "B)", "(a)", "Section 3.1". These are the
 * application's structure, not the question, and models keep or drop them
 * unpredictably.
 */
export function stripNumbering(prompt: string): string {
  return prompt
    // "Question 3:", "Q4.", "Section 3.1 -", "Part 2b)". A digit is required, so
    // a sentence that merely starts with "Part of..." is left alone.
    .replace(/^\s*(?:section|question|q|part|item)\s*\d+(?:\.\d+)*[a-z]?\s*[:.)\-–—]?\s*/i, "")
    // "4.B.1", "A.2", "3.1." (dotted, with a digit somewhere, so "U.S." is left alone)
    .replace(/^\s*\(?(?=[A-Za-z.]*\d)(?:\d+|[A-Za-z])(?:\.(?:\d+|[A-Za-z]))+\.?\)?\s+/, "")
    // "3.", "(a)", "b)", "iv."
    .replace(/^\s*\(?(?:\d+|[a-z]|[ivx]{1,4})[.)]\s+/i, "")
    .trim();
}

const cleanForMatch = (s: string) =>
  normalizeText(stripNumbering(s))
    .replace(/^["'*_#\s]+|["'*_#\s:.?]+$/g, "")
    .replace(/\s*\*+\s*/g, " ")
    .trim();

/**
 * Whether a proposed question appears in the funder's text.
 *
 * Exact after normalisation (case, curly quotes, dashes, whitespace, numbering),
 * which tolerates the edits PDF extraction makes and nothing else. A question
 * the model paraphrased fails, which is the point: the section's prompt is
 * meant to be the funder's words.
 */
export function promptInSource(prompt: string, source: string): boolean {
  const p = cleanForMatch(prompt);
  if (p.length < 4) return false;
  const s = normalizeText(source).replace(/\s*\*+\s*/g, " ");
  return s.includes(p);
}

// ---------------------------------------------------------------------------
// Limits.
// ---------------------------------------------------------------------------

export interface StatedLimit { value: number; unit: "words" | "characters" }

/**
 * Every length limit a piece of text states.
 *
 * "500 words", "500-word", "2,500 characters", "2500 chars", "maximum of 300
 * words", "(250 word limit)". Pages are deliberately not a unit here: a page
 * limit depends on formatting and cannot be counted live, so it stays in the
 * guidance text where a writer will read it.
 */
export function statedLimits(text: string): StatedLimit[] {
  const out: StatedLimit[] = [];
  const seen = new Set<string>();
  const re = /(\d{1,3}(?:,\d{3})+|\d+)\s*(?:-\s*)?(words?|characters?|chars?)\b/gi;
  for (const m of text.matchAll(re)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = m[2].toLowerCase().startsWith("w") ? "words" : "characters";
    const k = `${value}:${unit}`;
    if (!seen.has(k)) { seen.add(k); out.push({ value, unit }); }
  }
  return out;
}

/**
 * The limit a section should carry, decided against the source.
 *
 * A model-proposed limit survives only if the funder's text states that number
 * with that unit somewhere. When the model gave none, the question's own prompt
 * and guidance are searched, and a single stated limit there is used. Two
 * different limits in one question's text is ambiguous and left for a person.
 */
export function resolveLimit(q: RawQuestion, source: string): { limit: StatedLimit | null; changed: "kept" | "removed" | "filled" | "none" } {
  const inSource = statedLimits(source);
  if (q.limit_value && q.limit_unit) {
    const ok = inSource.some(l => l.value === q.limit_value && l.unit === q.limit_unit);
    return ok ? { limit: { value: q.limit_value, unit: q.limit_unit }, changed: "kept" } : { limit: null, changed: "removed" };
  }
  const own = statedLimits(`${q.prompt}\n${q.guidance ?? ""}`);
  if (own.length === 1) return { limit: own[0], changed: "filled" };
  return { limit: null, changed: "none" };
}

// ---------------------------------------------------------------------------
// Merging windows.
// ---------------------------------------------------------------------------

export interface ParsedSection {
  prompt: string;
  guidance: string | null;
  limit_value: number | null;
  limit_unit: "words" | "characters" | null;
  criteria: string | null;
  in_source: boolean;
}

export interface ParseResult {
  sections: ParsedSection[];
  title: string | null;
  funder: string | null;
  deadline: string | null;
  attachments: string[];
  /** Counts for the job log and the confirmation screen. */
  stats: {
    proposed: number; duplicates: number; notInSource: number;
    limitsKept: number; limitsFilled: number; limitsRemoved: number; invalid: number;
  };
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a); let inter = 0;
  for (const t of b) if (A.has(t)) inter++;
  return inter / (A.size + b.length - inter);
}

/** Two prompts are the same question when one contains the other, or their content words nearly coincide. */
export function sameQuestion(a: string, b: string): boolean {
  const na = cleanForMatch(a), nb = cleanForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = shorter === na ? nb : na;
  // A question cut at a window edge is a prefix or suffix of the whole one.
  if (shorter.length >= 25 && (longer.startsWith(shorter) || longer.endsWith(shorter))) return true;
  return jaccard(claimTokens(a), claimTokens(b)) >= 0.85;
}

const longer = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : b.length > a.length ? b : a;

/**
 * Combine every window's answer into one ordered list of questions.
 *
 * Order is the order of first appearance, which is the application's order
 * because windows are read in sequence. A question seen in two windows keeps
 * the longer prompt and whichever copy carried a limit, guidance or criteria.
 */
export function mergeWindows(answers: (WindowAnswer | null)[], source: string): ParseResult {
  const stats = { proposed: 0, duplicates: 0, notInSource: 0, limitsKept: 0, limitsFilled: 0, limitsRemoved: 0, invalid: 0 };
  const merged: RawQuestion[] = [];
  let title: string | null = null, funder: string | null = null, deadline: string | null = null;
  const attachments: string[] = [];

  for (const a of answers) {
    if (!a) continue;
    stats.invalid += a.invalid;
    title ??= a.title; funder ??= a.funder; deadline ??= a.deadline;
    for (const at of a.attachments) {
      if (!attachments.some(x => normalizeText(x) === normalizeText(at))) attachments.push(at);
    }
    for (const q of a.questions) {
      stats.proposed++;
      const i = merged.findIndex(m => sameQuestion(m.prompt, q.prompt));
      if (i < 0) { merged.push({ ...q }); continue; }
      stats.duplicates++;
      const m = merged[i];
      merged[i] = {
        prompt: longer(m.prompt, q.prompt) as string,
        guidance: longer(m.guidance, q.guidance),
        criteria: longer(m.criteria, q.criteria),
        limit_value: m.limit_value ?? q.limit_value,
        limit_unit: m.limit_value ? m.limit_unit : q.limit_unit,
      };
    }
  }

  const sections: ParsedSection[] = merged.map(q => {
    const { limit, changed } = resolveLimit(q, source);
    if (changed === "kept") stats.limitsKept++;
    if (changed === "filled") stats.limitsFilled++;
    if (changed === "removed") stats.limitsRemoved++;
    const in_source = promptInSource(q.prompt, source);
    if (!in_source) stats.notInSource++;
    return {
      prompt: stripNumbering(q.prompt) || q.prompt,
      guidance: q.guidance, criteria: q.criteria,
      limit_value: limit?.value ?? null, limit_unit: limit?.unit ?? null,
      in_source,
    };
  });

  return { sections, title, funder, deadline, attachments, stats };
}

// ---------------------------------------------------------------------------
// Deadlines.
// ---------------------------------------------------------------------------

/** "March 15, 2027", "2027-03-15", "3/15/2027" to an ISO date, or null. Never guesses a year. */
export function isoDeadline(s: string | null): string | null {
  if (!s) return null;
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const long = s.toLowerCase().match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/);
  if (long) {
    const mi = months.findIndex(m => m.startsWith(long[1].slice(0, 3)));
    if (mi >= 0) return `${long[3]}-${String(mi + 1).padStart(2, "0")}-${long[2].padStart(2, "0")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matching to the question bank.
// ---------------------------------------------------------------------------

/**
 * The card kinds each seeded bank question calls for, when the bank row does
 * not say (grant_question.wanted_kinds is empty for all 19 seeds). The model's
 * choice is unioned with these, so a need question always asks for need cards
 * even when the model forgot to say so.
 */
export const SLUG_KINDS: Record<string, string[]> = {
  "org-overview":   ["mission_values", "origin_history", "program_model", "differentiator"],
  "leadership":     ["leadership_team", "capacity_track_record"],
  "use-of-funds":   ["finance_budget", "program_model"],
  "need":           ["need_data", "need_story", "population_geography"],
  "who-you-serve":  ["population_geography", "need_data", "beneficiary_story"],
  "program":        ["program_model", "partnership", "beneficiary_story", "differentiator"],
  "goals":          ["outcome_metric", "program_model"],
  "outcomes":       ["outcome_metric", "beneficiary_story", "client_voice"],
  "history":        ["origin_history", "capacity_track_record"],
  "financial":      ["finance_budget", "funding_source", "sustainability"],
  "sustainability": ["sustainability", "funding_source", "finance_budget", "partnership"],
  "partnerships":   ["partnership"],
  "problem":        ["need_data", "need_story", "market"],
  "solution":       ["program_model", "differentiator"],
  "market":         ["market", "population_geography"],
  "traction":       ["traction", "outcome_metric"],
  "business-model": ["finance_budget", "market", "sustainability"],
  "competition":    ["differentiator", "market", "partnership"],
  "milestones":     ["sustainability", "traction", "program_model"],
};

export interface BankQuestion {
  id: string; slug: string; category: string; prompt_text: string;
  audience: "nonprofit" | "startup" | "both"; wanted_kinds?: string[] | null;
}

/** The bank questions a client of this org type may be matched to. */
export function bankFor(bank: BankQuestion[], orgType: string | null | undefined): BankQuestion[] {
  const branch = orgType === "for_profit" ? "startup" : "nonprofit";
  return bank.filter(q => q.audience === "both" || q.audience === branch);
}

const RawMatchSchema = z.object({
  i: z.union([z.number(), z.string()]).transform(v => Number(v)),
  primary: z.union([z.string(), z.null()]).optional().transform(v => (v && v.trim() && !/^new/i.test(v.trim()) ? v.trim() : null)),
  slugs: z.array(z.string()).optional().default([]),
  kinds: z.array(z.string()).optional().default([]),
  reason: z.union([z.string(), z.null()]).optional().transform(v => (v ?? "").trim().slice(0, 300)),
});

export interface SectionMatch {
  /** The one bank question this section asks, or null for a new topic. */
  primary: string | null;
  /** Every bank question it touches, primary first. */
  slugs: string[];
  kinds: string[];
  reason: string;
}

/**
 * Parse and validate the model's matches for a batch of sections.
 *
 * A slug that is not in this client's bank, or a kind not in this client's
 * kinds, is dropped: the model may only choose from the lists it was given.
 * Sections the model skipped come back as a new topic with no kinds, and say so.
 */
export function parseMatches(
  raw: string, count: number, bank: BankQuestion[], orgType: string | null | undefined,
): SectionMatch[] {
  const allowedSlugs = new Set(bankFor(bank, orgType).map(q => q.slug));
  const allowedKinds = new Set(kindsFor(orgType).map(k => k.key));
  const bySlug = new Map(bank.map(q => [q.slug, q]));
  const out: SectionMatch[] = Array.from({ length: count }, () => ({
    primary: null, slugs: [], kinds: [], reason: "Not matched: the model did not return this question.",
  }));

  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return out;
  let arr: unknown;
  try { arr = JSON.parse(m[0]); } catch { return out; }
  if (!Array.isArray(arr)) return out;

  for (const item of arr) {
    const r = RawMatchSchema.safeParse(item);
    if (!r.success) continue;
    const idx = r.data.i;
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
    const primary = r.data.primary && allowedSlugs.has(r.data.primary) ? r.data.primary : null;
    const slugs = [...new Set([primary, ...r.data.slugs.map(s => s.trim())]
      .filter((s): s is string => !!s && allowedSlugs.has(s)))];
    // The primary leads. When the model named no valid primary, a new topic
    // it is, even if it listed related slugs: those still guide card kinds.
    const kinds = new Set(r.data.kinds.map(k => k.trim()).filter(k => allowedKinds.has(k)));
    for (const s of slugs) {
      const own = bySlug.get(s)?.wanted_kinds;
      for (const k of (own && own.length ? own : SLUG_KINDS[s] ?? [])) if (allowedKinds.has(k)) kinds.add(k);
    }
    out[idx] = {
      primary, slugs, kinds: [...kinds],
      reason: r.data.reason || (primary ? `Asks the bank's "${bySlug.get(primary)?.category}" question.` : "A topic the bank does not have yet."),
    };
  }
  return out;
}
