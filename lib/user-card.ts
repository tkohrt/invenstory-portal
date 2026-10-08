// User-generated Story Cards: the pure half (8 October 2026).
//
// A writer types a fact or a story into a draft and saves it as a Story Card.
// The words are filed as a short "Writer's note" in the client's Inven(s)tory
// and the card quotes it, so the card still traces to a source: the person who
// wrote it, on that date. Saving asks nothing up front. Everything is filled in
// already and the writer presses OK, or changes a field:
//
//   kind     the kind the question being answered asks for first
//   layer    Living voice: a person's own account, not a document
//   source   "Written by <name>, <organisation>, <date>"
//   as of    today
//
// Free of `server-only`; tested in tests/drafter/user-card.test.ts.
import { CARD_KIND_MAP, figuresIn, similarity, DUPLICATE_THRESHOLD, type CardKind } from "./story-card";

/** The word shown on these cards everywhere, in place of "custom". */
export const USER_GENERATED = "User-generated";

/** Long enough to stand on its own, short enough to be one claim or one story. */
export const USER_CARD_WORDS = { min: 5, max: 150 };

/** Why this text cannot be saved as a card, or null when it can. */
export function userCardProblem(text: string): string | null {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  if (n < USER_CARD_WORDS.min) return `Write at least ${USER_CARD_WORDS.min} words, so the card stands on its own.`;
  if (n > USER_CARD_WORDS.max) return `A card is one claim or one story; keep it under ${USER_CARD_WORDS.max} words, or split it.`;
  return null;
}

/**
 * The kind to suggest: the first kind the question asks for that this
 * organization's cards may have, else the first kind they may have at all.
 */
export function defaultKind(wantedKinds: string[], allowed: CardKind[]): string {
  const ok = new Set(allowed.map(k => k.key));
  return wantedKinds.find(k => ok.has(k)) ?? allowed[0]?.key ?? "program_model";
}

/** "8 October 2026", in Eastern time, the portal's month. */
export function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", day: "numeric", month: "long", year: "numeric" })
    .replace(/^(\w+) (\d+), (\d+)$/, "$2 $1 $3");
}

/** "2026-10-08" in Eastern time, for a date field. */
export function isoDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Who wrote it, as the card and its note record it. */
export function sourceLine(name: string, org: string, d: Date): string {
  return `Written by ${name.trim() || "a writer"}, ${org.trim() || "For Granted"}, ${longDate(d)}`;
}

/** The Writer's note filed in the Inven(s)tory. The card quotes its last paragraph, the text itself. */
export function writerNote(input: {
  text: string; kind: string; source: string; saidBy?: string | null; fromDocument?: string | null; asOf?: string | null;
}): { title: string; body: string; quote: string } {
  const label = CARD_KIND_MAP[input.kind]?.label ?? "Story Card";
  const quote = input.text.trim().replace(/[ \t]+/g, " ");
  const lines = [
    `Writer's note: ${label} (user-generated Story Card)`,
    `${input.source}.`,
    input.saidBy?.trim() ? `In the words of: ${input.saidBy.trim()}.` : null,
    input.fromDocument?.trim() ? `From: ${input.fromDocument.trim()}.` : null,
    input.asOf ? `True as of ${input.asOf}.` : null,
  ].filter(Boolean);
  return { title: `Writer's note: ${label}`, body: `${lines.join("\n")}\n\n${quote}\n`, quote };
}

/** Numbers the text mentions, for the one optional question: is that from a document? */
export const mentionedFigures = (text: string) => figuresIn(text);

export interface ExistingCard { id: string; kind: string; statement: string; status: string }

/** Cards already in the library that look like this one, most alike first. Retired cards do not count. */
export function lookAlikes(text: string, cards: ExistingCard[], limit = 3): ExistingCard[] {
  return cards
    .filter(c => c.status !== "retired")
    .map(c => ({ c, s: similarity(text, c.statement) }))
    .filter(x => x.s >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.c);
}
