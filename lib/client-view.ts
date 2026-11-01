// A client's own view of its Funder Matches (patch 7 of the 1 November 2026
// build), and the switch that lets a client run searches itself.
//
// For Granted's judgments (lib/triage.ts) stay For Granted's: admin-only, with
// reason codes that can become Ground Truth corrections. A client gets a
// simpler, separate pair, "Worth a look" and "Not for us", kept in its own
// table so the two can never overwrite each other, and so For Granted can see
// what the client thinks without the client seeing For Granted's workings.
//
// Pure and free of `server-only`, tested in tests/portal/client-view.test.ts.

export type ClientViewKind = "grant" | "funder" | "lead";
export type ClientViewState = "interested" | "not_for_us";

export const CLIENT_STATE_LABEL: Record<ClientViewState, string> = {
  interested: "Worth a look",
  not_for_us: "Not for us",
};

export interface ClientReason { code: string; label: string }

/** Why it is not for them. Short, in their words, and countable. */
export const CLIENT_REASONS: readonly ClientReason[] = [
  { code: "wrong_focus", label: "Not what we do" },
  { code: "wrong_place", label: "Not where we work" },
  { code: "not_eligible", label: "We are not eligible" },
  { code: "too_small", label: "Too small to be worth it" },
  { code: "too_big", label: "Too big for us right now" },
  { code: "not_now", label: "Not now, maybe later" },
  { code: "already_known", label: "Already know them or applied" },
  { code: "other", label: "Something else" },
];

export function isClientViewKind(v: unknown): v is ClientViewKind {
  return v === "grant" || v === "funder" || v === "lead";
}
export function isClientViewState(v: unknown): v is ClientViewState {
  return v === "interested" || v === "not_for_us";
}
export function reasonLabel(code: string | null | undefined): string | null {
  return code ? CLIENT_REASONS.find(r => r.code === code)?.label ?? null : null;
}

export interface ClientView { state: ClientViewState; reason: string | null; note: string | null; decidedAt: string }

/** "Worth a look", or "Not for us (not where we work)". */
export function viewSentence(v: Pick<ClientView, "state" | "reason">): string {
  const r = reasonLabel(v.reason);
  return v.state === "not_for_us" && r ? `${CLIENT_STATE_LABEL.not_for_us} (${r.toLowerCase()})` : CLIENT_STATE_LABEL[v.state];
}

/**
 * What a save may store. A reason belongs only to "Not for us", and must be
 * one of the list; a note is short. Returns null for anything else.
 */
export function cleanView(input: { kind?: unknown; targetId?: unknown; state?: unknown; reason?: unknown; note?: unknown }):
  { kind: ClientViewKind; targetId: string; state: ClientViewState; reason: string | null; note: string | null } | null {
  if (!isClientViewKind(input.kind) || !isClientViewState(input.state)) return null;
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : "";
  if (!targetId || targetId.length > 400) return null;
  const reason = input.state === "not_for_us" && typeof input.reason === "string" && CLIENT_REASONS.some(r => r.code === input.reason)
    ? input.reason : null;
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 300) : null;
  return { kind: input.kind, targetId, state: input.state, reason, note };
}

// ---- The client running searches itself ----

/** The per-client switch, stored in feature_visibility beside the page switches. */
export const SELF_SEARCH_KEY = "funder_search_self";

/** Searches a client may start in a day, whatever the allowance says: match runs, web search runs. */
export const CLIENT_DAILY = { match: 3, discover: 2 } as const;

/**
 * May this session start a search for this client? For Granted always may. A
 * client may when For Granted switched it on, the page itself is on for them,
 * and they are under the day's count. Pure, so the gate is tested.
 */
export function selfSearchDecision(input: {
  role: "admin" | "client"; switchOn: boolean; pageOn: boolean; usedToday: number; limit: number;
}): { ok: true } | { ok: false; error: string } {
  if (input.role === "admin") return { ok: true };
  if (!input.pageOn || !input.switchOn) return { ok: false, error: "Searching is run by your For Granted team for now." };
  if (input.usedToday >= input.limit) return { ok: false, error: "That is today's searches used. Try again tomorrow, or ask your For Granted team." };
  return { ok: true };
}
