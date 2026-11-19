import "server-only";
// Signals (patch 64): reading the sources For Granted watches and filing what
// they produce into the Ground Truth review queue. Rules in lib/signals.ts.
//
// signal_source and signal are For Granted's own shared records (no
// tenant_id, admin-only by RLS); nothing here reads or writes a client's data.
// Everything a source produces is untrusted text: it is only ever parsed by
// the curated-list parser (which carries the untrusted-material rule) into
// proposals a person reviews. Nothing here acts on what a page or email says.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { readUrl, readHtml, Plain } from "./read-url";
import { parseListText, fileLeads } from "./curated";
import { htmlToText } from "@/lib/application-text";
import { urlKey } from "@/lib/web-discovery";
import { defaultTrust, canBeFirstParty, scorecard, demotedNote, type Trust, type Decision, type Scorecard } from "@/lib/trust";
import {
  textForFingerprint, looksLikeFunding, linksIn, pageDue, weekListName, emailSender, freshTimestamp, normalizeAddress,
  blueskyDue, postSignal, BLUESKY_FIRST_READ_DAYS, inlineLinks, entryUrl, MAX_PENDING_SENDERS,
  type SourceRow, type SignalRow, type SignalStatus, type SourceKind, type SourceCategory, type SourceOrigin,
} from "@/lib/signals";

/** How many model calls one run may spend. Shared across everything the run reads. */
export interface Budget { parses: number; stopAt: number }

const BASE_COLS = "id, kind, address, label, category, active, origin, funder_key, last_checked_at, last_ok_at, last_error, last_hash, last_changed_at, last_signal_at, created_at";
// `trust` arrives with migration 0100 (patch 67).
const SOURCE_COLS = `${BASE_COLS}, trust`;
// The scorecard's columns arrive with migration 0102 (patch 69).
const SCORED_COLS = `${SOURCE_COLS}, trust_set_at, demoted_at, demoted_note`;
const lacksScore = (e: { message: string } | null) => !!e && /trust_set_at|demoted_at|demoted_note/i.test(e.message);

type Read<T> = { data: T | null; error: { message: string; code?: string } | null };
/** True when a read failed only because migration 0100 has not been applied. */
const lacksTrust = (e: { message: string } | null) => !!e && /\btrust\b/i.test(e.message);
/**
 * Read sources with their trust tier; before migration 0100 the column is not
 * there, and the read is made again without it. Every source then counts as
 * "review", so a deploy ahead of the migration publishes nothing unreviewed
 * and breaks no run.
 */
async function withTrust<T>(read: (cols: string) => PromiseLike<Read<T>>): Promise<Read<T>> {
  let r = await read(SCORED_COLS);
  if (lacksScore(r.error)) r = await read(SOURCE_COLS);
  return lacksTrust(r.error) ? read(BASE_COLS) : r;
}

export async function listSources(): Promise<SourceRow[]> {
  const { data, error } = await withTrust<SourceRow[]>(cols => db.from("signal_source").select(cols).order("kind").order("label").limit(500) as unknown as PromiseLike<Read<SourceRow[]>>);
  // Thrown, not swallowed: an empty list must mean "nothing watched", never "migration 0098 missing".
  if (error) throw new Error(`signal_source could not be read: ${error.message}`);
  return data ?? [];
}

/** Every ACTIVE source of one kind, asked for directly, so no flood of another kind can crowd it out of a run. */
export async function activeSources(kind: SourceKind): Promise<SourceRow[]> {
  const { data, error } = await withTrust<SourceRow[]>(cols => db.from("signal_source").select(cols).eq("kind", kind).eq("active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true }).limit(1000) as unknown as PromiseLike<Read<SourceRow[]>>);
  if (error) throw new Error(`signal_source could not be read: ${error.message}`);
  return data ?? [];
}

/**
 * A source's record and, when it has earned it, its demotion (patch 69).
 * Called after a rejection. A first-party source with SCORE_REJECTS
 * rejections among its last SCORE_WINDOW decided opportunities (counting
 * only decisions since a person last chose its tier) goes back to waiting
 * for review, with the reason on its row and in the audit log. Entries it
 * already published are not touched: each is still a person's to decide.
 * Returns the note when it demoted. Never throws: the rejection that
 * triggered it has already landed.
 */
export async function scoreSource(sourceId: string, actorId: string | null): Promise<string | null> {
  try {
    const src = await sourceById(sourceId);
    if (!src || src.trust !== "first_party") return null;
    // tenant-safe: the shared review queue (no tenant_id), one source's decided opportunities.
    const { data, error } = await db.from("ledger_overlay").select("status, reviewed_at")
      .eq("signal_source_id", sourceId).eq("kind", "grant").in("status", ["approved", "rejected"])
      .order("reviewed_at", { ascending: false }).limit(60);
    if (error) return null;
    const card = scorecard((data ?? []) as Decision[], src.trust_set_at ?? null);
    if (!card.demote) return null;
    const note = demotedNote(card);
    const { error: upErr } = await db.from("signal_source").update({ trust: "review", demoted_at: new Date().toISOString(), demoted_note: note }).eq("id", sourceId).eq("trust", "first_party");
    if (upErr) { console.error("[signals] source not demoted", upErr.message); return null; }
    await db.from("audit_log").insert({ actor_user_id: actorId, tenant_id: null, action: "source_demoted", detail: `${src.label.slice(0, 120)}: ${note}` });
    return note;
  } catch (e) { console.error("[signals] scorecard failed", e); return null; }
}

/** Every source's record, by source id, for the Sources tab (patch 69). */
export async function sourceScorecards(sources: SourceRow[]): Promise<Record<string, Scorecard>> {
  const out: Record<string, Scorecard> = {};
  // tenant-safe: the shared review queue (no tenant_id), decided opportunities that came from a source.
  const { data, error } = await db.from("ledger_overlay").select("signal_source_id, status, reviewed_at")
    .not("signal_source_id", "is", null).eq("kind", "grant").in("status", ["approved", "rejected"])
    .order("reviewed_at", { ascending: false }).limit(3000);
  if (error) return out;
  const by = new Map<string, Decision[]>();
  for (const r of (data ?? []) as (Decision & { signal_source_id: string })[]) by.set(r.signal_source_id, [...(by.get(r.signal_source_id) ?? []), r]);
  for (const s of sources) out[s.id] = scorecard(by.get(s.id) ?? [], s.trust_set_at ?? null);
  return out;
}

/** One source by id, with its trust tier when the column exists. */
export async function sourceById(id: string): Promise<SourceRow | null> {
  const { data } = await withTrust<SourceRow>(cols => db.from("signal_source").select(cols).eq("id", id).maybeSingle() as unknown as PromiseLike<Read<SourceRow>>);
  return data ?? null;
}

/** Mail held for an unapproved sender, asked for on its own so it never scrolls out of reach behind newer signals. */
export async function heldSignals(limit = 60): Promise<(SignalRow & { source_label: string; source_kind: SourceKind })[]> {
  const { data } = await db.from("signal")
    .select("id, source_id, external_id, seen_at, title, excerpt, url, status, curated_list_id, entries, note, signal_source(label, kind)")
    .eq("status", "held").order("seen_at", { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as (SignalRow & { signal_source: { label: string; kind: SourceKind } | null })[])
    .map(({ signal_source, ...r }) => ({ ...r, source_label: signal_source?.label ?? "", source_kind: signal_source?.kind ?? "email" }));
}

export async function recentSignals(limit = 40): Promise<(SignalRow & { source_label: string; source_kind: SourceKind })[]> {
  const { data } = await db.from("signal")
    .select("id, source_id, external_id, seen_at, title, excerpt, url, status, curated_list_id, entries, note, signal_source(label, kind)")
    .order("seen_at", { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as (SignalRow & { signal_source: { label: string; kind: SourceKind } | null })[])
    .map(({ signal_source, ...r }) => ({ ...r, source_label: signal_source?.label ?? "", source_kind: signal_source?.kind ?? "page" }));
}

/** Add a source, or return the one already on file at that address. */
export async function upsertSource(a: {
  kind: SourceKind; address: string; label: string; category?: SourceCategory; origin?: SourceOrigin;
  active?: boolean; funderKey?: string | null; userId?: string | null;
  /** Whose words it carries. Left out, a new source starts where lib/trust.ts defaultTrust puts it. */
  trust?: Trust;
}): Promise<{ ok: true; source: SourceRow; created: boolean } | { ok: false; error: string }> {
  const address = normalizeAddress(a.kind, a.address);
  if (!address) return { ok: false, error: a.kind === "page" ? "That is not a web address." : a.kind === "bluesky" ? "That is not a Bluesky handle (for example kresge.org or name.bsky.social)." : "That is not an email address." };
  const { data: existing } = await withTrust<SourceRow>(cols => db.from("signal_source").select(cols).eq("kind", a.kind).eq("address", address).maybeSingle() as unknown as PromiseLike<Read<SourceRow>>);
  if (existing) return { ok: true, source: existing, created: false };
  const row = {
    kind: a.kind, address, label: (a.label.trim() || address).slice(0, 200), category: a.category ?? "funder",
    origin: a.origin ?? "manual", active: a.active ?? true, funder_key: a.funderKey ?? null, created_by: a.userId ?? null,
  };
  const wanted = a.trust ?? defaultTrust(row);
  const trust: Trust = wanted === "first_party" && canBeFirstParty(a.kind) ? "first_party" : "review";
  let { data, error } = await db.from("signal_source").insert({ ...row, trust }).select(SOURCE_COLS).single() as unknown as Read<SourceRow>;
  // Before migration 0100: saved without a tier, which reads as "review".
  if (lacksTrust(error)) ({ data, error } = await db.from("signal_source").insert(row).select(BASE_COLS).single() as unknown as Read<SourceRow>);
  if (error || !data) {
    console.error("[signals] source not saved", error?.message);
    return { ok: false, error: "The source could not be saved. Has migration 0098 been applied?" };
  }
  return { ok: true, source: data, created: true };
}

/** The rolling list this week's signal entries are filed under: one sweep covers the week. */
async function weekList(): Promise<string | null> {
  const name = weekListName();
  // tenant-safe: curated_list is For Granted's shared, admin-only record with no tenant_id.
  const { data: found } = await db.from("curated_list").select("id").eq("name", name).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (found) return (found as { id: string }).id;
  // tenant-safe: curated_list is For Granted's shared, admin-only record with no tenant_id.
  const { data, error } = await db.from("curated_list").insert({
    name, source_url: null,
    // No note: a signals list is many unrelated sources, and a generic line
    // here would be shown to clients in place of a pasted list's real context.
    context_note: null,
    created_by: null,
  }).select("id").single();
  if (error || !data) { console.error("[signals] week list not created", error?.message); return null; }
  return (data as { id: string }).id;
}

/** What became of a signal. "unsettled" statuses mean it is not finished and must be seen again. */
export type Outcome = { status: SignalStatus; entries: number };
const UNSETTLED: SignalStatus[] = ["new", "reading", "failed"];
export const unsettled = (o: Outcome | null) => !!o && UNSETTLED.includes(o.status);

/**
 * Record one thing a source produced and, when it reads like funding news and
 * the budget allows, parse it into review-queue entries. Returns null only
 * when this exact signal was already recorded AND finished (the unique key is
 * the dedupe); a signal that could not be recorded comes back "failed", so a
 * caller never mistakes a lost write for work done.
 */
export async function fileSignal(a: {
  source: SourceRow; externalId: string; title: string; text: string; url: string | null;
  budget: Budget; hold?: boolean; note?: string | null;
  /** Record it without parsing: there is nothing in it to read (a post with no page behind it). */
  skip?: boolean;
}): Promise<Outcome | null> {
  const base = {
    source_id: a.source.id, external_id: a.externalId.slice(0, 400), title: a.title.slice(0, 300),
    excerpt: a.text.replace(/\s+/g, " ").trim().slice(0, 600), url: a.url?.slice(0, 1000) ?? null, note: a.note?.slice(0, 4000) ?? null,
  };
  const { data: row, error } = await db.from("signal").insert({ ...base, status: a.hold ? "held" : a.skip ? "skipped" : "new" }).select("id").single();
  if (error || !row) {
    if (!error || error.code !== "23505") { console.error("[signals] signal not recorded", error?.message); return { status: "failed", entries: 0 }; }
    // Already recorded. One left unread (the budget ran out, or the parser
    // was unavailable) is finished now; anything else is simply a repeat.
    const { data: prior } = await db.from("signal").select("id, status").eq("source_id", a.source.id).eq("external_id", base.external_id).maybeSingle();
    const p = prior as { id: string; status: SignalStatus } | null;
    if (!p || a.hold || a.skip || !UNSETTLED.includes(p.status)) return null;
    return readSignal(p.id, a.text, a.budget, a.url, a.source);
  }
  const id = (row as { id: string }).id;
  if (a.hold) return { status: "held", entries: 0 };
  if (a.skip) return { status: "skipped", entries: 0 };
  const done = await readSignal(id, a.text, a.budget, a.url, a.source);
  if (!unsettled(done)) await db.from("signal_source").update({ last_signal_at: new Date().toISOString() }).eq("id", a.source.id);
  return done;
}

const CLAIM_STALE_MS = 15 * 60_000;

/**
 * Parse a recorded signal's text and settle its status. One reader at a time:
 * the signal is claimed ("reading") before the model is called, so a
 * redelivered webhook, a Read now pressed during the run, or two runs
 * overlapping cannot parse it twice. A claim older than fifteen minutes is a
 * reader that died and may be taken over. "new" back means the budget ran
 * out, "reading" that someone else has it; either way the next run finishes it.
 * `from` is the source it came from (patch 67): its entries are filed under
 * it, and its trust tier decides whether an opportunity goes live with the
 * "not yet reviewed" label or waits (lib/trust.ts publishes).
 */
export async function readSignal(signalId: string, text: string, budget: Budget, sourceUrl: string | null = null, from: (Pick<SourceRow, "id" | "kind" | "trust"> & { label?: string | null }) | null = null): Promise<Outcome> {
  const settle = async (status: SignalStatus, entries = 0, listId: string | null = null) => {
    await db.from("signal").update({ status, entries, curated_list_id: listId }).eq("id", signalId);
    return { status, entries };
  };
  if (!looksLikeFunding(text)) return settle("skipped");
  if (budget.parses <= 0 || Date.now() > budget.stopAt) return { status: "new", entries: 0 };
  const stale = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const { data: claimed } = await db.from("signal").update({ status: "reading", claimed_at: new Date().toISOString() })
    .eq("id", signalId).or(`status.in.(new,failed),and(status.eq.reading,claimed_at.lt."${stale}")`).select("id");
  if (!claimed?.length) return { status: "reading", entries: 0 };
  budget.parses -= 1;
  const parsed = await parseListText(text, sourceUrl);
  if (!parsed.ok) return parsed.reason === "empty" ? settle("nothing") : settle("failed");
  // Each entry points where the text really points, or at the page it was read from (lib/signals.ts entryUrl).
  const leads = parsed.leads.map(l => {
    const url = entryUrl(l, text, sourceUrl);
    return { ...l, url, url_key: (url && urlKey(url)) || l.url_key };
  });
  const listId = await weekList();
  if (!listId) return settle("failed");
  // Counted as what was NEW to the review queue, so "sent to review" is never said of entries already known.
  const fresh = await fileLeads(listId, leads, null, from);
  return fresh ? settle("filed", fresh, listId) : settle("nothing");
}

/**
 * Read a page keeping where its links point (each address written after its
 * words), so an opportunity can be filed with its own link. Also returns the
 * page's plain text, which is what the change fingerprint is taken from:
 * link addresses carry tracking codes that change without the page changing.
 * Anything that is not HTML (a PDF) is read as plain text.
 */
async function readPage(url: string, instead: string): Promise<{ text: string; plain: string; url: string }> {
  try {
    const page = await readHtml(url, instead);
    const plain = htmlToText(page.html);
    if (plain.split(/\s+/).length < 40) throw new Plain(`That page has almost no readable text (it may be built in JavaScript). ${instead}`);
    return { text: htmlToText(inlineLinks(page.html, page.url)), plain, url: page.url };
  } catch (e) {
    if (!(e instanceof Plain) || !/not a web page/i.test(e.message)) throw e;
    const doc = await readUrl(url, instead);
    return { text: doc.text, plain: doc.text, url: doc.url };
  }
}

/** Re-read one watched page; file a signal when its content has changed. */
export async function checkPage(s: SourceRow, budget: Budget): Promise<{ changed: boolean; status?: SignalStatus; entries?: number; error?: string }> {
  const now = new Date().toISOString();
  let page: { text: string; plain: string; url: string };
  try {
    page = await readPage(s.address, "It will be tried again on the next run.");
  } catch (e) {
    const msg = e instanceof Plain ? e.message.replace(/ It will be tried again on the next run\.$/, "") : "The page could not be read.";
    await db.from("signal_source").update({ last_checked_at: now, last_error: msg.slice(0, 300) }).eq("id", s.id);
    return { changed: false, error: msg };
  }
  const hash = createHash("sha256").update(textForFingerprint(page.plain)).digest("hex");
  if (hash === s.last_hash) {
    await db.from("signal_source").update({ last_checked_at: now, last_ok_at: now, last_error: null }).eq("id", s.id);
    return { changed: false };
  }
  const r = await fileSignal({ source: s, externalId: hash, title: s.label, text: page.text.slice(0, 20_000), url: page.url, budget });
  // The fingerprint moves only once the change was dealt with: when the budget
  // ran out or the parser was unavailable ("new", "failed"), the next read
  // sees the same change again and the recorded signal is finished then.
  const settled = !unsettled(r);
  await db.from("signal_source").update({
    last_checked_at: now, last_ok_at: now, last_error: null,
    ...(settled ? { last_hash: hash, last_changed_at: now } : {}),
  }).eq("id", s.id);
  return { changed: true, status: r?.status, entries: r?.entries };
}

/** The weekly page watch: every active page that is due, oldest check first. */
export async function runPageWatch(budget: Budget): Promise<{ checked: number; changed: number; filed: number; failed: number }> {
  const due = (await activeSources("page")).filter(s => pageDue(s));
  const out = { checked: 0, changed: 0, filed: 0, failed: 0 };
  for (const s of due) {
    if (Date.now() > budget.stopAt) { console.error(`[signals] page watch stopped early; ${due.length - out.checked} page(s) wait for the next run`); break; }
    const r = await checkPage(s, budget);
    out.checked += 1;
    if (r.error) out.failed += 1;
    if (r.changed) out.changed += 1;
    if (r.status === "filed") out.filed += r.entries ?? 0;
  }
  return out;
}

/** Approved senders' mail left unread (the budget ran out, the parser was unavailable, or a reader died mid-read), for the next run to finish. */
export async function pendingEmail(limit = 20): Promise<string[]> {
  const stale = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const { data } = await db.from("signal").select("id, signal_source!inner(kind, active)")
    .or(`status.in.(new,failed),and(status.eq.reading,claimed_at.lt."${stale}")`)
    .eq("signal_source.kind", "email").eq("signal_source.active", true)
    .gte("seen_at", new Date(Date.now() - 14 * 86_400_000).toISOString()).order("seen_at", { ascending: true }).limit(limit);
  return ((data ?? []) as { id: string }[]).map(r => r.id);
}

// ---------------------------------------------------------------------------
// Bluesky (patch 65): the public directory, read without signing in.

const BSKY = "https://public.api.bsky.app/xrpc/";
/** The For Granted account whose follows are the human-curated source list. */
const bskyAccount = () => normalizeAddress("bluesky", process.env.BLUESKY_ACCOUNT || "forgranted.com") ?? "forgranted.com";

async function bsky(method: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BSKY}${method}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!res.ok) { console.error("[signals] bluesky", method, res.status); return null; }
    return await res.json() as Record<string, unknown>;
  } catch (e) {
    console.error("[signals] bluesky", method, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Make every account @forgranted.com follows a source. Following an account
 * on Bluesky is how a person adds one; nothing is ever unfollowed or removed
 * from here (a source dropped from the follows stays until turned off).
 */
export async function syncFollows(): Promise<{ follows: number; added: number } | null> {
  const handles: { handle: string; name: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = await bsky("app.bsky.graph.getFollows", { actor: bskyAccount(), limit: "100", ...(cursor ? { cursor } : {}) });
    // A later page that fails still leaves the earlier pages worth bringing in.
    if (!r) { if (page === 0) return null; break; }
    for (const f of (Array.isArray(r.follows) ? r.follows : []) as { handle?: unknown; displayName?: unknown }[]) {
      const h = typeof f.handle === "string" ? normalizeAddress("bluesky", f.handle) : null;
      // Bluesky's own account is followed by default on every new account; it is not a funding source.
      if (h && h !== "bsky.app") handles.push({ handle: h, name: typeof f.displayName === "string" && f.displayName.trim() ? f.displayName.trim() : h });
    }
    cursor = typeof r.cursor === "string" ? r.cursor : undefined;
    if (!cursor) break;
  }
  let added = 0;
  for (const f of handles) {
    const r = await upsertSource({ kind: "bluesky", address: f.handle, label: f.name, origin: "follows" });
    if (!r.ok) continue;
    if (r.created) added += 1;
    // Found earlier on a dossier or added by hand, and followed since: it is no longer a suggestion.
    else if (r.source.origin !== "follows") await db.from("signal_source").update({ origin: "follows" }).eq("id", r.source.id);
  }
  return { follows: handles.length, added };
}

const MAX_POSTS_PER_ACCOUNT = 5;

/**
 * Read one account's new posts. A post that reads like funding news and
 * points at a page has that PAGE read and parsed (the post is the tip, the
 * funder's page is the record). One with no page behind it is recorded and
 * not parsed. Everything else is not recorded at all.
 */
export async function checkBluesky(s: SourceRow, budget: Budget): Promise<{ ok: boolean; kept: number; filed: number; error?: string }> {
  const now = new Date();
  const r = await bsky("app.bsky.feed.getAuthorFeed", { actor: s.address, limit: "30", filter: "posts_no_replies" });
  if (!r) {
    const msg = "Bluesky did not answer for this account (it may have been renamed or removed).";
    await db.from("signal_source").update({ last_checked_at: now.toISOString(), last_error: msg }).eq("id", s.id);
    return { ok: false, kept: 0, filed: 0, error: msg };
  }
  // For an account, last_hash holds "read up to": the time of the last run in
  // which everything seen was dealt with. First read: the last two weeks.
  const upTo = s.last_hash ? Date.parse(s.last_hash) : NaN;
  const since = Number.isFinite(upTo) ? new Date(upTo) : new Date(now.getTime() - BLUESKY_FIRST_READ_DAYS * 86_400_000);
  // Oldest first, so a busy account is worked through in order across runs.
  const posts = (Array.isArray(r.feed) ? r.feed : []).map(i => postSignal(i, s.address, since)).filter((p): p is NonNullable<typeof p> => !!p)
    .filter(p => looksLikeFunding(p.text)).sort((a, b) => a.at.localeCompare(b.at));
  let kept = 0, filed = 0, unfinished = false;
  for (const p of posts) {
    // The cap counts posts dealt with THIS run; anything past it waits, and the cursor stays put so it is seen again.
    if (kept >= MAX_POSTS_PER_ACCOUNT || Date.now() > budget.stopAt) { unfinished = true; break; }
    let text = p.text, url = p.postUrl, skip = !p.link;
    if (p.link) {
      try {
        const page = await readPage(p.link, "The post is kept without it.");
        text = `${p.text}\n\n${page.text.slice(0, 15_000)}`; url = page.url;
      } catch {
        // A page that will not load today may load next run: a recent post is
        // left for then. An old one is recorded as it is, so one dead link
        // cannot hold an account's cursor back for good.
        if (now.getTime() - Date.parse(p.at) < 7 * 86_400_000) { unfinished = true; continue; }
        skip = true;
      }
    }
    const done = await fileSignal({ source: s, externalId: p.uri, title: p.text.replace(/\s+/g, " ").slice(0, 140), text, url, budget, skip, note: p.postUrl });
    if (!done) continue; // already recorded and finished on an earlier run
    kept += 1;
    if (done.status === "filed") filed += done.entries;
    if (unsettled(done)) unfinished = true;
  }
  // The clock moves only when everything seen was dealt with; otherwise the
  // same posts are looked at again next run and the unread ones are finished.
  await db.from("signal_source").update({
    last_checked_at: now.toISOString(), last_ok_at: now.toISOString(), last_error: null, ...(unfinished ? {} : { last_hash: now.toISOString() }),
  }).eq("id", s.id);
  return { ok: true, kept, filed };
}

/** The twice-weekly Bluesky read: bring in the follows, then read every account that is due. */
export async function runBluesky(budget: Budget): Promise<{ follows: number | null; added: number; checked: number; kept: number; filed: number; failed: number }> {
  const sync = await syncFollows().catch(() => null);
  const due = (await activeSources("bluesky")).filter(s => blueskyDue(s));
  const out = { follows: sync?.follows ?? null, added: sync?.added ?? 0, checked: 0, kept: 0, filed: 0, failed: 0 };
  for (const s of due) {
    if (Date.now() > budget.stopAt) { console.error(`[signals] bluesky stopped early; ${due.length - out.checked} account(s) wait for the next run`); break; }
    const r = await checkBluesky(s, budget);
    out.checked += 1; out.kept += r.kept; out.filed += r.filed;
    if (!r.ok) out.failed += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The signals inbox: newsletters and forwards arriving by email (Resend Inbound).

/**
 * Verify a Resend webhook (Svix signing): HMAC-SHA256 over
 * "<id>.<timestamp>.<raw body>" with the secret after "whsec_", compared in
 * constant time against each "v1,<signature>" the header carries.
 */
export function verifyWebhook(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, rawBody: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature || !freshTimestamp(h.timestamp, nowSec)) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.replace(/^whsec_/, ""), "base64"); } catch { return false; }
  if (!key.length) return false;
  const want = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();
  for (const part of h.signature.split(" ")) {
    const [v, sig] = part.split(",");
    if (v !== "v1" || !sig) continue;
    let got: Buffer;
    try { got = Buffer.from(sig, "base64"); } catch { continue; }
    if (got.length === want.length && timingSafeEqual(got, want)) return true;
  }
  return false;
}

interface ReceivedEmail { from: string; to: string[]; subject: string; text: string }

/** Fetch a received email's body from Resend (the webhook carries metadata only). */
export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !/^[a-zA-Z0-9-]{8,80}$/.test(emailId)) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (!res.ok) { console.error("[signals] received email not fetched", res.status); return null; }
    const j = await res.json() as { from?: unknown; to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
    // The HTML part first, with each link's address kept beside its words: a
    // newsletter's opportunities are links, and the plain-text part often drops them.
    const text = typeof j.html === "string" && j.html.trim() ? htmlToText(inlineLinks(j.html, "https://mail.invalid/"))
      : typeof j.text === "string" ? j.text : "";
    return {
      from: typeof j.from === "string" ? j.from : "",
      to: Array.isArray(j.to) ? j.to.filter((x): x is string => typeof x === "string") : typeof j.to === "string" ? [j.to] : [],
      subject: typeof j.subject === "string" ? j.subject : "(no subject)",
      text,
    };
  } catch (e) {
    console.error("[signals] received email not fetched", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Take in one received email. A sender seen for the first time is recorded
 * switched off and its mail HELD, unread by the parser, until For Granted
 * approves the sender: the inbox address is public by nature, and an
 * unapproved stranger must not be able to fill the review queue. The held
 * mail keeps its links, so a newsletter's "confirm your subscription" link
 * can be clicked from the Sources tab.
 */
export async function ingestEmail(emailId: string, budget: Budget): Promise<{ ok: boolean; status?: SignalStatus; reason?: string }> {
  const mail = await fetchReceivedEmail(emailId);
  if (!mail) return { ok: false, reason: "could not fetch the email" };
  // Only mail addressed to the signals inbox is ours. The address is required
  // (the route refuses to run without it): a receiving domain accepts mail for
  // any name, and the portal must not read whatever arrives.
  const inbox = (process.env.SIGNALS_INBOX ?? "").trim().toLowerCase();
  if (!inbox || !mail.to.some(t => normalizeAddress("email", t) === inbox)) return { ok: true, reason: "not addressed to the signals inbox" };
  const who = emailSender(mail.from);
  if (!who) return { ok: true, reason: "no readable sender" };
  // A flood of mail from invented senders must not bury the list: past a cap
  // of senders awaiting approval, mail from yet another new sender is dropped.
  const { data: known } = await db.from("signal_source").select("id").eq("kind", "email").eq("address", who.address).maybeSingle();
  if (!known) {
    const { count } = await db.from("signal_source").select("id", { count: "exact", head: true })
      .eq("kind", "email").eq("active", false).eq("origin", "inbox").is("last_signal_at", null);
    if ((count ?? 0) >= MAX_PENDING_SENDERS) {
      console.error(`[signals] ${count} senders already await approval; mail from a new sender was not recorded`);
      return { ok: true, reason: "too many senders awaiting approval" };
    }
  }
  const src = await upsertSource({ kind: "email", address: who.address, label: who.name, category: "aggregator", origin: "inbox", active: false });
  if (!src.ok) return { ok: false, reason: src.error };
  const now = new Date().toISOString();
  await db.from("signal_source").update({ last_checked_at: now, last_ok_at: now, last_error: null }).eq("id", src.source.id);
  const r = await fileSignal({
    source: src.source, externalId: emailId, title: mail.subject, text: mail.text.slice(0, 20_000), url: null, budget,
    hold: !src.source.active, note: linksIn(mail.text).join("\n") || null,
  });
  return { ok: true, status: r?.status ?? undefined, reason: r ? undefined : "already recorded" };
}

/** Read mail that was held, once its sender is approved (re-fetched from Resend, which keeps received mail). */
export async function readHeldEmail(signalId: string, budget: Budget): Promise<{ ok: boolean; status?: SignalStatus; entries?: number; error?: string }> {
  const { data } = await db.from("signal").select("id, external_id, status, source_id, signal_source(kind, active)").eq("id", signalId).maybeSingle();
  const row = data as unknown as { id: string; external_id: string; status: SignalStatus; source_id: string; signal_source: { kind: SourceKind; active: boolean } | null } | null;
  if (!row || row.signal_source?.kind !== "email") return { ok: false, error: "That is not held mail." };
  if (!row.signal_source.active) return { ok: false, error: "Approve the sender first." };
  if (!["held", "new", "failed", "reading"].includes(row.status)) return { ok: false, error: "That mail has already been read." };
  const mail = await fetchReceivedEmail(row.external_id);
  if (!mail) return { ok: false, error: "The email could not be fetched from the mail service. Check that RESEND_API_KEY can read received mail." };
  if (row.status === "held") await db.from("signal").update({ status: "new" }).eq("id", row.id).eq("status", "held");
  // Tied to its sender for the record; mail never publishes unreviewed, whatever the sender's row says (lib/trust.ts).
  const r = await readSignal(row.id, mail.text.slice(0, 20_000), budget, null, { id: row.source_id, kind: "email", trust: "review" });
  if (!unsettled(r)) await db.from("signal_source").update({ last_signal_at: new Date().toISOString() }).eq("id", row.source_id);
  return { ok: true, ...r };
}
