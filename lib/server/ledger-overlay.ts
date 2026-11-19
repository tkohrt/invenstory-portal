import "server-only";
// Funder Ledger — the living overlay (reads + the base/overlay merge).
//
// The Ledger base is a frozen June 2026 snapshot served by a separate
// read-only service; it is never mutated. This module reads For Granted's
// writable overlay and merges it over base results so a verified FG record
// beats the stale one and brand-new FG finds join the candidate set.
//
// Read paths, and why they differ:
//   - Queue/admin reads go through userClient(), so the admin-only RLS policy
//     on ledger_overlay is the gate.
//   - getApprovedOverlay() must go through the service-role client. The whole
//     point of the overlay is to correct what CLIENTS see in matching, and a
//     client session reads zero rows under that same admin-only policy. So the
//     rows are fetched with service role and the FG-internal fields are
//     stripped unless the caller explicitly asks to reveal them.
import { userClient } from "./supabase";
import { db } from "./db";
import type {
  LedgerOverlayRow, OverlayQueueRow, OverlayStatus, LedgerScoutRun,
} from "@/lib/types";
import { needsReviewNow, type Demand } from "@/lib/trust";
import { changedFacts, changeLine } from "@/lib/opportunity";
// The merge itself is pure and lives outside server-only so it can be unit
// tested; re-exported here so callers have one import for the overlay.
export { mergeOverlay, OVERLAY_ID_PREFIX } from "@/lib/ledger-merge";
export type { LedgerRecord, MergedRecord, MergeOptions } from "@/lib/ledger-merge";

type WithJoins = LedgerOverlayRow & {
  tenant: { name: string } | null;
  proposer: { full_name: string; role: string } | null;
  source?: { label: string; kind: string; trust: string } | null;
};

// Both FK embeds are addressed by column name, which is also what disambiguates
// proposed_by from reviewed_by (two FKs to app_user).
const QUEUE_SELECT = "*, tenant:surfaced_for_tenant(name), proposer:proposed_by(full_name, role)";
// Patch 67 (0100): the signals source an entry was read from, for the queue's labels.
const QUEUE_SELECT_SOURCED = `${QUEUE_SELECT}, source:signal_source_id(label, kind, trust)`;

function shape({ source, ...r }: WithJoins): OverlayQueueRow {
  return {
    ...r,
    source_label: source?.label ?? null,
    source_trust: source?.trust === "first_party" ? "first_party" : source ? "review" : null,
    tenant_name: r.tenant?.name ?? null,
    proposed_by_name: r.proposer?.full_name ?? null,
    proposed_by_role: (r.proposer?.role as "client" | "admin" | undefined) ?? null,
  };
}

// PostgREST caps rows; an unbounded read would silently drop corrections.
const MAX_OVERLAY_ROWS = 5000;

/** Rows awaiting a decision, newest first. Drives the admin review queue. */
export async function getOverlayQueue(
  statuses: OverlayStatus[] = ["proposed", "in_review"],
): Promise<OverlayQueueRow[]> {
  const s = await userClient();
  const read = (cols: string) => s.from("ledger_overlay")
    .select(cols)
    .in("status", statuses)
    .order("created_at", { ascending: false });
  let { data, error } = await read(QUEUE_SELECT_SOURCED);
  // Before migration 0100 there is no source column to follow: read as before.
  if (error && /signal_source/i.test(error.message)) ({ data, error } = await read(QUEUE_SELECT));
  // Never swallow this. An empty queue and a broken query look identical on
  // screen, and "nothing to review" is the most dangerous thing this page can
  // say incorrectly.
  if (error) throw new Error(`overlay queue read failed: ${error.message}`);
  const rows = ((data ?? []) as unknown as WithJoins[]).map(shape);
  // Patch 68: an update row says what it would change on the approved entry it points at.
  const targets = [...new Set(rows.map(r => r.update_of).filter((x): x is string => !!x))];
  if (targets.length) {
    const on = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < targets.length; i += 100) {
      const { data: t } = await s.from("ledger_overlay").select("id, fields").in("id", targets.slice(i, i + 100));
      for (const x of (t ?? []) as { id: string; fields: Record<string, unknown> }[]) on.set(x.id, x.fields);
    }
    for (const r of rows) if (r.update_of) r.update_changes = changedFacts(on.get(r.update_of), r.fields).map(changeLine);
  }
  return rows;
}

/**
 * Who is waiting on each queue entry (patch 67): how many clients it was
 * screened as a fit for, how many follow it, how many asked For Granted to
 * start a draft. Counts only, for For Granted's own queue; the page that
 * calls this is admin-only. A failed read counts as nobody, so the queue
 * still draws.
 */
export async function getQueueDemand(ids: string[]): Promise<Record<string, Demand>> {
  const out: Record<string, Demand> = {};
  if (!ids.length) return out;
  const at = (id: string) => (out[id] ??= { matched: 0, followed: 0, asked: 0 });
  const uniq = (rows: { k: string; t: string | null }[]) => [...new Set(rows.map(r => `${r.k}|${r.t ?? ""}`))].map(x => x.split("|")[0]);
  // A hundred ids at a time: a long queue's ids in one request would outgrow the address it is sent in.
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const [m, f, a] = await Promise.all([
      // tenant-safe: an admin-only count across clients of who each shared entry was matched to; no client content is read.
      db.from("curated_match").select("overlay_id, tenant_id").in("overlay_id", part).limit(5000),
      // tenant-safe: an admin-only count across clients of who follows each shared entry; no client content is read.
      db.from("saved_item").select("target_id, tenant_id").eq("kind", "grant").in("target_id", part).limit(5000),
      // tenant-safe: an admin-only count of open draft requests per shared entry; the inbox itself is admin-only.
      db.from("client_request").select("source_key, tenant_id").eq("status", "open").in("source_key", part.map(x => `draft:${x}`)).limit(5000),
    ]);
    // Said in the log, never silently zero: a failed count would fold away entries clients are waiting on.
    for (const r of [m, f, a]) if (r.error) console.error("[overlay] queue demand not read", r.error.message);
    for (const id of uniq(((m.data ?? []) as { overlay_id: string; tenant_id: string }[]).map(r => ({ k: r.overlay_id, t: r.tenant_id })))) at(id).matched += 1;
    for (const id of uniq(((f.data ?? []) as { target_id: string; tenant_id: string }[]).map(r => ({ k: r.target_id, t: r.tenant_id })))) at(id).followed += 1;
    for (const id of uniq(((a.data ?? []) as { source_key: string; tenant_id: string | null }[]).map(r => ({ k: r.source_key.replace(/^draft:/, ""), t: r.tenant_id })))) at(id).asked += 1;
  }
  return out;
}

/** Recently decided rows, for the "what did we just do" tail under the queue. */
export async function getOverlayDecided(limit = 25): Promise<OverlayQueueRow[]> {
  const s = await userClient();
  const { data, error } = await s.from("ledger_overlay")
    .select(QUEUE_SELECT)
    .in("status", ["approved", "rejected", "superseded"])
    // A person's decisions only (patch 69): entries that closed themselves at their deadline have no reviewer and would crowd these out.
    .not("reviewed_by", "is", null)
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`overlay history read failed: ${error.message}`);
  return ((data ?? []) as WithJoins[]).map(shape);
}

export async function getLastScoutRun(): Promise<LedgerScoutRun | null> {
  const s = await userClient();
  const { data, error } = await s.from("ledger_scout_run")
    .select("*").order("ran_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`scout run read failed: ${error.message}`);
  return (data as LedgerScoutRun) ?? null;
}

/**
 * Count for the sidebar badge: what needs a person now (patch 67). Everything
 * that came in by hand, from a client or the web search counts as before. An
 * entry from a watched source counts only when a client is waiting on it
 * (matched, following or asked); the rest sit in the queue's folded bands.
 * Before migration 0100 it is the plain count it always was.
 */
export async function getOverlayPendingCount(): Promise<number> {
  const s = await userClient();
  const { data, error } = await s.from("ledger_overlay")
    .select("id, published_at, signal_source_id")
    .in("status", ["proposed", "in_review"]).limit(2000);
  if (error) {
    const { count, error: countErr } = await s.from("ledger_overlay")
      .select("id", { count: "exact", head: true })
      .in("status", ["proposed", "in_review"]);
    if (countErr) throw new Error(`overlay count read failed: ${countErr.message}`);
    return count ?? 0;
  }
  const rows = (data ?? []) as { id: string; published_at: string | null; signal_source_id: string | null }[];
  const sourced = rows.filter(r => r.signal_source_id).map(r => r.id);
  const demand = sourced.length ? await getQueueDemand(sourced).catch(() => ({})) : {};
  return needsReviewNow(rows, demand);
}

/**
 * Every approved row of a kind, for the merge below.
 *
 * Service-role read: the overlay's admin-only RLS policy would return nothing
 * for a client session, which is exactly the session that needs the correction
 * applied. Ordered and bounded so a truncated response is deterministic rather
 * than an arbitrary subset.
 */
export async function getApprovedOverlay(kind: "funder" | "grant"): Promise<LedgerOverlayRow[]> {
  // tenant-safe: ledger_overlay carries no tenant_id — it is For Granted IP
  // shared across all clients by design (see 0019_ledger_overlay.sql). Callers
  // must pass reveal:false for client-facing surfaces so FG-internal fields are
  // stripped in mergeOverlay below.
  const { data, error } = await db.from("ledger_overlay")
    .select("*").eq("kind", kind).eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(MAX_OVERLAY_ROWS);
  if (error) throw new Error(`approved overlay read failed: ${error.message}`);
  return (data ?? []) as LedgerOverlayRow[];
}

