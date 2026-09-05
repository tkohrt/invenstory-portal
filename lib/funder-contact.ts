// Program officers and grants managers: the people who actually read the letter.
//
// The base dataset's 990 officers are governance. For The George Gund
// Foundation it lists nine trustees and the president, while the six people who
// run its grantmaking appear only on the foundation's own site. Zero overlap.
// This is new information, and the thing that makes it dangerous is that it
// goes stale silently: a program officer who left eighteen months ago still
// looks like a lead unless the interface says how old the fact is.
//
// Pure and free of `server-only` so it is unit testable.

export const CONTACT_ROLES = [
  "program_officer", "grants_manager", "executive",
  "assistant", "general_inquiry", "trustee", "unknown",
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const ROLE_LABEL: Record<ContactRole, string> = {
  program_officer: "Program officer",
  grants_manager: "Grants manager",
  executive: "Executive",
  assistant: "Assistant",
  general_inquiry: "General inquiries",
  trustee: "Trustee",
  unknown: "Role unknown",
};

/** Who is worth writing to, and who is not. Drives the default ordering. */
const ROLE_RANK: Record<ContactRole, number> = {
  program_officer: 0, grants_manager: 1, executive: 2,
  general_inquiry: 3, assistant: 4, unknown: 5,
  // Governance, not an approach route. Kept for board-connection mapping
  // ("does our client's board know a trustee here"), never for a cold letter.
  trustee: 6,
};

export const SOURCE_TYPES = ["filing_990pf", "funder_site", "conversation", "other"] as const;
export type ContactSource = (typeof SOURCE_TYPES)[number];

export const SOURCE_LABEL: Record<ContactSource, string> = {
  filing_990pf: "990-PF filing",
  funder_site: "Their own site",
  conversation: "A conversation",
  other: "Elsewhere",
};

export const SOURCE_HELP: Record<ContactSource, string> = {
  filing_990pf: "The intake contact a private foundation reports on Form 990-PF. Institutional rather than personal, and as fresh as the filing, so typically a year or two behind.",
  funder_site: "Read from the funder's own team or staff page. Current when checked, and the usual place a program officer is named by portfolio.",
  conversation: "Someone told us, on a call or by email. The most valuable of these and the only one a competitor cannot look up.",
  other: "Somewhere else. The note should say where.",
};

export interface ContactRecord {
  id: string;
  ein: string;
  name: string;
  title: string | null;
  role: ContactRole;
  portfolio: string | null;
  email: string | null;
  phone: string | null;
  source_type: ContactSource;
  source_url: string | null;
  note: string | null;
  status: "active" | "departed" | "unknown";
  last_verified_at: string;
}

/** Roughly a year. Past this, a contact is shown as needing a re-check. */
export const STALE_AFTER_DAYS = 365;

export interface Freshness {
  days: number;
  stale: boolean;
  label: string;
}

/**
 * How old this fact is, said out loud.
 *
 * Displayed rather than hidden, and never silently dropped: an aging contact is
 * still the best starting point anyone has, but somebody about to send a letter
 * deserves to know it has not been checked since last spring.
 */
export function freshness(iso: string, now = new Date()): Freshness {
  const then = new Date(iso);
  if (isNaN(then.getTime())) return { days: Infinity, stale: true, label: "date unknown" };
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
  const stale = days > STALE_AFTER_DAYS;
  let label: string;
  if (days < 1) label = "checked today";
  else if (days < 30) label = `checked ${days}d ago`;
  else if (days < 365) label = `checked ${Math.round(days / 30)} months ago`;
  else label = `checked ${(days / 365).toFixed(days < 730 ? 1 : 0)} years ago`;
  return { days, stale, label };
}

/**
 * Order contacts the way somebody deciding who to write to would.
 *
 * Departed people sink rather than disappear: knowing that the person you were
 * told to contact has left is itself useful, and deleting the row loses the
 * fact that anybody ever checked.
 */
export function sortContacts(rows: ContactRecord[]): ContactRecord[] {
  return [...rows].sort((a, b) =>
    Number(a.status === "departed") - Number(b.status === "departed") ||
    ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
    (b.last_verified_at ?? "").localeCompare(a.last_verified_at ?? "") ||
    a.name.localeCompare(b.name));
}

/** The one to lead with, when a table has room for a single line. */
export function primaryContact(rows: ContactRecord[]): ContactRecord | null {
  const live = sortContacts(rows).filter(r => r.status !== "departed");
  return live[0] ?? null;
}

export interface ContactInput {
  ein: string; name: string; title?: string; role?: string; portfolio?: string;
  email?: string; phone?: string; source_type?: string; source_url?: string;
  note?: string; status?: string;
}

/**
 * Validate and normalize one contact before it is written.
 *
 * Deliberately strict about the vocabulary and forgiving about everything else:
 * a half-remembered name and a portfolio is a useful record, and demanding an
 * email would mean the call notes never get entered at all.
 */
export function buildContact(input: ContactInput, normalizeEin: (v?: string | null) => string) {
  const ein = normalizeEin(input.ein);
  if (!ein) throw new Error("A contact has to belong to a funder. Attach one first.");
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Give the person's name.");

  const role = (input.role || "unknown") as ContactRole;
  if (!(CONTACT_ROLES as readonly string[]).includes(role)) throw new Error("Pick a role from the list.");

  const source_type = (input.source_type || "funder_site") as ContactSource;
  if (!(SOURCE_TYPES as readonly string[]).includes(source_type)) throw new Error("Pick where this came from.");

  const email = (input.email ?? "").trim();
  // Not a full RFC check, just enough to catch a pasted name or phone number in
  // the wrong box, which is the realistic mistake.
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That email address does not look right.");

  const status = (input.status || "active") as ContactRecord["status"];
  if (!["active", "departed", "unknown"].includes(status)) throw new Error("Unknown status.");

  const t = (v?: string) => { const x = (v ?? "").trim(); return x ? x.slice(0, 300) : null; };
  return {
    ein, name: name.slice(0, 200), title: t(input.title), role, portfolio: t(input.portfolio),
    email: email ? email.slice(0, 200) : null, phone: t(input.phone),
    source_type, source_url: t(input.source_url), note: t(input.note), status,
  };
}
