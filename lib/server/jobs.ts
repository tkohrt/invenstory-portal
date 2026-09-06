import "server-only";
// Writing and reading job rows.
//
// A plain server module rather than a "use server" one: these take a tenantId
// and must only be called from code that has already decided who is asking.
import { db } from "./db";
import {
  STALL_AFTER_MS, MAX_EVENTS,
  type Job, type JobEvent, type JobEventKind, type JobKind, type JobStatus,
} from "@/lib/job";

interface Row {
  id: string; kind: JobKind; status: JobStatus; label: string | null;
  done: number; total: number; detail: string | null;
  result: Record<string, unknown> | null; error: string | null;
  started_at: string; updated_at: string; finished_at: string | null;
  tenant_id: string;
}

function toJob(r: Row): Job {
  return {
    id: r.id, kind: r.kind, status: r.status, label: r.label,
    done: r.done, total: r.total, detail: r.detail,
    result: r.result, error: r.error,
    startedAt: r.started_at, updatedAt: r.updated_at, finishedAt: r.finished_at,
  };
}

/**
 * Add a line to a job's log.
 *
 * Append-only, and best-effort in exactly the way updateJob is: narration must
 * never be the reason real work fails. A line that does not land is logged and
 * the run carries on.
 *
 * Not awaited by the loops that call it, which is why the ordering key is the
 * table's own sequence rather than a counter this would have to read first.
 */
export async function recordEvent(
  tenantId: string, jobId: string,
  e: { kind: JobEventKind; text: string; done?: number; total?: number },
): Promise<void> {
  const { error } = await db.from("job_event").insert({
    tenant_id: tenantId, job_id: jobId,
    kind: e.kind, text: e.text.slice(0, 500),
    done: e.done ?? null, total: e.total ?? null,
  });
  if (error) console.error("[job] event write failed", error);
}

/**
 * A job's log, oldest first, optionally only what is new.
 *
 * `after` is the id of the last line the caller already has, so a page polling
 * every two seconds fetches the two lines it is missing rather than the whole
 * run every time.
 */
export async function jobEvents(
  tenantId: string, jobId: string, after = 0,
): Promise<JobEvent[]> {
  const { data, error } = await db.from("job_event")
    .select("id, kind, text, done, total, at")
    .eq("tenant_id", tenantId).eq("job_id", jobId).gt("id", after)
    .order("id").limit(MAX_EVENTS);
  if (error) throw new Error(`job log read failed: ${error.message}`);
  return ((data ?? []) as { id: number; kind: JobEventKind; text: string; done: number | null; total: number | null; at: string }[])
    .map(r => ({ id: r.id, kind: r.kind, text: r.text, done: r.done, total: r.total, at: r.at }));
}

export async function createJob(
  tenantId: string, kind: JobKind, label: string, startedBy?: string,
): Promise<string> {
  const { data, error } = await db.from("job")
    .insert({ tenant_id: tenantId, kind, label, started_by: startedBy ?? null })
    .select("id").single();
  if (error) throw new Error(`could not start the job: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Move a job along.
 *
 * Scoped by tenant as well as id rather than carrying a tenant-safe annotation.
 * The id alone would be sufficient and the annotation would have been true, but
 * a real filter cannot be made wrong by a later refactor and an annotation can.
 *
 * Best-effort by design. Progress reporting must never be the reason real work
 * fails, so a write that does not land is logged and swallowed. The heartbeat
 * doubles as the staleness signal, which is why every update touches
 * updated_at.
 */
export async function updateJob(
  tenantId: string, id: string,
  patch: { done?: number; total?: number; detail?: string; label?: string },
): Promise<void> {
  const { error } = await db.from("job")
    .update({ ...patch, updated_at: new Date().toISOString() })
    // Only while still running. These writes are fire-and-forget, so the last
    // one can land after finishJob and would otherwise overwrite the summary
    // with a step name: a finished panel reading "saving the results".
    .eq("status", "running")
    .eq("tenant_id", tenantId).eq("id", id);
  if (error) console.error("[job] progress update failed", error);
}

export async function finishJob(
  tenantId: string, id: string, result: Record<string, unknown>, detail?: string,
): Promise<void> {
  const { error } = await db.from("job")
    .update({
      status: "done", result, detail: detail ?? null,
      updated_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId).eq("id", id);
  if (error) console.error("[job] finish failed", error);
  // The closing line is written here rather than by each caller, because a run
  // whose log simply stops is indistinguishable from one that was killed.
  await recordEvent(tenantId, id, { kind: "done", text: detail ?? "Finished." });
}

/**
 * Mark a job failed.
 *
 * The message reaches a screen, so it is trimmed: raw errors carry table names,
 * constraint text and model identifiers, which tell a reader nothing and say
 * more about the system than it should.
 */
export async function failJob(tenantId: string, id: string, message: string): Promise<void> {
  const { error } = await db.from("job")
    .update({
      status: "failed", error: message.slice(0, 800),
      updated_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId).eq("id", id);
  if (error) console.error("[job] fail-mark failed", error);
  await recordEvent(tenantId, id, { kind: "error", text: message.slice(0, 500) });
}

/** One job, scoped to the tenant asking, so an id from elsewhere reads as absent. */
export async function getJob(tenantId: string, id: string): Promise<Job | null> {
  const { data, error } = await db.from("job")
    .select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new Error(`job read failed: ${error.message}`);
  return data ? toJob(data as Row) : null;
}

/**
 * Work actually in flight, so a page reload rejoins it.
 *
 * Deliberately not "the most recent job". Returning a finished one would put a
 * green "Search finished" banner on the page every time somebody opened it for
 * a run that happened yesterday, a red failure banner on every load until the
 * next run, and would fire a router.refresh on each of those loads. Only a job
 * that is still running, and recent enough not to be presumed dead, is worth
 * rejoining.
 */
export async function latestJob(tenantId: string, kind: JobKind): Promise<Job | null> {
  const since = new Date(Date.now() - STALL_AFTER_MS).toISOString();
  const { data, error } = await db.from("job")
    .select("*").eq("tenant_id", tenantId).eq("kind", kind)
    .eq("status", "running").gte("updated_at", since)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`job read failed: ${error.message}`);
  return data ? toJob(data as Row) : null;
}

/**
 * Take the lease on a job, or fail to.
 *
 * A chained build is continued by whichever tab is polling, and two tabs would
 * otherwise read the same documents twice: same cost, same time, no benefit.
 * The claim is conditional, so exactly one continuation proceeds.
 *
 * The lease expires on its own. An invocation killed at the function limit
 * cannot release its claim, and a job that could never be continued again would
 * be worse than a little duplicated work.
 */
const LEASE_MS = 90_000;

export async function claimJob(tenantId: string, id: string): Promise<boolean> {
  const now = new Date();
  const expiry = new Date(now.getTime() - LEASE_MS).toISOString();
  const { data, error } = await db.from("job")
    .update({ claimed_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("tenant_id", tenantId).eq("id", id).eq("status", "running")
    .or(`claimed_at.is.null,claimed_at.lt.${expiry}`)
    .select("id");
  if (error) { console.error("[job] claim failed", error); return false; }
  return (data ?? []).length > 0;
}

export async function releaseJob(tenantId: string, id: string): Promise<void> {
  const { error } = await db.from("job")
    .update({ claimed_at: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", id);
  if (error) console.error("[job] release failed", error);
}
