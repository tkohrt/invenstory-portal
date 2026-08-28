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
// The merge itself is pure and lives outside server-only so it can be unit
// tested; re-exported here so callers have one import for the overlay.
export { mergeOverlay, OVERLAY_ID_PREFIX } from "@/lib/ledger-merge";
export type { LedgerRecord, MergedRecord, MergeOptions } from "@/lib/ledger-merge";

type WithJoins = LedgerOverlayRow & {
  tenant: { name: string } | null;
  proposer: { full_name: string; role: string } | null;
};

// Both FK embeds are addressed by column name, which is also what disambiguates
// proposed_by from reviewed_by (two FKs to app_user).
const QUEUE_SELECT = "*, tenant:surfaced_for_tenant(name), proposer:proposed_by(full_name, role)";

function shape(r: WithJoins): OverlayQueueRow {
  return {
    ...r,
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
  const { data, error } = await s.from("ledger_overlay")
    .select(QUEUE_SELECT)
    .in("status", statuses)
    .order("created_at", { ascending: false });
  // Never swallow this. An empty queue and a broken query look identical on
  // screen, and "nothing to review" is the most dangerous thing this page can
  // say incorrectly.
  if (error) throw new Error(`overlay queue read failed: ${error.message}`);
  return ((data ?? []) as WithJoins[]).map(shape);
}

/** Recently decided rows, for the "what did we just do" tail under the queue. */
export async function getOverlayDecided(limit = 25): Promise<OverlayQueueRow[]> {
  const s = await userClient();
  const { data, error } = await s.from("ledger_overlay")
    .select(QUEUE_SELECT)
    .in("status", ["approved", "rejected", "superseded"])
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

/** Count for the sidebar badge. Cheap: head-only. */
export async function getOverlayPendingCount(): Promise<number> {
  const s = await userClient();
  const { count, error } = await s.from("ledger_overlay")
    .select("id", { count: "exact", head: true })
    .in("status", ["proposed", "in_review"]);
  if (error) throw new Error(`overlay count read failed: ${error.message}`);
  return count ?? 0;
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

