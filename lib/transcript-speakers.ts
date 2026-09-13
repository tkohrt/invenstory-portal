// Who said a thing, and whether that makes it the client's.
//
// Pure and free of `server-only`, because this is the rule that decides whether
// a quote may describe the applicant and rules like that belong somewhere a
// test can reach them. The codebase already learned this once: subject
// quarantine works in the readiness engine because it is enforced in code
// rather than asked for in a prompt.

import type { Subject } from "@/lib/search-profile";

export interface Speaker {
  /** Exactly as it appears in the text: "Speaker 2", "Ashley", "Howie". */
  label: string;
  /** True, false, or absent when the document gives no evidence either way. */
  isClient?: boolean;
  name?: string | null;
  /** The line that shows it, so a wrong roster can be argued with. */
  evidence?: string | null;
}

export interface SpeakerRoster {
  chars: number;
  speakers: Speaker[];
}

/**
 * A speaker label at the start of a line.
 *
 * Written for what these transcripts actually contain rather than for a format:
 *   "Speaker 2  (00:18)"      the anonymous form, and the common one
 *   "Ashley Barrow (00:12):"  named with a timestamp
 *   "Shane:"                  named, bare
 *
 * Three constraints keep it from eating prose. It anchors to a line start; the
 * label is at most four words, since anything longer is a sentence; and it
 * demands a timestamp or a colon after the name. That last one matters: without
 * it a one-word line like "Absolutely." reads as a speaker, and a transcript is
 * full of those.
 *
 * The continuation token allows a digit because "Speaker 1" is a name here.
 */
const TURN =
  /^[ \t]*([A-Z][\w.'’-]*(?:[ \t]+[A-Z0-9][\w.'’-]*){0,3})[ \t]*(?:\((\d{1,2}:\d{2}(?::\d{2})?)\)[ \t]*:?|:)[ \t]*/gm;

export interface Turn { label: string; start: number; }

/**
 * Every speaker turn in a document, in order, with where it begins.
 *
 * Returns an empty list for a document that is not a transcript, which is the
 * signal callers use to leave it alone entirely.
 */
export function speakerTurns(text: string): Turn[] {
  const out: Turn[] = [];
  TURN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TURN.exec(text))) {
    const label = m[1].trim();
    if (label) out.push({ label, start: m.index });
  }
  return out;
}

/** Distinct labels, in the order they first speak. */
export function speakerLabels(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of speakerTurns(text)) {
    if (seen.has(t.label)) continue;
    seen.add(t.label);
    out.push(t.label);
  }
  return out;
}

/** Looks like a transcript: several turns from more than one speaker. */
export function looksLikeTranscript(text: string): boolean {
  return speakerLabels(text).length >= 2 && speakerTurns(text).length >= 4;
}

/** Who was speaking at this position in the text, if anybody. */
export function speakerAt(turns: Turn[], offset: number): string | null {
  let current: string | null = null;
  for (const t of turns) {
    if (t.start > offset) break;
    current = t.label;
  }
  return current;
}

/**
 * A claim the speaker is making about themselves or their own organization.
 *
 * Only first-person statements are reattributed. "They have a five-year
 * partnership with Mercy" said by an outsider is still a fact about the client;
 * "I have advised hundreds of companies" is a fact about the outsider. The
 * pronoun is what separates them, so it is what this looks for.
 */
export function isFirstPerson(quote: string): boolean {
  return /\b(i|i'?ve|i'?m|i'?d|i'?ll|my|mine|we|we'?ve|we'?re|we'?d|we'?ll|our|ours|us)\b/i
    .test(quote ?? "");
}

/**
 * The subject a quote deserves, given who said it.
 *
 * Narrow on purpose. It only ever moves a fact AWAY from the organization, and
 * only when three things hold at once: the document is a transcript, the
 * speaker is known not to be the client, and the quote is a first-person claim.
 * Anything less certain is left exactly as the reader tagged it, so this can
 * remove a false claim and can never manufacture one.
 */
export function attributeSubject(args: {
  quote: string;
  subject: Subject;
  turns: Turn[];
  roster: SpeakerRoster | null;
  /** Where the quote sits in the text, from indexOf. -1 when not found. */
  offset: number;
}): { subject: Subject; reattributed: boolean } {
  const { quote, subject, turns, roster, offset } = args;
  if (subject !== "organization") return { subject, reattributed: false };
  if (!roster || !turns.length || offset < 0) return { subject, reattributed: false };
  if (!isFirstPerson(quote)) return { subject, reattributed: false };

  const label = speakerAt(turns, offset);
  if (!label) return { subject, reattributed: false };

  const who = roster.speakers.find(s => s.label.toLowerCase() === label.toLowerCase());
  // Unknown speaker, or one we could not place: leave it alone. Absence of
  // evidence is not evidence that somebody is an outsider.
  if (!who || who.isClient !== false) return { subject, reattributed: false };

  return { subject: "third_party", reattributed: true };
}

/** One line for the run log, so a roster is visible rather than implied. */
export function describeRoster(roster: SpeakerRoster, title: string): string {
  const known = roster.speakers.filter(s => typeof s.isClient === "boolean");
  const ours = known.filter(s => s.isClient).length;
  const theirs = known.length - ours;
  const unknown = roster.speakers.length - known.length;
  const bits = [
    `${ours} from the client`,
    `${theirs} from outside`,
    unknown ? `${unknown} unplaced` : null,
  ].filter(Boolean);
  return `${roster.speakers.length} speaker(s) in ${title}: ${bits.join(", ")}.`;
}
