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
