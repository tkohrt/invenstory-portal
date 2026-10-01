// Sensitive stories: the pure half.
//
// A card that ties an identifiable person to a protected status (substance use
// or recovery, mental or physical health, criminal justice, immigration, abuse)
// must not reach a funder without that person's consent or without being
// de-identified. For recovery clients this is not courtesy but law: 42 CFR
// Part 2 and HIPAA. Even "Terry took the workforce course" can disclose
// recovery when the course is for people in recovery.
//
// Two signals, either one enough:
//   * the reader (the model) flags it while extracting, being asked exactly this;
//   * this rule, which needs BOTH a protected-status term AND a sign that the
//     card is about one individual rather than the organisation's population.
//
// The rule is deliberately cautious in one direction only. "Hope Town serves
// people in recovery" is about a population and is not flagged; "she has been
// in recovery for two years" is. A wrongly flagged card costs a reviewer one
// click; a missed one can cost a person their privacy. It is a guard, not a
// guarantee, which is why the reader's flag also counts and why the clearing
// decision is always a person's.
//
// Free of `server-only`; tested in tests/drafter/card-sensitivity.test.ts.

export interface ProtectedTopic { label: string; re: RegExp }

export const PROTECTED_TOPICS: ProtectedTopic[] = [
  { label: "substance use or recovery",
    re: /\b(recover(?:y|ing|ed)|sober|sobriety|addict\w*|substance use|opioids?|overdos\w*|relaps\w*|rehab\w*|detox\w*|alcoholi\w*|drug use|methadone|suboxone|narcan|naloxone|treatment cent(?:er|re)s?)\b/i },
  { label: "mental health",
    re: /\b(mental (?:health|illness)|psychiatr\w*|depress(?:ion|ed)|anxiety|bipolar|schizophren\w*|ptsd|suicid\w*|self-harm|eating disorder)\b/i },
  { label: "a health condition",
    re: /\b(hiv|aids|cancer|chemotherapy|diagnos\w*|disabilit\w*|pregnan\w*|hospitali[sz]ed|terminal(?:ly)? ill)\b/i },
  { label: "criminal justice involvement",
    re: /\b(incarcerat\w*|prison|jail|probation|parole|felon\w*|convict\w*|arrest\w*|criminal record|returning citizens?|justice[- ]involved|re-?entry)\b/i },
  { label: "immigration status",
    re: /\b(undocumented|immigration status|asylum|refugees?|deport\w*)\b/i },
  { label: "abuse, violence or housing crisis",
    re: /\b(domestic violence|abus(?:e|ed|ive)|trafficking|homeless\w*|unhoused|foster care|evict\w*)\b/i },
];

/** Card kinds that exist to describe a particular person. */
const PERSONAL_KINDS = new Set(["beneficiary_story", "client_voice"]);

const PRONOUN = /\b(he|she|him|his|her|hers|himself|herself)\b/i;
const ONE_PERSON = /\b(?:a|one|another|this) (?:young )?(?:man|woman|boy|girl|participant|client|resident|patient|student|youth|veteran|mother|father|mom|dad|person|member|graduate|individual|customer|neighbou?r|survivor)\b/i;
// First person inside a quote: someone speaking about themselves. "I" is
// case-sensitive and must not follow a word that makes it a roman numeral
// ("Layer I", "Phase I", "Title I").
const FIRST_PERSON = /(?:^|[\s"'(])(?:(?<!\b(?:Layer|Phase|Tier|Part|Title|Section|Level|Class|Type|Stage|Chapter)\s)I(?:'m|'ve|'d|'ll)?|[Mm]y|me|myself)\s+[a-z]/;

export interface SensitivityInput {
  kind: string;
  subject: "organization" | "third_party";
  statement: string;
  quotes: string[];
  /** Whether the reader flagged any of this card's evidence as sensitive. */
  modelFlag: boolean;
}

export interface Sensitivity { sensitive: boolean; reason: string | null }

/** The protected topics a text touches, in table order, without repeats. */
export function protectedTopics(text: string): string[] {
  return PROTECTED_TOPICS.filter(t => t.re.test(text)).map(t => t.label);
}

const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
const touches = (sentence: string) => PROTECTED_TOPICS.some(t => t.re.test(sentence));

/**
 * Why the card reads as tying one person to a protected topic, or null.
 *
 * Checked a sentence at a time: the person and the topic must meet in the same
 * sentence. "I" in one sentence of a transcript and "diagnoses" in another is a
 * founder describing who they serve, not disclosing a diagnosis; RE-Assist's and
 * Rézme's libraries showed that difference on 1 October 2026.
 */
export function personSignal(input: Pick<SensitivityInput, "kind" | "subject" | "statement" | "quotes">): string | null {
  if (PERSONAL_KINDS.has(input.kind)) return "it is a story about, or in the words of, a particular person";
  for (const sn of sentences(input.statement)) {
    if (!touches(sn)) continue;
    if (PRONOUN.test(sn)) return "it refers to a person as he or she in the same breath";
    if (ONE_PERSON.test(sn)) return "it describes one individual";
  }
  for (const q of input.quotes) {
    for (const sn of sentences(q)) {
      if (!touches(sn)) continue;
      if (FIRST_PERSON.test(sn)) return "its source is someone speaking about themselves";
      if (ONE_PERSON.test(sn)) return "it describes one individual";
      if (input.subject === "third_party" && PRONOUN.test(sn)) return "it is about someone outside the organisation";
    }
  }
  return null;
}

/**
 * Whether a card needs a person's decision before it can be placed.
 *
 * Returns the reason in plain words for the reviewer. The reader's flag alone is
 * enough; the rule needs a protected topic AND a person, in the same sentence.
 */
export function assessSensitivity(input: SensitivityInput): Sensitivity {
  const text = [input.statement, ...input.quotes].join("\n");
  const topics = protectedTopics(text);
  const person = topics.length ? personSignal(input) : null;
  const ruled = topics.length > 0 && person !== null;
  if (!ruled && !input.modelFlag) return { sensitive: false, reason: null };

  const parts: string[] = [];
  if (ruled) parts.push(`Mentions ${topics.join(" and ")}, and ${person}.`);
  if (input.modelFlag) parts.push(ruled
    ? "The reader flagged it too."
    : "The reader flagged it as possibly identifying a person's protected information.");
  return { sensitive: true, reason: parts.join(" ") };
}

export type SensitiveClearance = "consent" | "deidentified" | "not_sensitive";

/** May this card go into an answer? */
export function placeable(card: { sensitive?: boolean | null; sensitiveCleared?: SensitiveClearance | null }): boolean {
  return !card.sensitive || !!card.sensitiveCleared;
}

export const CLEARANCE_LABEL: Record<SensitiveClearance, string> = {
  consent: "Consent recorded",
  deidentified: "De-identified",
  not_sensitive: "Ruled not sensitive",
};
