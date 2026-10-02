// Is a Card Library build running for this client, and how long is left? Or
// did one finish recently?
//
// Polled by the notice at the top of every portal page (components/BuildNotice),
// so a build started on the Card Library page stays visible after leaving it,
// and the person hears when it is done. A client sees this only while Story
// Cards is turned on for them, and then only counts, never the build's log.
//
// It also keeps a build alive. The server hands each stage to the next, but a
// hand-off can be lost (a function killed at its limit, a cold start that
// times out). A running build that has gone quiet for a while is picked up
// again here, by whoever has the portal open, from where it stopped.
import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { getFeatureVisible } from "@/lib/server/data";
import { estimateRemainingMs, STALL_AFTER_MS } from "@/lib/job";
import { MAX_CHAIN_PASSES, scheduleCardPass, scheduleAnalysisPass } from "@/lib/server/job-chain";

/** Quiet this long, and the hand-off is presumed lost: longer than one stage plus its hand-off. */
const REVIVE_AFTER_MS = 100_000;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const tenantId = session.tenantId;
  // An Inven(s)tory Analysis trial run (admin-only in Phase A) is kept alive the
  // same way, without being reported here: its own page shows its progress.
  if (session.role === "admin") await reviveAnalysis(req, tenantId);
  if (session.role !== "admin" && !(await getFeatureVisible(tenantId, "card_review"))) {
    return NextResponse.json({ running: null, finished: null });
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: jobs } = await db.from("job")
    .select("id, status, done, total, started_at, updated_at, finished_at, result, error, chain_passes")
    .eq("tenant_id", tenantId).eq("kind", "cards")
    .or(`status.eq.running,finished_at.gte.${since}`)
    .order("started_at", { ascending: false }).limit(3);
  type J = { id: string; status: string; done: number; total: number; started_at: string; updated_at: string;
    finished_at: string | null; result: Record<string, number> | null; error: string | null; chain_passes: number };
  const list = (jobs ?? []) as J[];
  const now = Date.now();
  const live = list.find(j => j.status === "running" && now - new Date(j.updated_at).getTime() < STALL_AFTER_MS);

  let running = null;
  if (live) {
    const { data: ev } = await db.from("job_event").select("at")
      .eq("tenant_id", tenantId).eq("job_id", live.id).in("kind", ["progress", "skip"])
      .order("at", { ascending: false }).limit(6);
    const times = ((ev ?? []) as { at: string }[]).map(e => e.at).reverse();
    const etaMs = estimateRemainingMs({
      done: live.done, total: live.total,
      startedAt: times.length > 1 ? times[0] : live.started_at,
      unitTimes: times.length > 1 ? times.slice(1) : times,
    });
    const quietMs = now - new Date(live.updated_at).getTime();
    if (quietMs > REVIVE_AFTER_MS && live.chain_passes < MAX_CHAIN_PASSES) {
      const origin = new URL(req.url).origin;
      after(async () => { await scheduleCardPass(origin, tenantId, live.id); });
    }
    running = { jobId: live.id, done: live.done, total: live.total, startedAt: live.started_at, etaMs, resuming: quietMs > REVIVE_AFTER_MS };
  }

  const last = list.find(j => j.status !== "running" && j.finished_at);
  const finished = last && !live ? {
    jobId: last.id, status: last.status, finishedAt: last.finished_at,
    created: Number(last.result?.created ?? 0), cards: Number(last.result?.cards ?? 0),
    sensitive: Number(last.result?.sensitive ?? 0),
    // The failure text is For Granted's to read; a client is told only that it stopped.
    error: session.role === "admin" ? last.error : null,
  } : null;

  return NextResponse.json({ running, finished });
}

/** Pick up a running analysis whose hand-off was lost. Never throws. */
async function reviveAnalysis(req: Request, tenantId: string): Promise<void> {
  try {
    const { data } = await db.from("job").select("id, updated_at, chain_passes")
      .eq("tenant_id", tenantId).eq("kind", "analysis").eq("status", "running")
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return;
    const quietMs = Date.now() - new Date(data.updated_at as string).getTime();
    if (quietMs > REVIVE_AFTER_MS && quietMs < STALL_AFTER_MS && (data.chain_passes as number) < MAX_CHAIN_PASSES) {
      const origin = new URL(req.url).origin;
      after(async () => { await scheduleAnalysisPass(origin, tenantId, data.id as string); });
    }
  } catch (e) {
    console.error("[active] analysis revive check failed", e);
  }
}
