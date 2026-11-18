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

/** A date's standing today, and the words for it. */
export function dateState(date: string | null, now = new Date(), reopened = false): { state: DateState; when: string } {
  const t = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(t)) return reopened ? { state: "reopened", when: "Open again" } : { state: "none", when: "No date listed" };
  // Whole calendar days (UTC), so a deadline later today is "today" and a date-only deadline is open through its own day.
  const days = Math.floor(t / DAY) - Math.floor(now.getTime() / DAY);
  const on = new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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
    const ta = a.date ? Date.parse(a.date) : NaN, tb = b.date ? Date.parse(b.date) : NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return a.state === "closed" ? tb - ta : ta - tb;
    return a.title.localeCompare(b.title);
  });
  return { funders, opportunities };
}

/** The line under the page title. */
export function followingSummary(g: { funders: FollowRow[]; opportunities: FollowRow[] }): string {
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const closing = g.opportunities.filter(r => r.state === "closing" || r.state === "reopened").length;
  const parts = [n(g.funders.length, "funder", "funders"), n(g.opportunities.length, "opportunity", "opportunities")];
  return `${parts.join(" and ")}${closing ? `, ${closing} needing attention in the next two weeks` : ""}.`;
}

/** The snapshot kept for an RFP added to a client's list: enough to show it after the scan that found it is gone. */
export function rfpSnapshot(n: { title?: string | null; agency?: string | null; due_at?: string | null; description_url?: string | null } | null): { title: string; detail: FollowItem["detail"] } {
  return {
    title: (n?.title ?? "").trim().slice(0, 400) || "An RFP",
    detail: {
      funder: n?.agency?.slice(0, 200) ?? null,
      url: typeof n?.description_url === "string" && /^https:\/\//i.test(n.description_url) ? n.description_url.slice(0, 500) : null,
      close_date: n?.due_at ?? null, money_kind: "contracts",
    },
  };
}
