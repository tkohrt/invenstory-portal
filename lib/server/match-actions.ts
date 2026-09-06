"use server";
// Funder matching actions. Running a match is a real outbound call to the
// Ledger service and writes the per-tenant verdict cache, so it is admin-only
// for now: the feature is hidden from every client by default and For Granted
// runs it on their behalf.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";

// Running a match and rebuilding the Search Profile moved to POST
// /api/jobs/match and /api/jobs/search-profile. Both can outlive the limit a
// server action gets, and both now report progress to a job row the page polls,
// so a slow run is legible instead of a dead spinner.

/** Clear the cache for the active tenant, so a stale run can't linger. */
export async function clearMatchesAction() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  // Both halves of a run, or "Clear" would leave the funder list standing as
  // though it were current while the grants vanished.
  await db.from("eligible_grant").delete().eq("tenant_id", s.tenantId);
  await db.from("matched_funder").delete().eq("tenant_id", s.tenantId);
  revalidatePath("/funder-matches");
}
