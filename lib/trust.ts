// Trust tiers (patch 67, 19 Nov 2026): review at the point of use.
// Pure; tested in tests/funding/trust.test.ts.
//
// Until this patch every lead a source produced waited for a person before a
// client could see it, so review work grew with the number of sources. Now a
// source says whose words it carries. An opportunity from a funder's own page
// or account (or a federal agency's) goes to matched clients at once, labelled
// "Not yet reviewed by For Granted", and still waits in the queue. Everything
// from news, aggregators and newsletters waits as before. Nothing unreviewed
// joins matching, a fit report or a For Granted recommendation: those read
// approved records only, which this file does not change.

export type Trust = "first_party" | "review";

export const TRUST_LABEL: Record<Trust, string> = {
  first_party: "Publishes with a label",
  review: "Waits for review",
};
export const TRUST_WHY: Record<Trust, string> = {
  first_party: "The funder's or programme's own page or account. Its opportunities reach matched clients at once, labelled as not yet reviewed, and still come to the queue.",
  review: "News, an aggregator or a newsletter. Nothing from it reaches a client until For Granted approves it.",
};

/** The words a client sees on anything live that nobody at For Granted has checked. */
export const UNREVIEWED_LABEL = "Not yet reviewed by For Granted";
export const UNREVIEWED_WHY = "Read automatically from the funder's own page or account. For Granted has not checked it yet, so confirm the details at the source before you rely on them.";

export const isTrust = (v: unknown): v is Trust => v === "first_party" || v === "review";

/**
 * What a new source starts as. Only two kinds start as first-party: a page
 * For Granted added as a funder's or an accelerator's own, and a Bluesky
 * handle found on a funder's own website (a dossier lookup). A followed
 * Bluesky account starts in review, because following is also how news
 * accounts are added, and a person says which it is. Mail never publishes
 * unreviewed: a sender's address proves nothing about who wrote it.
 */
export function defaultTrust(s: { kind: string; category: string; origin: string }): Trust {
  if (s.kind === "email") return "review";
  if (s.category !== "funder" && s.category !== "accelerator") return "review";
  if (s.kind === "page") return s.origin === "manual" ? "first_party" : "review";
  if (s.kind === "bluesky") return s.origin === "dossier" ? "first_party" : "review";
  return "review";
}

/** A source may be set first-party only if it is a page or an account, never mail. */
export function canBeFirstParty(kind: string): boolean {
  return kind === "page" || kind === "bluesky";
}

const web = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/**
 * Whether one parsed entry may go live with the label. All of: the source is
 * first-party and not mail; the entry is an opportunity (a funder record
 * changes the shared funder profile, which stays behind review); it has a
 * title and a real link a client can check it against.
 */
export function publishes(source: { trust?: unknown; kind: string } | null | undefined, entry: { kind: string; title?: string | null; source_url?: string | null }): boolean {
  if (!source || source.trust !== "first_party" || !canBeFirstParty(source.kind)) return false;
  if (entry.kind !== "grant") return false;
  return !!entry.title?.trim() && web(entry.source_url);
}

export type Standing = "reviewed" | "unreviewed" | "hidden";

/**
 * What a client may see of a queue entry. Approved: all of it, as before.
 * Waiting and published: shown with the label. Anything else (waiting and not
 * published, rejected, superseded): nothing.
 */
export function standing(e: { status: string; published_at?: string | null }): Standing {
  if (e.status === "approved") return "reviewed";
  if ((e.status === "proposed" || e.status === "in_review") && e.published_at) return "unreviewed";
  return "hidden";
}

/** What a follower is told once For Granted has looked at an entry they kept. */
export function followStanding(e: { status: string; published_at?: string | null } | null | undefined): "unreviewed" | "withdrawn" | null {
  if (!e) return null;
  if (e.status === "rejected" || e.status === "superseded") return "withdrawn";
  return standing(e) === "unreviewed" ? "unreviewed" : null;
}
export const WITHDRAWN_LABEL = "Reviewed by For Granted and taken off its list";

// ---------------------------------------------------------------------------
// The queue, ordered by who is waiting.

export interface Demand {
  /** Clients this entry was screened as a fit for. */
  matched: number;
  /** Clients who added it to their Following list. */
  followed: number;
  /** Clients who asked For Granted to start a draft for it. */
  asked: number;
}
export const NO_DEMAND: Demand = { matched: 0, followed: 0, asked: 0 };

export type Band = "wanted" | "live" | "standard" | "quiet";
export const BAND_LABEL: Record<Band, string> = {
  wanted: "Clients are waiting on these",
  live: "Live to clients, not yet reviewed",
  standard: "Awaiting review",
  quiet: "No client match yet",
};
export const BAND_WHY: Record<Band, string> = {
  wanted: "A client asked about it or follows it, or it was screened as a fit for a client. Review these first.",
  live: "Published from a funder's own page or account. No client has it on their page yet.",
  standard: "Entered by hand, found working a client or by the web search. Reviewed as before.",
  quiet: "From a watched source, and no client it fits yet. These can wait; one moves up the moment a client matches.",
};

/**
 * Where an entry sits in the queue. Only signals entries are ever "quiet" or
 * "live": everything that came in another way (by hand, a client's web
 * search, a pasted list) is reviewed as it always was.
 */
export function band(row: { published_at?: string | null; signal_source_id?: string | null }, d: Demand = NO_DEMAND): Band {
  if (d.asked > 0 || d.followed > 0 || d.matched > 0) return "wanted";
  if (!row.signal_source_id) return "standard";
  return row.published_at ? "live" : "quiet";
}

/** Order inside "wanted": a client who asked outranks one who follows, who outranks a screen match; more clients first. */
export function demandScore(d: Demand): number {
  return d.asked * 100 + d.followed * 10 + d.matched;
}

export function demandLine(d: Demand): string | null {
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  const parts = [
    d.asked ? `${n(d.asked, "client", "clients")} asked for a draft` : null,
    d.followed ? `${n(d.followed, "client follows", "clients follow")} it` : null,
    d.matched ? `fits ${n(d.matched, "client", "clients")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** The tab's badge: what needs a person now. Entries no client is waiting on are not counted. */
export function needsReviewNow<T extends { id: string; published_at?: string | null; signal_source_id?: string | null }>(rows: T[], demand: Record<string, Demand>): number {
  return rows.filter(r => { const b = band(r, demand[r.id] ?? NO_DEMAND); return b === "wanted" || b === "standard"; }).length;
}

/** The queue as the page draws it: each band in order, most-wanted first inside "wanted", newest first elsewhere. */
export function bandQueue<T extends { id: string; created_at: string; published_at?: string | null; signal_source_id?: string | null }>(rows: T[], demand: Record<string, Demand>): { band: Band; rows: T[] }[] {
  const by: Record<Band, T[]> = { wanted: [], standard: [], live: [], quiet: [] };
  for (const r of rows) by[band(r, demand[r.id] ?? NO_DEMAND)].push(r);
  const newest = (a: T, b: T) => b.created_at.localeCompare(a.created_at);
  by.wanted.sort((a, b) => demandScore(demand[b.id] ?? NO_DEMAND) - demandScore(demand[a.id] ?? NO_DEMAND) || newest(a, b));
  by.standard.sort(newest); by.live.sort(newest); by.quiet.sort(newest);
  return (["wanted", "standard", "live", "quiet"] as Band[]).map(b => ({ band: b, rows: by[b] })).filter(g => g.rows.length);
}
