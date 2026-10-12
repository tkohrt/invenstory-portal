// The Brain (Auto-Draft build spec, section 7; 12 October 2026). Pure; tested
// in tests/drafter/brain.test.ts.
//
// The Brain is one special tenant (tenant.is_brain, 0061) holding For
// Granted's own writing and de-identified examples. It reuses upload,
// ingestion, document types and the analysis like any client, but it is not a
// client: it is left out of client lists, funder matching, the garden, the
// allowance, readiness and the Readiness Audit. Only admins open it; it never
// has client users. Auto-draft reads it from a client's draft (a later patch),
// the one cross-tenant read, annotated tenant-safe.

/** True for the Brain. Rows read before 0061 have no is_brain and are clients. */
export function isBrain(t: { is_brain?: boolean | null } | null | undefined): boolean {
  return t?.is_brain === true;
}

/** The clients only: every tenant except the Brain, order kept. */
export function clientTenants<T extends { is_brain?: boolean | null }>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(t => !isBrain(t));
}

/**
 * The pages that make sense in the Brain: its documents, asking and searching
 * them, the account page, and For Granted's own admin pages (the analysis is
 * run and read on Admin, Analysis) except the Readiness Audit, which grades a
 * client. Everything about a client's funding (eligibility, matches, the
 * plant, Story Intelligence, Story Cards for review, drafts, and the client's
 * Analyze page, which shows readiness and asks to confirm eligibility) is not.
 */
const BRAIN_OPEN = ["/invenstory", "/chat", "/search", "/account", "/admin"];
const BRAIN_CLOSED = ["/admin/readiness-audit"];

export function brainAllows(path: string): boolean {
  const under = (p: string) => path === p || path.startsWith(p + "/");
  if (BRAIN_CLOSED.some(under)) return false;
  return BRAIN_OPEN.some(under);
}

/** Why an action that belongs to a client is refused in the Brain. */
export const BRAIN_REFUSAL = "This is the Brain, For Granted's own writing, not a client. Switch to a client to do this.";
