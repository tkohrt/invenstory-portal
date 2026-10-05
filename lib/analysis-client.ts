// Inven(s)tory Analysis, Phase C: the rules behind the client's results screen.
//
// The analysis suggests Funding Eligibility answers; the client confirms or turns
// down each one (Build Decisions, 2 October 2026, decision 4: always confirmed,
// never saved silently). These functions decide which suggestions are still
// open, what confirming one does to the profile, and what has opened up.
// Pure, so the page and the server agree and it is tested without a database.
import type { EligibilityProfile } from "./eligibility-fields";
import type { EligField, Suggestion } from "./analysis-derive";

const MANY: ReadonlySet<EligField> = new Set(["service_area", "populations", "cause_areas"]);
export const isManyField = (f: EligField) => MANY.has(f);

/** The identity of a suggested value, as decisions are stored. */
export function suggestionKey(field: EligField, value: string): string {
  return field === "ein" ? value.replace(/\D/g, "") : value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface SuggestionDecision { field: string; valueKey: string; decision: "confirmed" | "rejected" }

export interface OpenSuggestion extends Suggestion {
  /** Values the client has not yet decided on, and that the profile does not already hold. */
  open: Suggestion["values"];
}

/**
 * The suggestions still waiting for the client. A value already in the profile
 * needs no answer; a value the client turned down is not offered again.
 */
export function openSuggestions(suggestions: Suggestion[], decisions: SuggestionDecision[]): OpenSuggestion[] {
  const decided = new Set(decisions.map(d => `${d.field}|${d.valueKey}`));
  const out: OpenSuggestion[] = [];
  for (const s of suggestions) {
    const have = new Set(s.current.map(v => suggestionKey(s.field, v)));
    const open = s.values.filter(v => {
      const k = suggestionKey(s.field, v.value);
      return !have.has(k) && !decided.has(`${s.field}|${k}`);
    });
    if (open.length) out.push({ ...s, open });
  }
  return out;
}

/**
 * The profile after the client confirms one suggested value. A list field gains
 * the value; a one-value field takes it, replacing what was there.
 */
export function applySuggestion(profile: EligibilityProfile, field: EligField, value: string): EligibilityProfile {
  const next: Record<string, unknown> = { ...profile };
  if (MANY.has(field)) {
    const list = Array.isArray(next[field]) ? (next[field] as string[]) : [];
    const k = suggestionKey(field, value);
    next[field] = list.some(v => suggestionKey(field, v) === k) ? list : [...list, value];
  } else {
    next[field] = value;
  }
  return next as unknown as EligibilityProfile;
}

/** What has opened up, by the spec's conditions. The admin switch keeps the last word. */
export function unlocks(input: { analysed: boolean; eligibilityConfirmed: boolean; essentialsThin: boolean }) {
  return {
    storyCards: input.analysed,
    funderMatches: input.eligibilityConfirmed && input.essentialsThin,
    funderMatchesWaitingOn: [
      ...(input.eligibilityConfirmed ? [] : ["confirming your eligibility answers"]),
      ...(input.essentialsThin ? [] : ["every Essential item at least partly covered"]),
    ],
  };
}
