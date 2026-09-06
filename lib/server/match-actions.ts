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
import { rebuildSearchProfileAction } from "./search-profile-extract";

export async function runMatchAction(opts: { multiQuery?: boolean } = {}) {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  const tenant = await getTenant(s.tenantId);
  const result = await runMatch(s.tenantId, tenant?.name ?? "the organization", { ...opts, ranBy: s.user.id });

  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: s.tenantId, action: "ledger_match",
    detail: `${result.grants.length} kept, ${result.dropped} dropped, ${result.funders.length} funders`
      + `, ${result.usedProfile ? "Inven(s)tory" : "eligibility profile"}`
      + `, ${result.queries.length} quer${result.queries.length === 1 ? "y" : "ies"}`,
  });
  revalidatePath("/funder-matches");
  return {
    kept: result.grants.length, dropped: result.dropped,
    funders: result.funders.length, evidence: result.evidence.length,
    usedProfile: result.usedProfile, profileNote: result.profileNote,
    queries: result.queries,
  };
}

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

/**
 * Rebuild the Search Profile for the active client.
 *
 * Separate from running a match on purpose: it is an LLM pass over the whole
 * Inven(s)tory, it changes only when documents change, and a match should not
 * wait on it.
 */
export async function rebuildProfileAction() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  const r = await rebuildSearchProfileAction(s.tenantId);
  revalidatePath("/funder-matches");
  return {
    note: r.note, usable: r.usable,
    scanned: r.scanned, skipped: r.skipped, silent: r.silent,
    factCount: r.profile.facts.length,
  };
}
