import "server-only";
// Curated list sweeps (P2.5, patch 39): For Granted loads a list once, the
// entries ride the existing Ground Truth review queue, and a sweep screens
// every community-member tenant against what was approved. No model calls in
// the sweep itself; the one model call is parsing the pasted list.
import { db } from "./db";
import { chatComplete } from "./llm";
import { getEligibilityProfile } from "./eligibility";
import { screenGrant } from "@/lib/grant-screen";
import { parseLeads, overlayDraft, wantsKind } from "@/lib/web-discovery";
import { CURATED_PARSE_SYSTEM, curatedParseUser, curatedLeads, curatedCard, type CuratedMatchRow } from "@/lib/curated";
import { publishes, standing, followStanding, type Trust } from "@/lib/trust";

/** True when a query failed only because migration 0100 (patch 67) has not been applied. */
const lacks0100 = (e: { message: string } | null | undefined) => !!e && /published_at|signal_source_id/i.test(e.message);

const MAX_ENTRIES = 50;
const MAX_TENANTS = 60;

export interface CuratedListRow {
  id: string; name: string; source_url: string | null; context_note: string | null;
  created_at: string; swept_at: string | null;
  proposed: number; approved: number; rejected: number; matches: number; tenants: number;
}

type Lead = ReturnType<typeof curatedLeads>[number];

/**
 * Read opportunities out of a body of text with the one curated-list parser
 * (the single model call). Shared since patch 64 by pasted lists and by
 * signals (a changed page, a newsletter, a post's linked page), so everything
 * that reaches the review queue was read by the same rules.
 * "unavailable": the model did not answer. "empty": it answered, nothing in it.
 */
export async function parseListText(pasted: string, sourceUrl?: string | null): Promise<{ ok: true; leads: Lead[] } | { ok: false; reason: "unavailable" | "empty" }> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await chatComplete({
    system: CURATED_PARSE_SYSTEM, user: curatedParseUser(pasted.slice(0, 20_000), today, sourceUrl),
    maxTokens: 4000, temperature: 0,
  });
  if (!res?.text) return { ok: false, reason: "unavailable" };
  const leads = curatedLeads(parseLeads(res.text), today).slice(0, MAX_ENTRIES);
  return leads.length ? { ok: true, leads } : { ok: false, reason: "empty" };
}

/**
 * File parsed entries into the Ground Truth review queue under one list.
 * Deduped by the opportunity's own URL: one already known is tied to the list
 * (when it has none) and not filed twice. Returns how many NEW proposals went in.
 *
 * `from` (patch 67) is the signals source the entries were read from. Each is
 * filed under it, and an opportunity from a first-party source is published
 * with the "not yet reviewed" label as it is filed (lib/trust.ts publishes);
 * it waits in the queue all the same. A pasted list has no `from`, and its
 * entries wait for review exactly as before.
 */
export async function fileLeads(
  listId: string, leads: Lead[], userId: string | null,
  from: { id: string; kind: string; trust?: Trust | null } | null = null,
): Promise<number> {
  let filed = 0;
  const now = new Date().toISOString();
  for (const l of leads) {
    const draft = overlayDraft(l, []);
    const live = publishes(from, { kind: draft.kind, title: draft.title, source_url: draft.source_url });
    type Known = { id: string; kind: string; status: string; curated_list_id: string | null; published_at?: string | null; signal_source_id?: string | null };
    let existing: Known | null = null;
    if (draft.source_url) {
      // tenant-safe: ledger_overlay is For Granted's shared review queue (no tenant_id); deduped by the page's URL. An entry with no URL has nothing to dedupe on.
      const read = (cols: string) => db.from("ledger_overlay").select(cols).eq("source_url", draft.source_url).limit(1).maybeSingle();
      let r = await read("id, kind, status, curated_list_id, published_at, signal_source_id");
      if (lacks0100(r.error)) r = await read("id, kind, status, curated_list_id");
      else if (r.error) r = await read("id, kind, status, curated_list_id, published_at, signal_source_id"); // one more try on a hiccup
      // A lookup that still fails must not read as "not known": filing the
      // entry again could put one a person rejected back in front of clients.
      // It is skipped, and said so in the log.
      if (r.error) { console.error("[curated] dedupe read failed; entry not filed:", draft.title.slice(0, 80), r.error.message); continue; }
      existing = r.data as unknown as Known | null;
    }
    if (existing) {
      const patch: Record<string, unknown> = {};
      // Already known: tie it to this list too, so the sweep can carry it.
      if (!existing.curated_list_id) patch.curated_list_id = listId;
      // Known and still waiting, and now a first-party source states it too:
      // it goes live with the label. One a person already decided is never
      // touched, so a rejected entry stays rejected however often it is re-read.
      const waiting = existing.status === "proposed" || existing.status === "in_review";
      if (live && waiting && existing.kind === "grant" && existing.published_at === null) {
        patch.published_at = now;
        if (!existing.signal_source_id && from) patch.signal_source_id = from.id;
      }
      // tenant-safe: the shared review queue, one row by id.
      if (Object.keys(patch).length) await db.from("ledger_overlay").update(patch).eq("id", existing.id);
      continue;
    }
    const row = {
      kind: draft.kind, base_id: null, ein: null,
      opportunity_number: draft.kind === "grant" ? draft.source_url.slice(0, 400) : null,
      title: draft.title.slice(0, 300), fields: draft.fields,
      source_url: draft.source_url || `curated:${listId}:${Date.now()}:${filed}`,
      provenance: "curated_list", curated_list_id: listId, status: "proposed",
      confidence: "low", proposed_by: userId,
    };
    // tenant-safe: the shared review queue (no tenant_id).
    let { error: insErr } = await db.from("ledger_overlay").insert({ ...row, signal_source_id: from?.id ?? null, published_at: live ? now : null });
    // Before migration 0100: filed as before, waiting for review, nothing published.
    // tenant-safe: the shared review queue (no tenant_id).
    if (lacks0100(insErr)) ({ error: insErr } = await db.from("ledger_overlay").insert(row));
    if (insErr) console.error("[curated] entry not filed", insErr.message);
    else filed += 1;
  }
  return filed;
}

/** Parse a pasted list and file each entry as a Ground Truth proposal. */
export async function createCuratedList(a: {
  name: string; sourceUrl: string | null; contextNote: string | null; pasted: string; userId: string;
}): Promise<{ ok: true; listId: string; entries: number } | { ok: false; error: string }> {
  const parsed = await parseListText(a.pasted);
  if (!parsed.ok) {
    return { ok: false, error: parsed.reason === "unavailable"
      ? "The list could not be parsed right now (AI parsing is unavailable in this environment). Try again, or file the entries one at a time with Record a verification."
      : "No opportunities could be read from that text. Paste the list itself (titles, funders, links, deadlines)." };
  }
  // tenant-safe: curated_list is For Granted's shared, admin-only record with no tenant_id.
  const { data: list, error } = await db.from("curated_list").insert({
    name: a.name.slice(0, 200), source_url: a.sourceUrl?.slice(0, 1000) || null,
    context_note: a.contextNote?.slice(0, 4000) || null, created_by: a.userId,
  }).select("id").single();
  if (error || !list) return { ok: false, error: "The list could not be saved. Has migration 0087 been applied?" };
  const listId = (list as { id: string }).id;
  return { ok: true, listId, entries: await fileLeads(listId, parsed.leads, a.userId) };
}

/** Screen every community member against a list's approved entries. */
export async function sweepCuratedList(listId: string): Promise<{ ok: true; entries: number; tenants: number; matches: number; skipped: number; notSought: number } | { ok: false; error: string }> {
  // tenant-safe: admin-only read of the shared review queue, by list.
  const { data: entries } = await db.from("ledger_overlay")
    .select("id, kind, fields").eq("curated_list_id", listId).eq("status", "approved").limit(MAX_ENTRIES);
  const grants = ((entries ?? []) as { id: string; kind: string; fields: Record<string, unknown> }[])
    .filter(e => e.kind === "grant");
  if (!grants.length) return { ok: false, error: "No approved opportunities on this list yet. Approve its entries in the queue below, then sweep." };

  // tenant-safe: membership flags across all clients are For Granted's own fan-out list.
  const { data: tenants } = await db.from("tenant").select("id, community_member, is_brain").limit(200);
  const members = ((tenants ?? []) as { id: string; community_member: boolean | null; is_brain: boolean | null }[])
    .filter(t => t.community_member === true && t.is_brain !== true).slice(0, MAX_TENANTS);
  const skipped = ((tenants ?? []) as { is_brain: boolean | null; community_member: boolean | null }[])
    .filter(t => t.is_brain !== true && t.community_member !== true).length;

  const today = new Date();
  let matches = 0;
  // Patch 62: entry-and-client pairs left out because the client is not
  // looking for that kind of money (an accelerator, a grants-only client).
  let notSought = 0;
  for (const t of members) {
    const p = await getEligibilityProfile(t.id).catch(() => null);
    if (!p || !p.org_type) continue;
    for (const e of grants) {
      if (!wantsKind(e.fields?.money_kind, p)) { notSought += 1; continue; }
      const s = screenGrant({ ...curatedCard(e.fields), id: e.id } as Parameters<typeof screenGrant>[0], p, today, { reviewed: true });
      if (!s || s.verdict === "watch") continue;
      const { error } = await db.from("curated_match").upsert({
        tenant_id: t.id, list_id: listId, overlay_id: e.id, verdict: s.verdict,
        swept_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,overlay_id" });
      if (!error) matches += 1;
    }
  }
  // tenant-safe: the list row is shared admin data.
  await db.from("curated_list").update({ swept_at: new Date().toISOString() }).eq("id", listId);
  return { ok: true, entries: grants.length, tenants: members.length, matches, skipped, notSought };
}

const SIGNAL_SWEEP_DAYS = 45;
const SIGNAL_SWEEP_ENTRIES = 400;

/**
 * Screen every community member against the open opportunities the signals
 * sources produced (patch 67). No model calls. This is what makes review
 * follow the clients and not the sources: each entry is screened as it
 * arrives, whether or not anyone has reviewed it.
 *   - A match on a PUBLISHED or approved entry is what the client sees.
 *   - A match on an entry still waiting unseen shows the client nothing
 *     (getCuratedMatches hides it) and moves the entry to the top of the
 *     review queue; the client sees it the moment it is approved.
 * Only NEW matches are written, so a match's date never moves and a notice a
 * client dismissed does not come back with every run. Bounded by `stopAt`.
 */
export async function sweepSignalEntries(stopAt = Date.now() + 40_000): Promise<{ ok: true; entries: number; tenants: number; matches: number; unfinished: boolean } | { ok: false; error: string }> {
  const since = new Date(Date.now() - SIGNAL_SWEEP_DAYS * 86_400_000).toISOString();
  // tenant-safe: the shared review queue (no tenant_id), signals entries only.
  const { data: entries, error } = await db.from("ledger_overlay")
    .select("id, kind, fields, curated_list_id").not("signal_source_id", "is", null).eq("kind", "grant")
    .in("status", ["proposed", "in_review", "approved"]).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(SIGNAL_SWEEP_ENTRIES);
  if (error) return { ok: false, error: lacks0100(error) ? "Migration 0100 has not been applied yet." : "The entries could not be read." };
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10);
  const open = ((entries ?? []) as { id: string; fields: Record<string, unknown>; curated_list_id: string | null }[])
    .filter(e => e.curated_list_id && !(typeof e.fields?.close_date === "string" && e.fields.close_date < ymd));
  if (!open.length) return { ok: true, entries: 0, tenants: 0, matches: 0, unfinished: false };

  // tenant-safe: membership flags across all clients are For Granted's own fan-out list.
  const { data: tenants } = await db.from("tenant").select("id, community_member, is_brain").limit(200);
  const members = ((tenants ?? []) as { id: string; community_member: boolean | null; is_brain: boolean | null }[])
    .filter(t => t.community_member === true && t.is_brain !== true).slice(0, MAX_TENANTS);

  let matches = 0, done = 0, unfinished = false;
  for (const t of members) {
    if (Date.now() > stopAt) { unfinished = true; break; }
    done += 1;
    const p = await getEligibilityProfile(t.id).catch(() => null);
    if (!p || !p.org_type) continue;
    const { data: had, error: hadErr } = await db.from("curated_match").select("overlay_id").eq("tenant_id", t.id).in("overlay_id", open.map(e => e.id));
    if (hadErr) { console.error("[curated] signals sweep: matches not read", hadErr.message); continue; }
    const known = new Set(((had ?? []) as { overlay_id: string }[]).map(m => m.overlay_id));
    const rows: { tenant_id: string; list_id: string; overlay_id: string; verdict: string; swept_at: string }[] = [];
    for (const e of open) {
      if (known.has(e.id) || !wantsKind(e.fields?.money_kind, p)) continue;
      const s = screenGrant({ ...curatedCard(e.fields), id: e.id } as Parameters<typeof screenGrant>[0], p, today, { reviewed: true });
      if (!s || s.verdict === "watch") continue;
      rows.push({ tenant_id: t.id, list_id: e.curated_list_id as string, overlay_id: e.id, verdict: s.verdict, swept_at: today.toISOString() });
    }
    if (!rows.length) continue;
    const { error: upErr } = await db.from("curated_match").upsert(rows, { onConflict: "tenant_id,overlay_id", ignoreDuplicates: true });
    if (upErr) console.error("[curated] signals sweep: matches not saved", upErr.message);
    else matches += rows.length;
  }
  return { ok: true, entries: open.length, tenants: done, matches, unfinished };
}

/** The admin card's rows: every list with its counts. */
export async function getCuratedLists(): Promise<CuratedListRow[]> {
  // tenant-safe: curated_list and its entries are For Granted's shared records.
  const { data: lists } = await db.from("curated_list").select("*").order("created_at", { ascending: false }).limit(50);
  const rows = (lists ?? []) as (Omit<CuratedListRow, "proposed" | "approved" | "rejected" | "matches" | "tenants">)[];
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [{ data: entries }, { data: matches }] = await Promise.all([
    db.from("ledger_overlay").select("curated_list_id, status").in("curated_list_id", ids),
    db.from("curated_match").select("list_id, tenant_id").in("list_id", ids),
  ]);
  const es = (entries ?? []) as { curated_list_id: string; status: string }[];
  const ms = (matches ?? []) as { list_id: string; tenant_id: string }[];
  return rows.map(r => ({
    ...r,
    proposed: es.filter(e => e.curated_list_id === r.id && (e.status === "proposed" || e.status === "in_review")).length,
    approved: es.filter(e => e.curated_list_id === r.id && e.status === "approved").length,
    rejected: es.filter(e => e.curated_list_id === r.id && e.status === "rejected").length,
    matches: ms.filter(m => m.list_id === r.id).length,
    tenants: new Set(ms.filter(m => m.list_id === r.id).map(m => m.tenant_id)).size,
  }));
}

const MACHINE_NOTE = "The exact page was not among the search results: check the link.";
type EntryRow = { id: string; fields: Record<string, unknown>; status: string; published_at?: string | null };
/** Queue entries by id, with the published stamp when migration 0100 is in. */
async function readEntries(ids: string[]): Promise<{ data: EntryRow[] | null }> {
  // tenant-safe: shared overlay entries, read by the ids this tenant's matches point at; client-safe fields only are shipped to the page.
  const read = (cols: string) => db.from("ledger_overlay").select(cols).in("id", ids);
  let r = await read("id, fields, status, published_at");
  if (lacks0100(r.error)) r = await read("id, fields, status");
  return { data: (r.data ?? null) as unknown as EntryRow[] | null };
}

/**
 * One entry as THIS client may see it, or null: it must be on the client's
 * own match list and either approved or published (patch 67). The gate every
 * client action on a curated entry goes through.
 */
export async function visibleEntry(tenantId: string, overlayId: string): Promise<(EntryRow & { reviewed: boolean }) | null> {
  const { data: m } = await db.from("curated_match").select("id").eq("tenant_id", tenantId).eq("overlay_id", overlayId).maybeSingle();
  if (!m) return null;
  const e = ((await readEntries([overlayId])).data ?? [])[0];
  if (!e) return null;
  const seen = standing(e);
  return seen === "hidden" ? null : { ...e, reviewed: seen === "reviewed" };
}

/**
 * Where followed curated entries stand with For Granted (patch 67), for the
 * Following list: "unreviewed" or "withdrawn" by entry id; an id not in the
 * answer needs no note. Only ids on THIS client's own match list are looked
 * up, so a saved id cannot be used to probe the shared queue.
 */
export async function followedStandings(tenantId: string, ids: string[]): Promise<Record<string, "unreviewed" | "withdrawn">> {
  const uuids = [...new Set(ids.filter(i => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i)))].slice(0, 300);
  if (!uuids.length) return {};
  const { data: mine } = await db.from("curated_match").select("overlay_id").eq("tenant_id", tenantId).in("overlay_id", uuids);
  const own = ((mine ?? []) as { overlay_id: string }[]).map(m => m.overlay_id);
  if (!own.length) return {};
  const out: Record<string, "unreviewed" | "withdrawn"> = {};
  for (const e of (await readEntries(own)).data ?? []) {
    const f = followStanding(e);
    if (f) out[e.id] = f;
  }
  return out;
}

/** What this client was matched with, newest sweep first. Open entries only. */
export async function getCuratedMatches(tenantId: string): Promise<CuratedMatchRow[]> {
  const { data } = await db.from("curated_match").select("overlay_id, list_id, verdict, swept_at")
    .eq("tenant_id", tenantId).order("swept_at", { ascending: false }).limit(40);
  let rows = (data ?? []) as { overlay_id: string; list_id: string; verdict: string; swept_at: string }[];
  if (!rows.length) return [];
  // The feedback loop (patch 44): a curated entry the client marked "Not for
  // us" never resurfaces here, in the bar, or on the coming calendar.
  const { data: dismissed } = await db.from("client_match_view").select("target_id")
    .eq("tenant_id", tenantId).eq("kind", "grant").eq("state", "not_for_us")
    .in("target_id", rows.map(r => r.overlay_id));
  const hidden = new Set(((dismissed ?? []) as { target_id: string }[]).map(d => d.target_id));
  rows = rows.filter(r => !hidden.has(r.overlay_id));
  if (!rows.length) return [];
  const [{ data: entries }, { data: lists }] = await Promise.all([
    readEntries([...new Set(rows.map(r => r.overlay_id))]),
    // tenant-safe: shared curated lists, read by id.
    db.from("curated_list").select("id, name, context_note").in("id", [...new Set(rows.map(r => r.list_id))]),
  ]);
  const byEntry = new Map(((entries ?? []) as EntryRow[]).map(e => [e.id, e]));
  const byList = new Map(((lists ?? []) as { id: string; name: string; context_note: string | null }[]).map(l => [l.id, l]));
  const today = new Date().toISOString().slice(0, 10);
  // Patch 62: a match made before the client's kinds were respected, or before
  // the client changed them, is not shown. Read-time, so nothing needs re-sweeping.
  const profile = await getEligibilityProfile(tenantId).catch(() => null);
  const out: CuratedMatchRow[] = [];
  for (const r of rows) {
    const e = byEntry.get(r.overlay_id);
    const l = byList.get(r.list_id);
    // Patch 67: approved entries as before, and published ones with the
    // "not yet reviewed" label. One still waiting unseen, rejected or
    // superseded is not shown, though its match row is on file.
    const seen = e ? standing(e) : "hidden";
    if (!e || seen === "hidden" || !l) continue;
    const c = curatedCard(e.fields);
    if (c.close_date && c.close_date < today) continue; // closed since the sweep
    if (profile && !wantsKind(c.money_kind, profile)) continue; // not a kind this client is looking for
    // Notes reach a client only from an entry For Granted reviewed (patch 67):
    // before that they are the reader's own working notes. The reader's
    // standing "check the link" line is For Granted's reminder to itself and
    // is never shipped.
    const raw = seen === "reviewed" && typeof e.fields.notes === "string" ? e.fields.notes.replace(MACHINE_NOTE, "").trim() : "";
    const notes = raw || null;
    out.push({
      overlay_id: r.overlay_id, list_id: r.list_id, list_name: l.name,
      context_note: l.context_note, swept_at: r.swept_at, verdict: r.verdict,
      title: c.title ?? "Untitled opportunity", funder: c.agency ?? null,
      close_date: c.close_date ?? null, max_award: c.max_award ?? null,
      website: c.website ?? null, notes,
      money_kind: c.money_kind ?? null, terms: c.investment_terms ?? null,
      reviewed: seen === "reviewed",
    });
  }
  // What For Granted has checked comes first; the order within each is unchanged (newest sweep first).
  return [...out.filter(r => r.reviewed), ...out.filter(r => !r.reviewed)];
}

/** The membership manager's rows. */
export async function getCommunityMembers(): Promise<{ id: string; name: string; member: boolean }[]> {
  // tenant-safe: names and membership flags across clients are For Granted's own admin list.
  const { data } = await db.from("tenant").select("id, name, community_member, is_brain").order("name").limit(200);
  return ((data ?? []) as { id: string; name: string; community_member: boolean | null; is_brain: boolean | null }[])
    .filter(t => t.is_brain !== true)
    .map(t => ({ id: t.id, name: t.name, member: t.community_member === true }));
}
