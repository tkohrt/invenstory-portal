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
import { oppHost, funderKey, findTwin, changedFacts, applyChanges, addSeen, type Sighting } from "@/lib/opportunity";

/** True when a query failed only because migration 0100 (patch 67) has not been applied. */
const lacks0100 = (e: { message: string } | null | undefined) => !!e && /published_at|signal_source_id/i.test(e.message);
/** True when a query failed only because migration 0101 (patch 68) has not been applied. */
const lacks0101 = (e: { message: string } | null | undefined) => !!e && /opp_host|opp_funder|also_seen|update_of/i.test(e.message);

const TWIN_DAYS = 400;
type OnFile = Sighting & {
  id: string; status: string; created_at: string; fields: Record<string, unknown>;
  published_at: string | null; signal_source_id: string | null; also_seen: unknown; source_url: string;
};
/**
 * Entries on file that a new sighting might be another view of (patch 68):
 * opportunities on the same site or from the same funder, decided or waiting,
 * from the last TWIN_DAYS. Rows that are themselves proposed updates are left
 * out. Null when the lookup could not be made (before migration 0101, or a
 * failed read): the caller then files by address alone, as before.
 */
async function twinCandidates(host: string | null, funder: string | null): Promise<OnFile[] | null> {
  const since = new Date(Date.now() - TWIN_DAYS * 86_400_000).toISOString();
  const byId = new Map<string, OnFile>();
  for (const [col, val] of [["opp_host", host], ["opp_funder", funder]] as const) {
    if (!val) continue;
    // tenant-safe: the shared review queue (no tenant_id), opportunities sharing a site or a funder.
    const { data, error } = await db.from("ledger_overlay")
      .select("id, status, title, source_url, fields, created_at, published_at, signal_source_id, also_seen")
      .eq("kind", "grant").eq(col, val).is("update_of", null)
      .in("status", ["proposed", "in_review", "approved", "rejected"]).gte("created_at", since)
      .order("created_at", { ascending: true }).limit(300);
    if (error) { if (!lacks0101(error) && !lacks0100(error)) console.error("[curated] twin lookup failed", error.message); return null; }
    for (const r of (data ?? []) as unknown as (Omit<OnFile, "url" | "funder" | "close_date"> & { title: string | null })[]) {
      byId.set(r.id, { ...r, url: r.source_url, funder: typeof r.fields?.agency === "string" ? r.fields.agency : null,
        close_date: typeof r.fields?.close_date === "string" ? r.fields.close_date : null });
    }
  }
  return [...byId.values()];
}

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
 *
 * Patch 68, one opportunity, one entry (lib/opportunity.ts). A sighting is
 * first met by address, then by what it is (same site or funder, same title,
 * same round). What it meets decides what happens:
 *   - rejected: not filed again, whatever the address or wording;
 *   - approved: the address is recorded; a fact it states differently is
 *     filed as one waiting UPDATE to that entry (proposeUpdate), never as a
 *     second entry and never published;
 *   - waiting: the address is recorded on the one entry; a first-party
 *     source's reading publishes it, or keeps it current if already live.
 */
export async function fileLeads(
  listId: string, leads: Lead[], userId: string | null,
  from: { id: string; kind: string; trust?: Trust | null; label?: string | null } | null = null,
): Promise<number> {
  let filed = 0;
  const now = new Date().toISOString();
  // Entries this source had rejected, by the page they sit on, read once per page (see rejectedTwin).
  const rejectedOn = new Map<string, { title: string | null; source_url: string }[]>();
  /**
   * "A rejected entry stays rejected" has to survive a page being re-read.
   * An opportunity with no link of its own is filed at "page#its-title-and-
   * deadline", and the title is the reader's wording: the same thing can come
   * back under a slightly different address. So a NEW entry on a page where
   * this source already had an entry rejected under the same title (one title
   * containing the other counts) is filed waiting, not published.
   */
  const rejectedTwin = async (url: string, title: string): Promise<boolean> => {
    if (!from || !url.includes("#")) return false;
    const page = url.slice(0, url.indexOf("#"));
    let known = rejectedOn.get(page);
    if (!known) {
      // tenant-safe: the shared review queue (no tenant_id), one source's rejected entries on one page.
      const { data, error } = await db.from("ledger_overlay").select("title, source_url")
        .eq("signal_source_id", from.id).eq("status", "rejected").like("source_url", `${page.replace(/[%_\\]/g, "\\$&")}#%`).limit(200);
      // A lookup that fails holds the entry: unsure is not published.
      if (error) { console.error("[curated] rejected-entry check failed", error.message); return !lacks0100(error); }
      known = (data ?? []) as { title: string | null; source_url: string }[];
      rejectedOn.set(page, known);
    }
    const norm = (t: string | null) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const mine = norm(title);
    return !!mine && known.some(k => { const theirs = norm(k.title); return !!theirs && (theirs.includes(mine) || mine.includes(theirs)); });
  };
  /**
   * An approved entry, and a later reading that states a fact differently:
   * filed as ONE waiting row that points at the entry (update_of). Never
   * published, never tied to a source (so it is reviewed in the ordinary
   * band), and refreshed in place if one is already waiting. Returns true
   * when a new row went into the queue. Before migration 0101 it does nothing.
   */
  const proposeUpdate = async (target: { id: string; title?: string | null }, draft: ReturnType<typeof overlayDraft>): Promise<boolean> => {
    // tenant-safe: the shared review queue; the update already waiting for this entry, if any.
    const { data: open, error: openErr } = await db.from("ledger_overlay").select("id").eq("update_of", target.id).in("status", ["proposed", "in_review"]).limit(1).maybeSingle();
    if (openErr) { if (!lacks0101(openErr)) console.error("[curated] update lookup failed", openErr.message); return false; }
    const update = { fields: draft.fields, source_url: draft.source_url, title: (target.title ?? draft.title).slice(0, 300) };
    if (open) {
      // tenant-safe: the shared review queue, one row by id.
      await db.from("ledger_overlay").update(update).eq("id", (open as { id: string }).id);
      return false;
    }
    // tenant-safe: the shared review queue (no tenant_id).
    const { error: upErr } = await db.from("ledger_overlay").insert({
      kind: "grant", base_id: null, ein: null, opportunity_number: draft.source_url.slice(0, 400), ...update,
      provenance: "curated_list", curated_list_id: listId, status: "proposed", confidence: "low", proposed_by: userId,
      update_of: target.id, opp_host: oppHost(draft.source_url), opp_funder: funderKey(typeof draft.fields.agency === "string" ? draft.fields.agency : null),
    });
    if (upErr) { console.error("[curated] update not filed", upErr.message); return false; }
    return true;
  };
  for (const l of leads) {
    const draft = overlayDraft(l, []);
    let live = publishes(from, { kind: draft.kind, title: draft.title, source_url: draft.source_url });
    type Known = { id: string; kind: string; status: string; title: string | null; fields: Record<string, unknown>; curated_list_id: string | null; published_at?: string | null; signal_source_id?: string | null };
    let existing: Known | null = null;
    if (draft.source_url) {
      // tenant-safe: ledger_overlay is For Granted's shared review queue (no tenant_id); deduped by the page's URL. An entry with no URL has nothing to dedupe on.
      // Oldest first: an update row shares its entry's address, and the entry itself is the one to meet.
      const read = (cols: string) => db.from("ledger_overlay").select(cols).eq("source_url", draft.source_url).order("created_at", { ascending: true }).limit(1).maybeSingle();
      let r = await read("id, kind, status, title, fields, curated_list_id, published_at, signal_source_id");
      if (lacks0100(r.error)) r = await read("id, kind, status, title, fields, curated_list_id");
      else if (r.error) r = await read("id, kind, status, title, fields, curated_list_id, published_at, signal_source_id"); // one more try on a hiccup
      // A lookup that still fails must not read as "not known": filing the
      // entry again could put one a person rejected back in front of clients.
      // It is skipped, and said so in the log.
      if (r.error) { console.error("[curated] dedupe read failed; entry not filed:", draft.title.slice(0, 80), r.error.message); continue; }
      existing = r.data as unknown as Known | null;
    }
    if (existing) {
      // Already known: tie it to this list too, so the sweep can carry it.
      // tenant-safe: the shared review queue, one row by id.
      if (!existing.curated_list_id) await db.from("ledger_overlay").update({ curated_list_id: listId }).eq("id", existing.id);
      // Known, still waiting, first filed by another SIGNALS source, and now
      // a first-party source states it too: it goes live with the label, and
      // what clients read is the first-party source's own account of it (its
      // fields and title replace the earlier reader's), filed under that
      // source. Never an entry a person already decided, and never one that
      // came in another way (by hand, a client's web search, a pasted list):
      // those are reviewed as they always were.
      const waiting = existing.status === "proposed" || existing.status === "in_review";
      if (live && from && waiting && existing.kind === "grant" && existing.published_at === null && existing.signal_source_id) {
        // tenant-safe: the shared review queue, one row by id; the status guard keeps a decision made meanwhile.
        await db.from("ledger_overlay").update({
          published_at: now, signal_source_id: from.id, fields: draft.fields, title: draft.title.slice(0, 300),
        }).eq("id", existing.id).in("status", ["proposed", "in_review"]);
      } else if (existing.kind === "grant" && draft.kind === "grant") {
        // Patch 68: the same address, read again, stating a fact differently
        // (the usual way a deadline moves). Approved: proposed as an update.
        // Live and unreviewed, from the funder's own source: kept current.
        const changes = changedFacts(existing.fields, draft.fields);
        if (changes.length && existing.status === "approved") { if (await proposeUpdate(existing, draft)) filed += 1; }
        else if (changes.length && live && waiting && existing.published_at) {
          // tenant-safe: the shared review queue, one row by id; the status guard keeps a decision made meanwhile.
          await db.from("ledger_overlay").update({ fields: applyChanges(existing.fields, draft.fields) }).eq("id", existing.id).in("status", ["proposed", "in_review"]);
        }
      }
      continue;
    }
    if (live && await rejectedTwin(draft.source_url, draft.title)) live = false;

    // Patch 68: is this another sighting of an opportunity already on file,
    // at a different address? (The same address was caught above.)
    const host = oppHost(draft.source_url);
    const funder = funderKey(typeof draft.fields.agency === "string" ? draft.fields.agency : null);
    if (draft.kind === "grant") {
      const seen: Sighting = { title: draft.title, url: draft.source_url, funder: typeof draft.fields.agency === "string" ? draft.fields.agency : null,
        close_date: typeof draft.fields.close_date === "string" ? draft.fields.close_date : null };
      const twin = findTwin(seen, (await twinCandidates(host, funder)) ?? []);
      if (twin) {
        const also = addSeen(twin.also_seen, { url: draft.source_url, source: from?.label ?? null, at: now }, twin.source_url);
        const grew = also.length !== (Array.isArray(twin.also_seen) ? twin.also_seen.length : 0);
        const changes = changedFacts(twin.fields, draft.fields);
        if (twin.status === "rejected") {
          // A person turned this opportunity down. It is not filed again under a new address.
          console.log("[curated] not filed, rejected before:", draft.title.slice(0, 80));
        } else if (twin.status === "approved") {
          // Approved and live to every client. The sighting is recorded; facts
          // it states differently are proposed as an UPDATE to that entry,
          // never as a second entry, and never published unreviewed.
          // tenant-safe: the shared review queue, one row by id.
          if (grew) await db.from("ledger_overlay").update({ also_seen: also }).eq("id", twin.id);
          if (changes.length && await proposeUpdate(twin, draft)) filed += 1;
        } else {
          // Still waiting. One entry, with this sighting added to it.
          const patch: Record<string, unknown> = {};
          if (grew) patch.also_seen = also;
          if (live && from && twin.signal_source_id && twin.published_at === null) {
            // A first-party source now states it: it goes live with the label, in that source's own words (as for the same address, above).
            Object.assign(patch, { published_at: now, signal_source_id: from.id, fields: draft.fields, title: draft.title.slice(0, 300) });
          } else if (live && twin.published_at && changes.length) {
            // Already live and unreviewed, and the funder's own source states a fact differently: clients read the current one.
            patch.fields = applyChanges(twin.fields, draft.fields);
          }
          // tenant-safe: the shared review queue, one row by id; the status guard keeps a decision made meanwhile.
          if (Object.keys(patch).length) await db.from("ledger_overlay").update(patch).eq("id", twin.id).in("status", ["proposed", "in_review"]);
        }
        continue;
      }
    }
    const row = {
      kind: draft.kind, base_id: null, ein: null,
      opportunity_number: draft.kind === "grant" ? draft.source_url.slice(0, 400) : null,
      title: draft.title.slice(0, 300), fields: draft.fields,
      source_url: draft.source_url || `curated:${listId}:${Date.now()}:${filed}`,
      provenance: "curated_list", curated_list_id: listId, status: "proposed",
      confidence: "low", proposed_by: userId,
    };
    const tiered = { ...row, signal_source_id: from?.id ?? null, published_at: live ? now : null };
    const keyed = draft.kind === "grant" ? { opp_host: host, opp_funder: funder } : {};
    // tenant-safe: the shared review queue (no tenant_id).
    let { error: insErr } = await db.from("ledger_overlay").insert({ ...tiered, ...keyed });
    // Before migration 0101: filed without the keys a later sighting is matched by.
    // tenant-safe: the shared review queue (no tenant_id).
    if (lacks0101(insErr)) ({ error: insErr } = await db.from("ledger_overlay").insert(tiered));
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
 * Screen every client with the Funding page on (patch 68; community members
 * only in patch 67) against the open opportunities the signals sources
 * produced. No model calls. This is what makes review
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

  // Who receives leads from the sources (decided by Shane, 19 Nov 2026):
  // every client whose Funding page is on in Grants mode, which is where
  // these are shown. Community membership still governs the hand-curated
  // lists (sweepCuratedList) and no longer gates this.
  // tenant-safe: For Granted's own fan-out list across clients: which have the Funding page switched on. No client content is read.
  const { data: on, error: onErr } = await db.from("feature_visibility").select("tenant_id").eq("feature_key", "funder_matches").eq("visible", true).limit(1000);
  // tenant-safe: brain flags across all clients, to leave the Brain out of the fan-out.
  const { data: tenants, error: tenantErr } = await db.from("tenant").select("id, is_brain").limit(1000);
  if (onErr || tenantErr) return { ok: false, error: "The client list could not be read. Try again." };
  const fundingOn = new Set(((on ?? []) as { tenant_id: string }[]).map(r => r.tenant_id));
  const members = ((tenants ?? []) as { id: string; is_brain: boolean | null }[])
    .filter(t => t.is_brain !== true && fundingOn.has(t.id)).slice(0, MAX_TENANTS);

  let matches = 0, done = 0, unfinished = false;
  for (const t of members) {
    if (Date.now() > stopAt) { unfinished = true; break; }
    done += 1;
    const p = await getEligibilityProfile(t.id).catch(() => null);
    if (!p || !p.org_type) continue;
    // Every match this client already has (a client's list is short; the entries' ids are not sent, as hundreds of them would outgrow one request).
    const { data: had, error: hadErr } = await db.from("curated_match").select("overlay_id").eq("tenant_id", t.id).limit(5000);
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

const MATCH_WINDOW = 600;
const MACHINE_NOTE = "The exact page was not among the search results: check the link.";
type EntryRow = { id: string; fields: Record<string, unknown>; status: string; published_at?: string | null };
/** Queue entries by id, with the published stamp when migration 0100 is in. */
async function readEntries(ids: string[]): Promise<{ data: EntryRow[] | null }> {
  // tenant-safe: shared overlay entries, read by the ids this tenant's matches point at; client-safe fields only are shipped to the page.
  const out: EntryRow[] = [];
  // A hundred ids at a time, so a long list never outgrows one request.
  for (let i = 0; i < ids.length; i += 100) {
    const read = (cols: string) => db.from("ledger_overlay").select(cols).in("id", ids.slice(i, i + 100));
    let r = await read("id, fields, status, published_at");
    if (lacks0100(r.error)) r = await read("id, fields, status");
    if (r.error) { console.error("[curated] entries not read", r.error.message); return { data: null }; }
    out.push(...((r.data ?? []) as unknown as EntryRow[]));
  }
  return { data: out };
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
  const uuids = [...new Set(ids.filter(i => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i)))].slice(0, 100);
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
  // Read wide, filter, then keep 40 (review of patch 67): the signals screen
  // also writes matches on entries still waiting unseen, and a short window
  // taken first would let those push everything visible off the client's page.
  const { data } = await db.from("curated_match").select("overlay_id, list_id, verdict, swept_at")
    .eq("tenant_id", tenantId).order("swept_at", { ascending: false }).limit(MATCH_WINDOW);
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
      // A list's name and note are For Granted's words about entries it reviewed; an unreviewed row carries neither.
      overlay_id: r.overlay_id, list_id: r.list_id, list_name: seen === "reviewed" ? l.name : "",
      context_note: seen === "reviewed" ? l.context_note : null, swept_at: r.swept_at, verdict: r.verdict,
      title: c.title ?? "Untitled opportunity", funder: c.agency ?? null,
      close_date: c.close_date ?? null, max_award: c.max_award ?? null,
      website: c.website ?? null, notes,
      money_kind: c.money_kind ?? null, terms: c.investment_terms ?? null,
      reviewed: seen === "reviewed",
    });
  }
  // What For Granted has checked comes first; the order within each is unchanged (newest sweep first).
  return [...out.filter(r => r.reviewed), ...out.filter(r => !r.reviewed)].slice(0, 40);
}

/** The membership manager's rows. */
export async function getCommunityMembers(): Promise<{ id: string; name: string; member: boolean }[]> {
  // tenant-safe: names and membership flags across clients are For Granted's own admin list.
  const { data } = await db.from("tenant").select("id, name, community_member, is_brain").order("name").limit(200);
  return ((data ?? []) as { id: string; name: string; community_member: boolean | null; is_brain: boolean | null }[])
    .filter(t => t.is_brain !== true)
    .map(t => ({ id: t.id, name: t.name, member: t.community_member === true }));
}
