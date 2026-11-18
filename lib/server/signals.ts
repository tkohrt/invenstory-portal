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
import { readUrl, Plain } from "./read-url";
import { parseListText, fileLeads } from "./curated";
import { htmlToText } from "@/lib/application-text";
import {
  textForFingerprint, looksLikeFunding, linksIn, pageDue, weekListName, emailSender, freshTimestamp, normalizeAddress,
  type SourceRow, type SignalRow, type SignalStatus, type SourceKind, type SourceCategory, type SourceOrigin,
} from "@/lib/signals";

/** How many model calls one run may spend. Shared across everything the run reads. */
export interface Budget { parses: number; stopAt: number }

const SOURCE_COLS = "id, kind, address, label, category, active, origin, funder_key, last_checked_at, last_ok_at, last_error, last_hash, last_changed_at, last_signal_at, created_at";

export async function listSources(): Promise<SourceRow[]> {
  const { data, error } = await db.from("signal_source").select(SOURCE_COLS).order("kind").order("label").limit(500);
  // Thrown, not swallowed: an empty list must mean "nothing watched", never "migration 0098 missing".
  if (error) throw new Error(`signal_source could not be read: ${error.message}`);
  return (data ?? []) as SourceRow[];
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
}): Promise<{ ok: true; source: SourceRow; created: boolean } | { ok: false; error: string }> {
  const address = normalizeAddress(a.kind, a.address);
  if (!address) return { ok: false, error: a.kind === "page" ? "That is not a web address." : a.kind === "bluesky" ? "That is not a Bluesky handle (for example kresge.org or name.bsky.social)." : "That is not an email address." };
  const { data: existing } = await db.from("signal_source").select(SOURCE_COLS).eq("kind", a.kind).eq("address", address).maybeSingle();
  if (existing) return { ok: true, source: existing as SourceRow, created: false };
  const { data, error } = await db.from("signal_source").insert({
    kind: a.kind, address, label: (a.label.trim() || address).slice(0, 200), category: a.category ?? "funder",
    origin: a.origin ?? "manual", active: a.active ?? true, funder_key: a.funderKey ?? null, created_by: a.userId ?? null,
  }).select(SOURCE_COLS).single();
  if (error || !data) {
    console.error("[signals] source not saved", error?.message);
    return { ok: false, error: "The source could not be saved. Has migration 0098 been applied?" };
  }
  return { ok: true, source: data as SourceRow, created: true };
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
    context_note: "Found by For Granted's watched sources (pages, newsletters, accounts) this week. Each entry was read from the funder's own page and reviewed before it reached you.",
    created_by: null,
  }).select("id").single();
  if (error || !data) { console.error("[signals] week list not created", error?.message); return null; }
  return (data as { id: string }).id;
}

/**
 * Record one thing a source produced and, when it reads like funding news and
 * the budget allows, parse it into review-queue entries. Returns null when
 * this exact signal was already recorded (the unique key is the dedupe).
 */
export async function fileSignal(a: {
  source: SourceRow; externalId: string; title: string; text: string; url: string | null;
  budget: Budget; hold?: boolean; note?: string | null;
}): Promise<{ status: SignalStatus; entries: number } | null> {
  const base = {
    source_id: a.source.id, external_id: a.externalId.slice(0, 400), title: a.title.slice(0, 300),
    excerpt: a.text.replace(/\s+/g, " ").trim().slice(0, 600), url: a.url?.slice(0, 1000) ?? null, note: a.note?.slice(0, 4000) ?? null,
  };
  const { data: row, error } = await db.from("signal").insert({ ...base, status: a.hold ? "held" : "new" }).select("id").single();
  if (error || !row) {
    if (error && error.code !== "23505") { console.error("[signals] signal not recorded", error.message); return null; }
    // Already recorded. One left unread (the budget ran out, or the parser
    // was unavailable) is finished now; anything else is simply a repeat.
    const { data: prior } = await db.from("signal").select("id, status").eq("source_id", a.source.id).eq("external_id", base.external_id).maybeSingle();
    const p = prior as { id: string; status: SignalStatus } | null;
    if (!p || a.hold || (p.status !== "new" && p.status !== "failed")) return null;
    return readSignal(p.id, a.text, a.budget);
  }
  const id = (row as { id: string }).id;
  if (a.hold) return { status: "held", entries: 0 };
  const done = await readSignal(id, a.text, a.budget);
  await db.from("signal_source").update({ last_signal_at: new Date().toISOString() }).eq("id", a.source.id);
  return done;
}

/** Parse a recorded signal's text and settle its status. "new" means the budget ran out; the next run picks it up. */
export async function readSignal(signalId: string, text: string, budget: Budget): Promise<{ status: SignalStatus; entries: number }> {
  const settle = async (status: SignalStatus, entries = 0, listId: string | null = null) => {
    await db.from("signal").update({ status, entries, curated_list_id: listId }).eq("id", signalId);
    return { status, entries };
  };
  if (!looksLikeFunding(text)) return settle("skipped");
  if (budget.parses <= 0 || Date.now() > budget.stopAt) return { status: "new", entries: 0 };
  budget.parses -= 1;
  const parsed = await parseListText(text);
  if (!parsed.ok) return parsed.reason === "empty" ? settle("nothing") : settle("failed");
  const listId = await weekList();
  if (!listId) return settle("failed");
  // Counted as what the parser read, not only what was new to the queue: an
  // entry already known is still what this signal was about.
  await fileLeads(listId, parsed.leads, null);
  return settle("filed", parsed.leads.length, listId);
}

/** Re-read one watched page; file a signal when its content has changed. */
export async function checkPage(s: SourceRow, budget: Budget): Promise<{ changed: boolean; status?: SignalStatus; entries?: number; error?: string }> {
  const now = new Date().toISOString();
  let page: { text: string; url: string };
  try {
    page = await readUrl(s.address, "It will be tried again on the next run.");
  } catch (e) {
    const msg = e instanceof Plain ? e.message.replace(/ It will be tried again on the next run\.$/, "") : "The page could not be read.";
    await db.from("signal_source").update({ last_checked_at: now, last_error: msg.slice(0, 300) }).eq("id", s.id);
    return { changed: false, error: msg };
  }
  const hash = createHash("sha256").update(textForFingerprint(page.text)).digest("hex");
  if (hash === s.last_hash) {
    await db.from("signal_source").update({ last_checked_at: now, last_ok_at: now, last_error: null }).eq("id", s.id);
    return { changed: false };
  }
  const r = await fileSignal({ source: s, externalId: hash, title: s.label, text: page.text.slice(0, 20_000), url: page.url, budget });
  // The fingerprint moves only once the change was dealt with: when the budget
  // ran out or the parser was unavailable ("new", "failed"), the next read
  // sees the same change again and the recorded signal is finished then.
  const settled = !r || (r.status !== "new" && r.status !== "failed");
  await db.from("signal_source").update({
    last_checked_at: now, last_ok_at: now, last_error: null,
    ...(settled ? { last_hash: hash, last_changed_at: now } : {}),
  }).eq("id", s.id);
  return { changed: true, status: r?.status, entries: r?.entries };
}

/** The weekly page watch: every active page that is due, oldest check first. */
export async function runPageWatch(budget: Budget): Promise<{ checked: number; changed: number; filed: number; failed: number }> {
  const due = (await listSources()).filter(s => pageDue(s))
    .sort((a, b) => (a.last_checked_at ?? "").localeCompare(b.last_checked_at ?? ""));
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

/** Approved senders' mail left unread (the budget ran out, or the parser was unavailable), for the next run to finish. */
export async function pendingEmail(limit = 20): Promise<string[]> {
  const { data } = await db.from("signal").select("id, signal_source!inner(kind, active)")
    .in("status", ["new", "failed"]).eq("signal_source.kind", "email").eq("signal_source.active", true)
    .gte("seen_at", new Date(Date.now() - 14 * 86_400_000).toISOString()).order("seen_at", { ascending: true }).limit(limit);
  return ((data ?? []) as { id: string }[]).map(r => r.id);
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
    const text = typeof j.text === "string" && j.text.trim() ? j.text : typeof j.html === "string" ? htmlToText(j.html) : "";
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
  const inbox = (process.env.SIGNALS_INBOX ?? "").trim().toLowerCase();
  if (inbox && !mail.to.some(t => normalizeAddress("email", t) === inbox)) return { ok: true, reason: "not addressed to the signals inbox" };
  const who = emailSender(mail.from);
  if (!who) return { ok: true, reason: "no readable sender" };
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
  if (!["held", "new", "failed"].includes(row.status)) return { ok: false, error: "That mail has already been read." };
  const mail = await fetchReceivedEmail(row.external_id);
  if (!mail) return { ok: false, error: "The email could not be fetched from the mail service. Check that RESEND_API_KEY can read received mail." };
  await db.from("signal").update({ status: "new" }).eq("id", row.id);
  const r = await readSignal(row.id, mail.text.slice(0, 20_000), budget);
  if (r.status !== "new") await db.from("signal_source").update({ last_signal_at: new Date().toISOString() }).eq("id", row.source_id);
  return { ok: true, ...r };
}
