// Following (patch 66, 18 Nov 2026): one list of what a client is tracking.
// Pure; tested in tests/funding/following.test.ts.
//
// The list is the saved bucket (patch 26) grown up: funders followed from a
// dossier, grants and accelerators starred on the Funding page, and RFPs For
// Granted adds from the RFP Engine. It is shared across the client's team.
// Each item has one switch, `updates`: whether it may raise notices. Dates
// (a deadline, a reopening) come from the items themselves, which is what a
// calendar view will be drawn from; a funder has no date of its own.

export type FollowKind = "funder" | "grant" | "rfp";

export interface FollowItem {
  kind: FollowKind;
  target_id: string;
  title: string | null;
  detail: { funder?: string | null; url?: string | null; close_date?: string | null; award_ceiling?: number | null; terms?: string | null; money_kind?: string | null };
  saved_at: string;
  reopened_at?: string | null;
  reopened_detail?: { title?: string | null; close_date?: string | null; url?: string | null } | null;
  /** Absent on rows read before migration 0099: treated as on. */
  updates?: boolean | null;
}

export type DateState = "reopened" | "closing" | "open" | "closed" | "none";

export interface FollowRow {
  kind: FollowKind; target_id: string;
  title: string; who: string | null;
  /** What it is, in the portal's words. */
  label: string;
  /** Outside link (the funder's page, the notice), http(s) only. */
  url: string | null;
  /** Inside link, when the portal has a page for it. */
  href: string | null;
  date: string | null; state: DateState; when: string;
  terms: string | null;
  updates: boolean; saved_at: string;
}

const web = (u: unknown): string | null => typeof u === "string" && /^https?:\/\//i.test(u) ? u : null;
const DAY = 86_400_000;

/**
 * The zone deadlines are read in. A timed deadline (an RFP due "5 Dec, 11:59
 * PM Eastern") is stored as an instant, and read in UTC it lands on the next
 * day: a client told "closes Dec 6" misses a bid due on the 5th (review of
 * patch 66). For Granted's clients and the procurement portals it reads keep
 * US Eastern time, so that is the calendar a timed deadline is placed on.
 */
export const DEADLINE_ZONE = "America/New_York";

/** The calendar day (year, month, day) an instant falls on in the deadline zone. */
function zoneDay(ms: number): [number, number, number] {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: DEADLINE_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const n = (t: string) => Number(p.find(x => x.type === t)?.value);
  return [n("year"), n("month"), n("day")];
}

/**
 * The calendar day a deadline means. A date with no time ("2027-03-03") IS
 * that day, wherever it is read. A timed deadline is the day it falls on in
 * the deadline zone.
 */
export function deadlineDay(date: string | null): [number, number, number] | null {
  if (!date) return null;
  const only = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (only) return [Number(only[1]), Number(only[2]), Number(only[3])];
  const t = Date.parse(date);
  return Number.isFinite(t) ? zoneDay(t) : null;
}

/** A date's standing today, and the words for it. Days are whole calendar days, today being today in the deadline zone. */
export function dateState(date: string | null, now = new Date(), reopened = false): { state: DateState; when: string } {
  const d = deadlineDay(date);
  if (!d || d.some(x => !Number.isFinite(x))) return reopened ? { state: "reopened", when: "Open again" } : { state: "none", when: "No date listed" };
  const at = Date.UTC(d[0], d[1] - 1, d[2]);
  const t = zoneDay(now.getTime());
  const days = Math.round((at - Date.UTC(t[0], t[1] - 1, t[2])) / DAY);
  const on = new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (days < 0) return { state: "closed", when: `Closed ${on}` };
  const lead = reopened ? "Open again, closes" : "Closes";
  const soon = days === 0 ? `${lead} today` : days === 1 ? `${lead} tomorrow` : days <= 14 ? `${lead} in ${days} days (${on})` : `${lead} ${on}`;
  return { state: reopened ? "reopened" : days <= 14 ? "closing" : "open", when: soon };
}

/** One saved item as the Following page shows it. */
export function followRow(s: FollowItem, now = new Date()): FollowRow {
  const d = s.detail ?? {};
  const updates = s.updates !== false;
  if (s.kind === "funder") {
    return {
      kind: "funder", target_id: s.target_id, title: s.title || "A funder", who: null, label: "Funder",
      url: web(d.url), href: `/funding/funder/${encodeURIComponent(s.target_id)}`,
      date: null, state: "none", when: "", terms: null, updates, saved_at: s.saved_at,
    };
  }
  // A reopened grant shows its new cycle: the reopen stamp carries the fresh close date and link.
  const re = s.kind === "grant" && s.reopened_at ? (s.reopened_detail ?? {}) : null;
  const date = (re?.close_date ?? d.close_date) || null;
  const { state, when } = dateState(date, now, !!re);
  return {
    kind: s.kind, target_id: s.target_id, title: re?.title || s.title || (s.kind === "rfp" ? "An RFP" : "A grant"), who: d.funder ?? null,
    label: s.kind === "rfp" ? "RFP" : d.money_kind === "programs" ? "Accelerator, prize or competition" : d.money_kind === "contracts" ? "Contract" : "Grant",
    url: web(re?.url) ?? web(d.url), href: null,
    date, state, when, terms: d.terms ?? null, updates, saved_at: s.saved_at,
  };
}

/**
 * The page's two groups. Funders by name. Opportunities by what needs
 * attention first: reopened, then by date soonest first, undated after dated,
 * closed last (most recently closed first, since those are the likeliest to
 * come round again).
 */
export function groupFollowing(items: FollowItem[], now = new Date()): { funders: FollowRow[]; opportunities: FollowRow[] } {
  const rows = items.map(s => followRow(s, now));
  const funders = rows.filter(r => r.kind === "funder").sort((a, b) => a.title.localeCompare(b.title));
  const rank: Record<DateState, number> = { reopened: 0, closing: 1, open: 1, none: 2, closed: 3 };
  const opportunities = rows.filter(r => r.kind !== "funder").sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    const num = (r: FollowRow) => { const d = deadlineDay(r.date); return d ? Date.UTC(d[0], d[1] - 1, d[2]) : null; };
    const ta = num(a), tb = num(b);
    // Dated before undated within a group, so the order never depends on which pair is compared first.
    if ((ta === null) !== (tb === null)) return ta === null ? 1 : -1;
    if (ta !== null && tb !== null && ta !== tb) return a.state === "closed" ? tb - ta : ta - tb;
    return a.title.localeCompare(b.title);
  });
  return { funders, opportunities };
}

/** The line under the page title. */
export function followingSummary(g: { funders: FollowRow[]; opportunities: FollowRow[] }): string {
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const closing = g.opportunities.filter(r => r.state === "closing").length;
  const again = g.opportunities.filter(r => r.state === "reopened").length;
  const parts = [n(g.funders.length, "funder", "funders"), n(g.opportunities.length, "opportunity", "opportunities")];
  const notes = [closing ? `${closing} closing within two weeks` : null, again ? `${again} open again` : null].filter(Boolean);
  return `${parts.join(" and ")}${notes.length ? `, ${notes.join(" and ")}` : ""}.`;
}

/** The snapshot kept for an RFP added to a client's list: enough to show it after the scan that found it is gone. */
export function rfpSnapshot(n: { title?: string | null; agency?: string | null; due_at?: string | null; due_date_only?: boolean | null; description_url?: string | null } | null): { title: string; detail: FollowItem["detail"] } {
  return {
    title: (n?.title ?? "").trim().slice(0, 400) || "An RFP",
    detail: {
      funder: n?.agency?.slice(0, 200) ?? null,
      url: typeof n?.description_url === "string" && /^https:\/\//i.test(n.description_url) ? n.description_url.slice(0, 500) : null,
      // A notice that gave a date and no time keeps just the date, so it is never shifted by a time zone.
      close_date: n?.due_at ? (n.due_date_only ? n.due_at.slice(0, 10) : n.due_at) : null, money_kind: "contracts",
    },
  };
}
