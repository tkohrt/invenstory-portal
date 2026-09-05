// Can you actually approach this funder?
//
// The single most useful thing to know about a funder, and the base dataset has
// no field for it. A shortlist where an unknown fraction of rows cannot be
// applied to at all is not a shortlist — it is a research backlog wearing one.
//
// Two rules shape everything here:
//
//  1. An INFERENCE IS NOT A FACT. The graph tool attaches a caveat to obvious
//     pass-through vehicles, and a funder_type of donor_advised_fund_sponsor is
//     a strong hint. Both are worth surfacing. Neither is someone reading the
//     funder's own page, and the interface must never present them as though
//     they were — that is precisely the confusion Ground Truth exists to end.
//
//  2. UNKNOWN IS AN HONEST ANSWER. Most funders will sit here until someone
//     checks. Guessing "open" because nothing said otherwise would be the worst
//     possible default: it is the value that sends a client to write a proposal
//     nobody will read.
//
// Pure and free of `server-only` so it is unit testable.

export const ACCESS_MODES = [
  "open", "invitation_only", "preselected_only", "rfp_cycle",
  "donor_advised", "closed", "unknown",
] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const ACCESS_LABEL: Record<AccessMode, string> = {
  open: "Open application",
  invitation_only: "Invitation only",
  preselected_only: "No unsolicited requests",
  rfp_cycle: "RFP cycle",
  donor_advised: "Donor-advised",
  closed: "Not accepting",
  unknown: "Access unknown",
};

/** What each answer means for what someone should actually do next. */
export const ACCESS_HELP: Record<AccessMode, string> = {
  open: "They accept unsolicited applications or letters of inquiry. Read their guidelines and approach directly.",
  invitation_only: "They fund only organizations they invite, and a route in exists: a relationship, or an introduction from someone they already fund. A cold application will not be read.",
  preselected_only: "They give only to organizations they have already chosen, and take no unsolicited requests. Why varies, and it changes what to do: a foundation that cultivates new grantees is worth a warm introduction, while one that exists to fund a single institution is worth skipping entirely. Worth one search before writing it off.",
  rfp_cycle: "They give through announced cycles rather than open submission. Find out when the next one opens and what it will cover before writing anything.",
  donor_advised: "Most of what they move is directed by individual donors, not by a competitive programme. Look specifically for their own discretionary or competitive funds — approaching the vehicle itself is a dead end.",
  closed: "Not accepting requests at all in the period we checked. Worth re-checking later; not worth an approach now.",
  unknown: "Nobody has established how this funder takes requests. Treat the whole row as a lead to research, not a target to write for.",
};

/** Options for the verification form, in the order a reviewer thinks in. */
export const ACCESS_OPTIONS: { v: AccessMode; l: string }[] =
  ACCESS_MODES.filter(m => m !== "unknown").map(m => ({ v: m, l: ACCESS_LABEL[m] }));

export interface AccessState {
  mode: AccessMode;
  /** True only when a person recorded it against the funder's own materials. */
  verified: boolean;
  /** The evidence: a quoted line for a verified answer, the caveat for a guess. */
  note: string | null;
}

const DAF = /donor[- ]advised|pass[- ]through|donor directed/i;
// Two different claims that were being collapsed into one. "By invitation"
// promises a route in; "does not accept unsolicited requests" only says a cold
// approach fails, and is equally true of a foundation that exists to fund one
// hospital and will never take anybody new. Saying the second and meaning the
// first sends somebody hunting for an introduction that does not exist.
const INVITE = /by invitation|invitation only|invited (?:organizations|applicants|grantees)/i;
const PRESELECTED = /does not accept unsolicited|not accept unsolicited|no unsolicited|does not solicit|preselected|pre-selected/i;
const RFP = /request for proposals?\b|\brfp\b|competitive cycle|announced cycles?/i;
const CLOSED = /not accepting|closed to (?:new )?(?:applications|requests)|suspended/i;

/**
 * Read an access mode out of prose we did not write.
 *
 * Order matters: "invitation only" is checked before donor-advised because a
 * caveat can mention both, and being told you cannot apply is the more
 * actionable half. Everything returned here is `verified: false`.
 */
export function inferAccessMode(
  caveat?: string | null, funderType?: string | null,
): AccessState | null {
  const t = (caveat ?? "").trim();
  if (t) {
    if (INVITE.test(t)) return { mode: "invitation_only", verified: false, note: t };
    if (PRESELECTED.test(t)) return { mode: "preselected_only", verified: false, note: t };
    if (CLOSED.test(t)) return { mode: "closed", verified: false, note: t };
    if (DAF.test(t)) return { mode: "donor_advised", verified: false, note: t };
    if (RFP.test(t)) return { mode: "rfp_cycle", verified: false, note: t };
  }
  if (funderType === "donor_advised_fund_sponsor") {
    return {
      mode: "donor_advised", verified: false,
      note: "Classified as a donor-advised fund sponsor in the base record.",
    };
  }
  return null;
}

/**
 * The access state of one funder.
 *
 * A recorded Ground Truth value always wins: it is the only one of these that
 * someone stood behind. Inference fills the gap, marked as a guess. Neither
 * existing is `unknown`, which is the honest majority case.
 */
export function resolveAccess(f: {
  access_mode?: string | null;
  access_note?: string | null;
  caveat?: string | null;
  funder_type?: string | null;
}): AccessState {
  const recorded = (f.access_mode ?? "").trim() as AccessMode;
  if (recorded && recorded !== "unknown" && (ACCESS_MODES as readonly string[]).includes(recorded)) {
    return { mode: recorded, verified: true, note: f.access_note?.trim() || null };
  }
  return inferAccessMode(f.caveat, f.funder_type) ?? { mode: "unknown", verified: false, note: null };
}
