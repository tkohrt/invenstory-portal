// What For Granted has decided about a match, and what follows from it.
//
// Pure and free of `server-only`, so the rules that decide whether a reason is
// mandatory, whether a row is suppressed and whether a rejection is a global
// fact can be tested without a database.
//
// TWO VOCABULARIES. A funder is a relationship cultivated over months; a
// solicitation is an application decided by a date. Pin and reject cannot
// express "yes, but not this cycle", which is the commonest truthful answer
// about a good funder, so funders get their own states.

export type TriageKind = "funder" | "grant";

export type FunderState = "target" | "watching" | "approached" | "not_a_fit";
export type GrantState = "pinned" | "under_review" | "rejected";
export type TriageState = FunderState | GrantState;

export const FUNDER_STATES: readonly FunderState[] =
  ["target", "watching", "approached", "not_a_fit"];
export const GRANT_STATES: readonly GrantState[] =
  ["pinned", "under_review", "rejected"];

export const STATE_LABEL: Record<TriageState, string> = {
  target: "Target",
  watching: "Watching",
  approached: "Approached",
  not_a_fit: "Not a fit",
  pinned: "Pinned",
  under_review: "Under review",
  rejected: "Rejected",
};

/** What each state commits you to, shown on hover so the words stay honest. */
export const STATE_HELP: Record<TriageState, string> = {
  target: "Worth pursuing. Stays at the top of the list until that changes.",
  watching: "A real fit, but not now: wrong cycle, or the client needs more traction first. "
    + "Kept out of the way without being ruled out.",
  approached: "Contact has been made. Here so nobody writes the same introduction twice.",
  not_a_fit: "Ruled out for this client, with the reason recorded. Stops appearing in the list.",
  pinned: "Worth applying for. Stays at the top of the list.",
  under_review: "Being looked at. Neither committed to nor ruled out.",
  rejected: "Not worth applying for, with the reason recorded. Stops appearing in the list.",
};

export function statesFor(kind: TriageKind): readonly TriageState[] {
  return kind === "funder" ? FUNDER_STATES : GRANT_STATES;
}

export function stateAllowed(kind: TriageKind, state: string): state is TriageState {
  return (statesFor(kind) as readonly string[]).includes(state);
}

/**
 * States that take a row off the list.
 *
 * Deliberately narrow. "Watching" is not suppression: a funder that fits but is
 * out of cycle should stay visible and out of the way, and conflating the two
 * is how a good prospect gets buried for a year.
 */
const SUPPRESSING: readonly TriageState[] = ["not_a_fit", "rejected"];
export function suppresses(state: TriageState): boolean {
  return SUPPRESSING.includes(state);
}

/**
 * Why a row was ruled out.
 *
 * Controlled, because free text cannot suppress, cannot propose a correction
 * and cannot be counted. The split is the useful part: some reasons are facts
 * about the record that hold for every client, and some are true only of this
 * pairing.
 */
export interface ReasonCode {
  code: string;
  label: string;
  /** True for everyone, so it can become a Ground Truth proposal. */
  global: boolean;
  help: string;
}

export const FUNDER_REASONS: readonly ReasonCode[] = [
  { code: "not_a_grantmaker", label: "Not actually a grantmaker", global: true,
    help: "An operating charity or a service provider, not a source of money. True for every client." },
  { code: "defunct", label: "Defunct or merged", global: true,
    help: "The organization no longer exists under this name. True for every client." },
  { code: "no_longer_funding", label: "No longer making grants", global: true,
    help: "Still exists, has stopped giving. True for every client." },
  { code: "invitation_only", label: "Invitation only, no route in", global: true,
    help: "Accepts no unsolicited approach and we have no introduction. A fact about the funder, "
      + "though the route in can change." },
  { code: "wrong_cause", label: "Wrong cause area", global: false,
    help: "They fund real things, just not what this client does." },
  { code: "wrong_geography", label: "Outside their geography", global: false,
    help: "This client is not where they give." },
  { code: "wrong_org_type", label: "Wrong organization type", global: false,
    help: "They fund nonprofits and this client is a company, or the reverse." },
  { code: "too_small", label: "Grants too small to be worth it", global: false,
    help: "Real money, not enough of it to justify the work." },
  { code: "already_declined", label: "Already declined this client", global: false,
    help: "They have said no. Worth remembering rather than rediscovering." },
  { code: "values_conflict", label: "Values conflict", global: false,
    help: "The client will not take money from this source. Permanent, and true only for them." },
];

export const GRANT_REASONS: readonly ReasonCode[] = [
  { code: "not_a_grant", label: "Not actually a grant", global: true,
    help: "A contract, a loan, a prize with strings, or a listing that is not funding at all." },
  { code: "deadline_passed", label: "Deadline has passed", global: true,
    help: "Closed. True for every client looking at the same record." },
  { code: "programme_ended", label: "Programme no longer runs", global: true,
    help: "The solicitation is not coming back." },
  { code: "ineligible", label: "This client is not eligible", global: false,
    help: "The eligibility text rules them out on something the screen did not catch." },
  { code: "wrong_purpose", label: "Wrong purpose", global: false,
    help: "Eligible, but the money is for something this client does not do." },
  { code: "too_small", label: "Too small to be worth the work", global: false,
    help: "The award does not justify the application effort." },
  { code: "cannot_meet_terms", label: "Cannot meet the terms", global: false,
    help: "Cost match, reporting burden, registration, or a timeline the client cannot make." },
  { code: "values_conflict", label: "Values conflict", global: false,
    help: "The client will not take this money." },
];

export function reasonsFor(kind: TriageKind): readonly ReasonCode[] {
  return kind === "funder" ? FUNDER_REASONS : GRANT_REASONS;
}

export function findReason(kind: TriageKind, code: string | null | undefined): ReasonCode | null {
  if (!code) return null;
  return reasonsFor(kind).find(r => r.code === code) ?? null;
}

/**
 * A reason is required exactly when the state rules the row out.
 *
 * Enforced here rather than trusted to the interface, because a rejection with
 * no reason is the one shape of this data that teaches nothing: it cannot be
 * counted, cannot propose a correction, and leaves the next person guessing.
 */
export function reasonRequired(state: TriageState): boolean {
  return suppresses(state);
}

export function validateTriage(
  kind: TriageKind, state: string, reason: string | null | undefined,
): { ok: true; state: TriageState; reason: string | null } | { ok: false; error: string } {
  if (!stateAllowed(kind, state)) {
    return { ok: false, error: `"${state}" is not something a ${kind} can be.` };
  }
  if (!reasonRequired(state)) return { ok: true, state, reason: null };
  const found = findReason(kind, reason);
  if (!found) {
    return { ok: false, error: "Ruling a row out needs a reason, chosen from the list." };
  }
  return { ok: true, state, reason: found.code };
}

/**
 * Whether this judgment is also a correction to the shared record.
 *
 * Only a suppressing state with a global reason. "Watching a funder because
 * they are invitation only" is not a claim that they are invitation only for
 * everyone, so the state matters as much as the code.
 */
export function proposesCorrection(
  kind: TriageKind, state: TriageState, reason: string | null,
): ReasonCode | null {
  if (!suppresses(state)) return null;
  const r = findReason(kind, reason);
  return r?.global ? r : null;
}
