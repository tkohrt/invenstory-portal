import "server-only";
// One stage of a Card Library build, shared by the page's route and the
// server's own continuation (lib/server/job-chain.ts).
//
// Takes the job's lease, reads what fits, keeps it, and says what is left. A
// stage that finishes the build assembles the library and closes the job. A
// stage that reads nothing while documents are outstanding ends the build as
// failed rather than chaining forever.
import { db } from "./db";
import { getTenant } from "./data";
import { continueCardBuild, cardBuildProgress, type MergeSummary } from "./card-extract";
import { claimJob, failJob, finishJob, recordEvent, releaseJob, updateJob } from "./jobs";
import { MAX_CHAIN_PASSES } from "./job-chain";

export const describeMerge = (m: MergeSummary) =>
  `${m.cards} live card(s): ${m.created} new, ${m.revived} restored, ${m.retired} retired `
  + `for lack of evidence, ${m.duplicates} possible duplicate(s) flagged for review`
  + (m.sensitive ? `, ${m.sensitive} sensitive card(s) awaiting a decision.` : ".");

export type PassOutcome =
  | { kind: "busy" }
  | { kind: "done"; read: number; done: number; total: number }
  | { kind: "more"; read: number; remaining: number; done: number; total: number }
  | { kind: "failed"; error: string };

/** Chained stages leave room to hand on to the next one inside the 60-second limit. */
const CHAINED_BUDGET_MS = 34_000;

export async function runCardPass(tenantId: string, jobId: string, opts: { chained?: boolean } = {}): Promise<PassOutcome> {
  if (!await claimJob(tenantId, jobId)) return { kind: "busy" };
  try {
    if (opts.chained) {
      const { data: j } = await db.from("job").select("chain_passes").eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
      const passes = ((j?.chain_passes as number | undefined) ?? 0) + 1;
      if (passes > MAX_CHAIN_PASSES) {
        await releaseJob(tenantId, jobId);
        const msg = `Stopped after ${MAX_CHAIN_PASSES} stages without finishing. Everything read is saved; press Build in the Card Library to carry on.`;
        await failJob(tenantId, jobId, msg);
        return { kind: "failed", error: msg };
      }
      await db.from("job").update({ chain_passes: passes }).eq("tenant_id", tenantId).eq("id", jobId);
    }

    const [tenant, { data: prof }] = await Promise.all([
      getTenant(tenantId),
      db.from("eligibility_profile").select("org_type").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    const r = await continueCardBuild(tenantId, tenant?.name ?? "this client", (prof?.org_type as string | null) ?? null, {
      onProgress: p => { void updateJob(tenantId, jobId, p); },
      onEvent: e => { void recordEvent(tenantId, jobId, e); },
      budgetMs: opts.chained ? CHAINED_BUDGET_MS : undefined,
    });
    const progress = await cardBuildProgress(tenantId);

    if (r.complete) {
      await releaseJob(tenantId, jobId);
      await finishJob(tenantId, jobId, { ...(r.merge ?? {}) }, r.merge ? describeMerge(r.merge) : "Finished.");
      return { kind: "done", read: r.read, ...progress };
    }
    await updateJob(tenantId, jobId, { detail: `${progress.done} of ${progress.total} documents read` });
    await releaseJob(tenantId, jobId);
    if (r.read === 0) {
      const msg = `Stopped after reading ${progress.done} of ${progress.total} documents: a stage read nothing while `
        + "documents were still outstanding. What has been read is saved.";
      await failJob(tenantId, jobId, msg);
      return { kind: "failed", error: msg };
    }
    return { kind: "more", read: r.read, remaining: r.remaining, ...progress };
  } catch (e) {
    await releaseJob(tenantId, jobId);
    const message = e instanceof Error ? e.message : "Could not finish reading the Inven(s)tory.";
    await failJob(tenantId, jobId, message);
    return { kind: "failed", error: message };
  }
}
