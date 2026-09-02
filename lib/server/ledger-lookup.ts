"use server";
// Funder lookup for the "Record a verification" picker.
//
// Two jobs in one round trip: find candidates by name, and say which Ground
// Truth state each is in. Doing it in one call keeps the picker responsive and
// means the badge can never disagree with the row it sits on.
import { getSession } from "./session";
import { db } from "./db";
import { lookupFunder, getFunder, LedgerUnavailable } from "./ledger";
import { resolveGroundTruthStatus, type GroundTruthStatus, type StatusRow } from "@/lib/ledger-status";
import { funderProfileFromPayload } from "@/lib/ledger-envelope";
import type { FunderCandidate } from "./ledger";

async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

export interface PickerResult extends FunderCandidate { status: GroundTruthStatus }

export interface LookupResponse {
  ok: boolean;
  results: PickerResult[];
  /** Set when the service could not be reached, so the form can fall back. */
  unavailable?: string;
}

export async function searchLedgerFundersAction(name: string): Promise<LookupResponse> {
  await requireAdmin();
  const q = name.trim();
  if (q.length < 3) return { ok: true, results: [] };

  let candidates: FunderCandidate[] = [];
  try {
    candidates = (await lookupFunder(q)).results;
  } catch (e) {
    // Never block a verification on an outage. The form falls back to manual
    // id entry, which is exactly what someone needs when they have a funder's
    // programme officer on the phone and the service is asleep.
    return {
      ok: false, results: [],
      unavailable: e instanceof LedgerUnavailable
        ? e.message
        : "Could not reach Ground Truth to search. You can still enter a record id by hand.",
    };
  }
  if (!candidates.length) return { ok: true, results: [] };

  const eins = candidates.map(c => c.ein).filter(Boolean);
  // tenant-safe: ledger_overlay is admin-only For Granted IP with no tenant_id
  // (see 0019_ledger_overlay.sql); this read is gated by requireAdmin above.
  const { data } = await db.from("ledger_overlay")
    .select("id, base_id, ein, status, reviewed_at, app_user:reviewed_by(full_name)")
    .eq("kind", "funder")
    .or(`base_id.in.(${eins.join(",")}),ein.in.(${eins.join(",")})`);

  const rows: StatusRow[] = ((data ?? []) as unknown as (StatusRow & { app_user: { full_name: string } | null })[])
    .map(r => ({ ...r, reviewer_name: r.app_user?.full_name ?? null }));

  const statuses = resolveGroundTruthStatus(eins, rows);
  return {
    ok: true,
    results: candidates.map(c => ({ ...c, status: statuses[c.ein] ?? { state: "base" } })),
  };
}

export interface FunderPrefill {
  ein: string; name?: string; website?: string; location?: string;
  focus?: string; typical_grant_range?: string; mission?: string;
  unavailable?: string;
}

/** Full profile for the confirm step, so nobody attaches a correction blind. */
export async function getLedgerFunderAction(ein: string): Promise<FunderPrefill> {
  await requireAdmin();
  try {
    // get_funder answers with one object, not a list, so read the raw payload.
    return funderProfileFromPayload(ein, (await getFunder(ein)).raw);
  } catch (e) {
    return { ein, unavailable: e instanceof Error ? e.message : "Could not load this profile." };
  }
}
