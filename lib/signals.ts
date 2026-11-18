// Signals (patch 64, 18 Nov 2026): the rules for the recurring sources For
// Granted watches. Pure; tested in tests/funding/signals.test.ts.
//
// A source is somewhere funding news appears on its own schedule: a page that
// changes, a newsletter, a Bluesky account. A signal is one thing a source
// produced. The point of the registry is robustness: every source is owned by
// For Granted's own list, verified against the funder's own page, and visibly
// healthy or not, so no aggregator going dark can take the pipeline with it.

export type SourceKind = "page" | "bluesky" | "email";
export type SourceCategory = "funder" | "accelerator" | "rfp" | "aggregator";
export type SourceOrigin = "manual" | "dossier" | "follows" | "inbox";
export type SignalStatus = "new" | "filed" | "nothing" | "skipped" | "held" | "failed";

export const KIND_LABEL: Record<SourceKind, string> = { page: "Watched page", bluesky: "Bluesky account", email: "Newsletter sender" };
export const CATEGORY_LABEL: Record<SourceCategory, string> = { funder: "Funder", accelerator: "Accelerator", rfp: "RFPs and procurement", aggregator: "Aggregator or sector news" };
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as SourceCategory[];
export const STATUS_LABEL: Record<SignalStatus, string> = {
  new: "Not read yet", filed: "Entries sent to review", nothing: "Read: no opportunities in it",
  skipped: "Not funding news", held: "Held: sender not approved", failed: "Could not be read",
};

export interface SourceRow {
  id: string; kind: SourceKind; address: string; label: string; category: SourceCategory;
  active: boolean; origin: SourceOrigin; funder_key: string | null;
  last_checked_at: string | null; last_ok_at: string | null; last_error: string | null;
  last_hash: string | null; last_changed_at: string | null; last_signal_at: string | null;
  created_at: string;
}

export interface SignalRow {
  id: string; source_id: string; external_id: string; seen_at: string;
  title: string | null; excerpt: string | null; url: string | null;
  status: SignalStatus; curated_list_id: string | null; entries: number; note: string | null;
}

/**
 * A source's address in the one form it is stored and matched in. Null when
 * what was typed is not an address of that kind.
 */
export function normalizeAddress(kind: SourceKind, raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (kind === "page") {
    try {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(u.hostname)) return null;
      u.hash = "";
      return u.href.length <= 1000 ? u.href : null;
    } catch { return null; }
  }
  if (kind === "bluesky") {
    const h = t.replace(/^https?:\/\/bsky\.app\/profile\//i, "").replace(/^@/, "").replace(/\/.*$/, "").toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(h) && h.length <= 253 ? h : null;
  }
  const m = t.match(/<?([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})>?\s*$/i);
  return m ? m[1].toLowerCase() : null;
}

/** "Jane Roe <news@fund.org>" → who it is from. */
export function emailSender(from: string): { address: string; name: string } | null {
  const address = normalizeAddress("email", from);
  if (!address) return null;
  const name = (from ?? "").replace(/<[^>]*>\s*$/, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  return { address, name: name && !name.includes("@") ? name.slice(0, 120) : address.split("@")[1] };
}

/**
 * A page's text in the form its fingerprint is taken from: the things that
 * change on every load without the page having changed (clock times, "3 days
 * ago", a copyright year, runs of whitespace) are flattened, so a weekly
 * re-read flags a page only when its content moved.
 */
export function textForFingerprint(text: string): string {
  return (text ?? "").toLowerCase()
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/g, " ")
    .replace(/\b\d+\s+(second|minute|hour|day|week|month)s?\s+ago\b/g, " ")
    .replace(/(©|\(c\)|copyright)\s*\d{4}(\s*[-–]\s*\d{4})?/g, " ")
    .replace(/\s+/g, " ").trim();
}

const FUNDING = /\b(grants?|grantmaking|rfps?|rfa|nofo|request for (proposals?|applications?|qualifications)|funding (opportunit|round|available|announcement)|call for (proposals|applications|entries)|applications? (are |is |now )?(open|due|close)|apply (now|by|today)|deadline|letters? of (inquiry|intent)|loi\b|fellowships?|accelerator|cohort|prize|awards? (up to|of \$)|solicitation|bid(s|ding)?\b|invest(s|ing|ment)? (up to|\$))/i;

/** Does this read like funding news at all? The cheap gate before a model call. */
export function looksLikeFunding(text: string): boolean {
  return FUNDING.test(text ?? "");
}

/** The first web links in a body of text, for a person to click (a newsletter's confirmation link). */
export function linksIn(text: string, max = 8): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const u = m[0].replace(/[.,;:!?]+$/, "");
    if (u.length <= 500 && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

export const PAGE_EVERY_DAYS = 6;
export const QUIET_AFTER_DAYS = 45;

const daysSince = (iso: string | null, now: Date) => iso ? (now.getTime() - Date.parse(iso)) / 86_400_000 : Infinity;

/** Is a watched page due for its weekly re-read? */
export function pageDue(s: Pick<SourceRow, "active" | "kind" | "last_checked_at">, now = new Date()): boolean {
  return s.kind === "page" && s.active && daysSince(s.last_checked_at, now) >= PAGE_EVERY_DAYS;
}

export type Health = "off" | "new" | "failing" | "quiet" | "ok";
export const HEALTH_LABEL: Record<Health, string> = { off: "Off", new: "Not read yet", failing: "Failing", quiet: "Gone quiet", ok: "Healthy" };

/**
 * How a source is doing, with the reason in words. Failing: the last attempt
 * did not get an answer. Quiet: it answers, but has produced nothing for 45
 * days (a newsletter that stopped, an account that went silent, a page that
 * never changes), which is the cue to check it by hand or drop it.
 */
export function sourceHealth(s: SourceRow, now = new Date()): { state: Health; why: string } {
  if (!s.active) return { state: "off", why: s.kind === "email" && s.origin === "inbox" && !s.last_ok_at ? "A new sender, waiting for approval." : "Turned off; kept but not read." };
  if (s.kind !== "email" && !s.last_checked_at) return { state: "new", why: "Will be read on the next run." };
  if (s.kind !== "email" && s.last_checked_at && (!s.last_ok_at || Date.parse(s.last_ok_at) < Date.parse(s.last_checked_at))) {
    return { state: "failing", why: s.last_error || "The last read did not get an answer." };
  }
  const produced = s.last_signal_at ?? (s.kind === "page" ? s.last_changed_at : null);
  const since = daysSince(produced ?? s.created_at, now);
  if (since > QUIET_AFTER_DAYS) {
    return { state: "quiet", why: produced ? `Nothing new for ${Math.floor(since)} days.` : `Nothing yet, ${Math.floor(since)} days after it was added.` };
  }
  return { state: "ok", why: produced ? `Last produced something ${Math.max(0, Math.floor(daysSince(produced, now)))} days ago.` : "Answering; nothing new yet." };
}

/** The rolling list a week's signal entries are filed under, so one sweep covers the week. */
export function weekListName(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return `Signals, week of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

/**
 * Is a webhook's timestamp fresh? Deliveries more than five minutes off are
 * refused, so a captured request cannot be replayed later.
 */
export function freshTimestamp(ts: string, nowSec: number): boolean {
  const t = Number(ts);
  return Number.isFinite(t) && /^\d{9,11}$/.test(ts) && Math.abs(nowSec - t) <= 300;
}

// ---------------------------------------------------------------------------
// Bluesky (patch 65). Read through Bluesky's public directory: no sign-in, no
// key, and nothing For Granted's account has to do. Following an account from
// @forgranted.com is how a person adds one; the portal never follows anyone.

export const BLUESKY_EVERY_DAYS = 2.5;
export const BLUESKY_FIRST_READ_DAYS = 14;

export function blueskyDue(s: Pick<SourceRow, "active" | "kind" | "last_checked_at">, now = new Date()): boolean {
  return s.kind === "bluesky" && s.active && daysSince(s.last_checked_at, now) >= BLUESKY_EVERY_DAYS;
}

export interface PostSignal { uri: string; postUrl: string; text: string; at: string; link: string | null }

/**
 * One item of an account's feed as a possible signal: the account's OWN new
 * post. A repost is someone else's words, and a reply is a conversation;
 * neither is the account announcing something. The link is the page the post
 * points at (its link card first, else the first address in its text), which
 * is what gets read: a post is a tip, the page is the record.
 */
export function postSignal(item: unknown, handle: string, since: Date): PostSignal | null {
  const it = item as { reason?: unknown; reply?: unknown; post?: { uri?: unknown; author?: { handle?: unknown }; record?: { text?: unknown; createdAt?: unknown; reply?: unknown; facets?: unknown }; embed?: unknown } } | null;
  const post = it?.post;
  if (!post || it?.reason || it?.reply || post.record?.reply) return null;
  if (typeof post.uri !== "string" || typeof post.record?.createdAt !== "string") return null;
  if (typeof post.author?.handle === "string" && post.author.handle.toLowerCase() !== handle.toLowerCase()) return null;
  const at = Date.parse(post.record.createdAt);
  if (!Number.isFinite(at) || at <= since.getTime()) return null;
  const text = typeof post.record.text === "string" ? post.record.text : "";
  const rkey = post.uri.split("/").pop() ?? "";
  if (!/^[a-z0-9]{6,20}$/i.test(rkey)) return null;
  const embed = post.embed as { external?: { uri?: unknown }; media?: { external?: { uri?: unknown } } } | undefined;
  const card = embed?.external?.uri ?? embed?.media?.external?.uri;
  let link: string | null = typeof card === "string" && /^https?:\/\//i.test(card) ? card : null;
  if (!link && Array.isArray(post.record.facets)) {
    for (const f of post.record.facets as { features?: { uri?: unknown }[] }[]) {
      const u = f?.features?.find(x => typeof x?.uri === "string" && /^https?:\/\//i.test(x.uri as string))?.uri;
      if (typeof u === "string") { link = u; break; }
    }
  }
  if (!link) link = linksIn(text, 1)[0] ?? null;
  // A link back into Bluesky is another post, not a page to read.
  if (link && /^https?:\/\/(bsky\.app|[a-z0-9.-]*bsky\.social)\//i.test(link)) link = null;
  return { uri: post.uri, postUrl: `https://bsky.app/profile/${handle}/post/${rkey}`, text: text.slice(0, 2000), at: new Date(at).toISOString(), link: link ? link.slice(0, 1000) : null };
}

/**
 * Accounts worth following from @forgranted.com: Bluesky sources the portal
 * reads that the account does not follow yet (found on a funder's dossier, or
 * added by hand). A list for a person to act on; following stays a human act.
 */
export function suggestedFollows(sources: SourceRow[]): SourceRow[] {
  return sources.filter(s => s.kind === "bluesky" && s.active && s.origin !== "follows")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
