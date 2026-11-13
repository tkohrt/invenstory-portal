import "server-only";
// Curated list sweeps (P2.5, patch 39): For Granted loads a list once, the
// entries ride the existing Ground Truth review queue, and a sweep screens
// every community-member tenant against what was approved. No model calls in
// the sweep itself; the one model call is parsing the pasted list.
import { db } from "./db";
import { chatComplete } from "./llm";
import { getEligibilityProfile } from "./eligibility";
import { screenGrant } from "@/lib/grant-screen";
import { parseLeads, overlayDraft } from "@/lib/web-discovery";
import { CURATED_PARSE_SYSTEM, curatedParseUser, curatedLeads, curatedCard, type CuratedMatchRow } from "@/lib/curated";

const MAX_ENTRIES = 50;
const MAX_TENANTS = 60;

export interface CuratedListRow {
  id: string; name: string; source_url: string | null; context_note: string | null;
  created_at: string; swept_at: string | null;
  proposed: number; approved: number; rejected: number; matches: number; tenants: number;
}

/** Parse a pasted list and file each entry as a Ground Truth proposal. */
export async function createCuratedList(a: {
  name: string; sourceUrl: string | null; contextNote: string | null; pasted: string; userId: string;
}): Promise<{ ok: true; listId: string; entries: number } | { ok: false; error: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await chatComplete({
    system: CURATED_PARSE_SYSTEM, user: curatedParseUser(a.pasted.slice(0, 20_000), today),
    maxTokens: 4000, temperature: 0,
  });
  if (!res?.text) return { ok: false, error: "The list could not be parsed right now (AI parsing is unavailable in this environment). Try again, or file the entries one at a time with Record a verification." };
  const leads = curatedLeads(parseLeads(res.text), today).slice(0, MAX_ENTRIES);
  if (!leads.length) return { ok: false, error: "No opportunities could be read from that text. Paste the list itself (titles, funders, links, deadlines)." };

  // tenant-safe: curated_list is For Granted's shared, admin-only record with no tenant_id.
  const { data: list, error } = await db.from("curated_list").insert({
    name: a.name.slice(0, 200), source_url: a.sourceUrl?.slice(0, 1000) || null,
    context_note: a.contextNote?.slice(0, 4000) || null, created_by: a.userId,
  }).select("id").single();
  if (error || !list) return { ok: false, error: "The list could not be saved. Has migration 0087 been applied?" };
  const listId = (list as { id: string }).id;

  let filed = 0;
  for (const l of leads) {
    const draft = overlayDraft(l, []);
    // tenant-safe: ledger_overlay is For Granted's shared review queue (no tenant_id); deduped by the page's URL. An entry with no URL has nothing to dedupe on.
    const { data: existing } = draft.source_url
      ? await db.from("ledger_overlay").select("id, curated_list_id").eq("source_url", draft.source_url).limit(1).maybeSingle()
      : { data: null };
    if (existing) {
      const ex = existing as { id: string; curated_list_id: string | null };
      // Already known: tie it to this list too, so the sweep can carry it.
      if (!ex.curated_list_id) await db.from("ledger_overlay").update({ curated_list_id: listId }).eq("id", ex.id);
      continue;
    }
    const { error: insErr } = await db.from("ledger_overlay").insert({
      kind: draft.kind, base_id: null, ein: null,
      opportunity_number: draft.kind === "grant" ? draft.source_url.slice(0, 400) : null,
      title: draft.title.slice(0, 300), fields: draft.fields,
      source_url: draft.source_url || `curated:${listId}:${filed}`,
      provenance: "curated_list", curated_list_id: listId, status: "proposed",
      confidence: "low", proposed_by: a.userId,
    });
    if (insErr) console.error("[curated] entry not filed", insErr.message);
    else filed += 1;
  }
  return { ok: true, listId, entries: filed };
}

/** Screen every community member against a list's approved entries. */
export async function sweepCuratedList(listId: string): Promise<{ ok: true; entries: number; tenants: number; matches: number; skipped: number } | { ok: false; error: string }> {
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
  for (const t of members) {
    const p = await getEligibilityProfile(t.id).catch(() => null);
    if (!p || !p.org_type) continue;
    for (const e of grants) {
      const s = screenGrant({ ...curatedCard(e.fields), id: e.id } as Parameters<typeof screenGrant>[0], p, today);
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
  return { ok: true, entries: grants.length, tenants: members.length, matches, skipped };
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

/** What this client was matched with, newest sweep first. Open entries only. */
export async function getCuratedMatches(tenantId: string): Promise<CuratedMatchRow[]> {
  const { data } = await db.from("curated_match").select("overlay_id, list_id, verdict, swept_at")
    .eq("tenant_id", tenantId).order("swept_at", { ascending: false }).limit(40);
  const rows = (data ?? []) as { overlay_id: string; list_id: string; verdict: string; swept_at: string }[];
  if (!rows.length) return [];
  const [{ data: entries }, { data: lists }] = await Promise.all([
    // tenant-safe: shared overlay entries, read by the ids this tenant's matches point at; client-safe fields only are shipped below.
    db.from("ledger_overlay").select("id, fields, status").in("id", [...new Set(rows.map(r => r.overlay_id))]),
    // tenant-safe: shared curated lists, read by id.
    db.from("curated_list").select("id, name, context_note").in("id", [...new Set(rows.map(r => r.list_id))]),
  ]);
  const byEntry = new Map(((entries ?? []) as { id: string; fields: Record<string, unknown>; status: string }[]).map(e => [e.id, e]));
  const byList = new Map(((lists ?? []) as { id: string; name: string; context_note: string | null }[]).map(l => [l.id, l]));
  const today = new Date().toISOString().slice(0, 10);
  const out: CuratedMatchRow[] = [];
  for (const r of rows) {
    const e = byEntry.get(r.overlay_id);
    const l = byList.get(r.list_id);
    if (!e || e.status !== "approved" || !l) continue;  // superseded or withdrawn entries drop out
    const c = curatedCard(e.fields);
    if (c.close_date && c.close_date < today) continue; // closed since the sweep
    const notes = typeof e.fields.notes === "string" ? e.fields.notes : null;
    out.push({
      overlay_id: r.overlay_id, list_id: r.list_id, list_name: l.name,
      context_note: l.context_note, swept_at: r.swept_at, verdict: r.verdict,
      title: c.title ?? "Untitled opportunity", funder: c.agency ?? null,
      close_date: c.close_date ?? null, max_award: c.max_award ?? null,
      website: c.website ?? null, notes,
    });
  }
  return out;
}

/** The membership manager's rows. */
export async function getCommunityMembers(): Promise<{ id: string; name: string; member: boolean }[]> {
  // tenant-safe: names and membership flags across clients are For Granted's own admin list.
  const { data } = await db.from("tenant").select("id, name, community_member, is_brain").order("name").limit(200);
  return ((data ?? []) as { id: string; name: string; community_member: boolean | null; is_brain: boolean | null }[])
    .filter(t => t.is_brain !== true)
    .map(t => ({ id: t.id, name: t.name, member: t.community_member === true }));
}
