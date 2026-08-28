"use server";
// Funder matching actions. Running a match is a real outbound call to the
// Ledger service and writes the per-tenant verdict cache, so it is admin-only
// for now: the feature is hidden from every client by default and For Granted
// runs it on their behalf.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { getTenant } from "./data";
import { db } from "./db";
import { runMatch } from "./matching";

export async function runMatchAction() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  const tenant = await getTenant(s.tenantId);
  const result = await runMatch(s.tenantId, tenant?.name ?? "the organization");

  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: s.tenantId, action: "ledger_match",
    detail: `${result.grants.length} kept, ${result.dropped} dropped`,
  });
  revalidatePath("/funder-matches");
  return {
    kept: result.grants.length, dropped: result.dropped,
    funders: result.funders.length, evidence: result.evidence.length,
  };
}

/** Clear the cache for the active tenant, so a stale run can't linger. */
export async function clearMatchesAction() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  await db.from("eligible_grant").delete().eq("tenant_id", s.tenantId);
  revalidatePath("/funder-matches");
}
