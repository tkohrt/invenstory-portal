// How the grant a document holds turned out (Auto-Draft build spec, section 8;
// 12 October 2026). Pure; tested in tests/drafter/doc-outcome.test.ts.
//
// A document can carry an outcome: Won, Not funded, Pending or Unknown, or
// none at all (most documents are not grant applications). The "winning grant"
// tag is simply outcome = won; there is no separate tag. It can be set at
// upload for a past grant application and changed later on any document.
// Auto-draft's voice profile (patch 4) weighs winning sources more, and also
// counts drafts in the portal marked Won.

export type Outcome = "won" | "not_funded" | "pending" | "unknown";

export const OUTCOMES: { key: Outcome; label: string; describe: string }[] = [
  { key: "won", label: "Won", describe: "Funded. Counts as a winning grant." },
  { key: "not_funded", label: "Not funded", describe: "Submitted and turned down." },
  { key: "pending", label: "Pending", describe: "Submitted; no decision yet." },
  { key: "unknown", label: "Unknown", describe: "Submitted, but the result is not known." },
];

export const OUTCOME_LABEL: Record<Outcome, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.label])) as Record<Outcome, string>;

/** The outcome from untrusted input, or null for none. Anything unrecognised is none. */
export function parseOutcome(v: unknown): Outcome | null {
  return typeof v === "string" && Object.hasOwn(OUTCOME_LABEL, v) ? (v as Outcome) : null;
}

/** A winning grant: a document whose outcome is Won. */
export function isWinning(d: { outcome?: string | null }): boolean {
  return d.outcome === "won";
}

/** The document type whose upload asks for an outcome. Any document can be given one later. */
export const OUTCOME_AT_UPLOAD_TYPE = "past_application";

/** Whether the upload form asks for an outcome, given the type picked. */
export function asksOutcomeAtUpload(typeTag: string | null | undefined): boolean {
  return typeTag === OUTCOME_AT_UPLOAD_TYPE;
}

/**
 * Why this person may not change this document's outcome, or null if they may.
 * For Granted may change any outcome. A client may change its own documents'
 * outcomes, but not one For Granted set (the same rule as document types).
 */
export function outcomeChangeRefusal(input: {
  role: "admin" | "client";
  userId: string;
  setBy: string | null;
  setByRole: "admin" | "client" | null;
}): string | null {
  if (input.role === "admin") return null;
  if (input.setBy && input.setBy !== input.userId && input.setByRole === "admin") {
    return "For Granted set this document's outcome. Ask For Granted to change it.";
  }
  return null;
}
