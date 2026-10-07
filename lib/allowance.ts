// The monthly AI allowance (Build Decisions 24, 30 and 32, 6 October 2026).
//
// Each client has a monthly allowance of AI spend the client itself caused, as
// measured by the meter (ai_usage rows with actor 'client', priced at list in
// lib/ai-pricing.ts), for the calendar month in Eastern time. Spend For
// Granted causes, or background steps, never counts. Admins are never limited.
//
// The allowance is a SOFT line with a HARD ceiling above it (decision 32), so
// nobody is cut off in the middle of their work:
//
//   under 80%        nothing to say
//   80% to 100%      a heads-up to the client
//   the allowance    nothing stops; For Granted is alerted, the client is told
//   to the ceiling   that For Granted has been told
//   the ceiling      the one hard stop (2x the allowance unless For Granted sets
//                    another), and only for interactive steps: chat, re-running
//                    the readiness check, Story Intelligence. "Request more".
//
// Two kinds of step:
//   interactive   chat, Run Readiness Check, Story Intelligence: stopped at the
//                 ceiling, except a chat conversation already under way, which
//                 carries on to a small margin past it (IN_FLIGHT_MARGIN)
//   build         reading what the client uploads, and the Analyze button:
//                 counted, never stopped. Building the Inven(s)tory is what For
//                 Granted wants clients doing; its own guards are the 30 upload
//                 reads a day (lib/usage-limits.ts) and that a press reads only
//                 what is new.
//
// A step already running always finishes. The first month runs as a watch
// period: the numbers are set from real spend after it.
//
// Clients see shares and plain sentences, never dollars: the allowance is a
// fair-use line, not a bill. For Granted sees dollars.
//
// Pure, so the pages and the server agree, and it is tested without a database.
import type { Actor } from "./usage-limits";

export const ALLOWANCE = {
  /** The default monthly allowance, in cents ($20). */
  defaultCents: 2000,
  /** The hard ceiling, as a multiple of the monthly allowance, unless For Granted sets one. */
  ceilingMultiple: 2,
  /** The most For Granted can set or grant at once, in cents ($10,000). */
  maxCents: 1_000_000,
  /** Warn when this share of the allowance is used. */
  warnAt: 0.8,
} as const;

/**
 * A chat conversation already under way when the ceiling is reached carries on
 * until spend is this share past the ceiling (10%), so a question in the middle
 * of a search is answered, while a runaway loop in one conversation still stops.
 */
export const IN_FLIGHT_MARGIN = 0.1;
/** A conversation counts as under way when its last question was this recent. */
export const IN_FLIGHT_MINUTES = 30;

/** One cent in the meter's unit (millionths of a dollar). */
export const MICROS_PER_CENT = 10_000;

export interface AllowanceState {
  /** Client-caused spend this month, in millionths of a dollar. */
  spentMicros: number;
  /** The client's monthly allowance, in cents (the default unless For Granted changed it). */
  monthlyCents: number;
  /** Extra For Granted granted for this month, in cents. Raises the allowance and the ceiling alike. */
  extraCents: number;
  /** For Granted's own ceiling for this client, in cents, or null for the multiple of the allowance. */
  ceilingCents?: number | null;
}

/** The soft line: the monthly allowance plus anything granted this month. */
export const lineMicros = (s: AllowanceState) =>
  (Math.max(0, s.monthlyCents) + Math.max(0, s.extraCents)) * MICROS_PER_CENT;

/** The hard ceiling, never below the line. */
export function ceilingMicros(s: AllowanceState): number {
  const base = s.ceilingCents != null ? Math.max(0, s.ceilingCents) : Math.max(0, s.monthlyCents) * ALLOWANCE.ceilingMultiple;
  return Math.max(lineMicros(s), (base + Math.max(0, s.extraCents)) * MICROS_PER_CENT);
}

/** The share of the allowance used, 0 and up. A zero allowance with any spend counts as fully used. */
export function shareUsed(s: AllowanceState): number {
  const line = lineMicros(s);
  if (line <= 0) return s.spentMicros > 0 ? Number.POSITIVE_INFINITY : 0;
  return Math.max(0, s.spentMicros) / line;
}

export type AllowanceLevel = "fine" | "near" | "over" | "ceiling";

export function levelOf(s: AllowanceState): AllowanceLevel {
  const spent = Math.max(0, s.spentMicros);
  if (spent >= ceilingMicros(s) && (spent > 0 || ceilingMicros(s) === 0)) return "ceiling";
  const share = shareUsed(s);
  if (share >= 1) return "over";
  if (share >= ALLOWANCE.warnAt) return "near";
  return "fine";
}

export type StepKind = "interactive" | "build";

export type AllowanceDecision =
  | { ok: true; unlimited: true }
  | { ok: true; unlimited?: false; level: AllowanceLevel; warning: string | null }
  | { ok: false; level: "ceiling"; message: string; canRequest: true };

const pct = (share: number) => `${Math.min(99, Math.floor(share * 100))}%`;

export const NOTE_OVER = "Your organization is past this month's AI allowance. You can keep working: For Granted has been told and will be in touch.";
export const NOTE_CEILING_BUILD = "Your organization has reached this month's AI limit. Your documents are still read as they arrive; For Granted has been told.";
export const MESSAGE_CEILING = "Your organization has reached this month's AI limit. Ask For Granted for more and we'll add it, or it renews on the 1st.";

/**
 * May this person start a step now? `inFlight` is a chat question in a
 * conversation already under way (see IN_FLIGHT_MINUTES).
 */
export function decideAllowance(
  actor: Actor, s: AllowanceState, step: { kind: StepKind; inFlight?: boolean } = { kind: "interactive" },
): AllowanceDecision {
  if (actor === "admin") return { ok: true, unlimited: true };
  const level = levelOf(s);
  if (level === "fine") return { ok: true, level, warning: null };
  if (level === "near") return { ok: true, level, warning: `Your organization has used ${pct(shareUsed(s))} of this month's AI allowance.` };
  if (level === "over") return { ok: true, level, warning: NOTE_OVER };
  // At the ceiling.
  if (step.kind === "build") return { ok: true, level, warning: NOTE_CEILING_BUILD };
  if (step.inFlight && s.spentMicros < ceilingMicros(s) * (1 + IN_FLIGHT_MARGIN)) {
    return { ok: true, level, warning: "Your organization has reached this month's AI limit. You can finish this conversation; For Granted has been told." };
  }
  return { ok: false, level: "ceiling", message: MESSAGE_CEILING, canRequest: true };
}

/** Dollars from cents, for For Granted's pages: "$20.00". */
export const usdFromCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Parse a dollar amount For Granted typed ("20", "$12.50") into cents, or null
 * when it is not a sensible amount. Zero is allowed for a monthly allowance or
 * a ceiling, never for a grant.
 */
export function centsFromDollars(input: string | number, opts: { allowZero?: boolean } = {}): number | null {
  const n = typeof input === "number" ? input : Number(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (cents < (opts.allowZero ? 0 : 1) || cents > ALLOWANCE.maxCents) return null;
  return cents;
}
