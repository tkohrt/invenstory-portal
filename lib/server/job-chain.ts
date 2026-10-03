import "server-only";
// Letting a long build carry on without the page that started it.
//
// A function on the Hobby plan stops at 60 seconds and a Card Library build is
// minutes, so the work runs in stages. Until 1 October 2026 the BROWSER called
// each stage, which meant closing the page paused the build. Now each stage,
// as its last act, asks the server to run the next one, so the build carries on
// whoever is watching.
//
// The next stage is called over HTTP with no session, so it is authorised by a
// signature instead: an HMAC of the job and its client, keyed with a secret
// only the server holds. A signature names exactly one job of exactly one
// client, and the continuation still checks the job is running and has not
// exceeded its stage ceiling, so a leaked signature can at most continue the
// build it was made for.
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { chainStalled } from "@/lib/job";

function secret(): string {
  const k = process.env.JOB_CHAIN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("No server secret is configured to sign build continuations.");
  return k;
}

/**
 * Which chain a signature is for. A Card Library signature cannot continue an
 * analysis, or the reverse: the scope is part of what is signed.
 */
export type ChainScope = "card-chain" | "analysis-chain";

export function signChain(tenantId: string, jobId: string, scope: ChainScope = "card-chain"): string {
  return createHmac("sha256", secret()).update(`${scope}:v1:${tenantId}:${jobId}`).digest("hex");
}

export function verifyChain(tenantId: string, jobId: string, sig: string, scope: ChainScope = "card-chain"): boolean {
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const want = Buffer.from(signChain(tenantId, jobId, scope), "hex");
  const got = Buffer.from(sig, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Most stages one build may chain: a 60-document Inven(s)tory needs about 25. */
export const MAX_CHAIN_PASSES = 60;

/**
 * Ask the server to run the next stage of a Card Library build.
 *
 * Waits only for the continuation to ACCEPT (it answers at once and does its
 * work after answering), so this costs the caller a second or two, not a stage.
 * Never throws: a continuation that cannot be started leaves the job to look
 * stalled, and the next visit to the portal restarts it (see /api/jobs/active).
 */
export async function scheduleCardPass(origin: string, tenantId: string, jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/jobs/cards/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, jobId, sig: signChain(tenantId, jobId) }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) console.error(`[chain] continuation refused: ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("[chain] could not schedule the next stage", e);
    return false;
  }
}

/** The same, for an Inven(s)tory Analysis run (lib/server/analysis-build.ts). */
export async function scheduleAnalysisPass(origin: string, tenantId: string, jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/jobs/analysis/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, jobId, sig: signChain(tenantId, jobId, "analysis-chain") }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) console.error(`[chain] analysis continuation refused: ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("[chain] could not schedule the next analysis stage", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Picking a chain back up.
// ---------------------------------------------------------------------------

/**
 * Found on 3 October 2026: Vercel refuses a request that a function makes to
 * its own deployment once the chain of such requests is a few hops deep. It
 * answers 508 (loop detected), so a build carried stage to stage by the server
 * alone stops after about three stages. A request that starts in a browser
 * starts a fresh chain, so every portal page that polls /api/jobs/active also
 * restarts any chain that has stopped, through this.
 *
 * Stopped means: running, no stage holds the lease, and nothing has happened
 * for a while (a stage hands on within a second or two of releasing), or a
 * stage holds a lease that has expired (it was killed at the time limit). The
 * job's updated_at is bumped with a compare-and-set first, so several pages
 * polling at once restart it once, not several times.
 */

export async function reviveStalledChains(origin: string, scope: { tenantId: string } | { allTenants: true }): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    let q = db.from("job")  // tenant-safe: scoped to one tenant below, or every tenant only for an admin session (the caller decides)
      .select("id, tenant_id, kind, updated_at, claimed_at, chain_passes")
      .in("kind", ["cards", "analysis"]).eq("status", "running").gte("started_at", since)
      .order("started_at", { ascending: false });
    if ("tenantId" in scope) q = q.eq("tenant_id", scope.tenantId);
    const { data, error } = await q.limit(20);
    if (error) { console.error("[chain] revive read failed", error.message); return 0; }
    const now = Date.now();
    let revived = 0;
    // Only the newest running job of each kind per client. An older one left
    // "running" by a lost chain was superseded when a new run started, and
    // reviving it too would read the same documents twice.
    const newest = new Set<string>();
    for (const j of (data ?? []) as { id: string; tenant_id: string; kind: string; updated_at: string; claimed_at: string | null; chain_passes: number }[]) {
      const key = `${j.tenant_id}|${j.kind}`;
      if (newest.has(key)) continue;
      newest.add(key);
      if ((j.chain_passes ?? 0) >= MAX_CHAIN_PASSES) continue;
      if (!chainStalled({ updatedAt: j.updated_at, claimedAt: j.claimed_at }, now)) continue;
      // Compare-and-set, so only one poller restarts it.
      const { data: won } = await db.from("job").update({ updated_at: new Date().toISOString() })
        .eq("tenant_id", j.tenant_id).eq("id", j.id).eq("status", "running").eq("updated_at", j.updated_at).select("id");
      if (!(won ?? []).length) continue;
      const ok = j.kind === "analysis"
        ? await scheduleAnalysisPass(origin, j.tenant_id, j.id)
        : await scheduleCardPass(origin, j.tenant_id, j.id);
      if (ok) revived += 1;
    }
    return revived;
  } catch (e) {
    console.error("[chain] revive failed", e);
    return 0;
  }
}

/** Is an analysis running for this client (or, for an admin, any client)? For the notice's poll rate. */
export async function analysisRunning(scope: { tenantId: string } | { allTenants: true }): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  let q = db.from("job")  // tenant-safe: scoped to one tenant below, or every tenant only for an admin session
    .select("id", { count: "exact", head: true }).eq("kind", "analysis").eq("status", "running").gte("started_at", since);
  if ("tenantId" in scope) q = q.eq("tenant_id", scope.tenantId);
  const { count } = await q;
  return (count ?? 0) > 0;
}
