import "server-only";
// A whole-draft auto-draft run, carried by the server one stage at a time
// (Auto-Draft patch 6, spec section 4). The same chain as the Card Library
// build and the analysis: each stage auto-drafts questions until its time is
// nearly up, saves where it got to on the job, and hands on to the next stage
// (lib/server/job-chain.ts). Progress shows in the portal-wide build notice.
//
// The run's plan lives on the job row while it runs (job.result: the draft,
// the questions in order, and how far it has got), so any stage, or a revived
// chain, picks up exactly where the last one stopped.
import { db } from "./db";
import { claimJob, releaseJob, failJob, finishJob, recordEvent } from "./jobs";
import { MAX_CHAIN_PASSES } from "./job-chain";
import { autodraftSection, loadRunCtx, type SectionOutcome } from "./autodraft";
import type { Start } from "@/lib/autodraft";
import { LOCKED_STATUSES, type DraftStatus } from "@/lib/draft-version";

/** Leave room in the 60-second function for the last question's model call and the hand-off. */
const STAGE_BUDGET_MS = 30_000;

export interface RunState {
  draftId: string;
  title: string;
  run: { id: string; start: Start; n: number }[];
  next: number;
  placed: number;
  fromStandard: number;
  arranged: number;
  fallback: number;
  gaps: number;
  leftOut: number;
  /** Questions whose Standard Answer was adapted for this funder: a choice waits on each. */
  adapted?: number;
  failed: number;
  skipped: number;
}

export type PassOutcome = { kind: "more" } | { kind: "done" } | { kind: "busy" } | { kind: "failed"; error: string };

function add(st: RunState, o: SectionOutcome) {
  if (o.error) { st.failed += 1; return; }
  st.placed += o.placed;
  if (o.start === "standard_answer" && o.placed) st.fromStandard += 1; else if (o.placed) st.arranged += 1;
  if (o.fallback) st.fallback += 1;
  if (o.adapted) st.adapted = (st.adapted ?? 0) + 1;
  st.gaps += o.gaps;
  st.leftOut += o.leftOut;
}

export function summaryText(st: RunState): string {
  const parts = [`Auto-drafted ${st.run.length} question${st.run.length === 1 ? "" : "s"} of "${st.title}": ${st.placed} piece${st.placed === 1 ? "" : "s"} placed.`];
  if (st.fromStandard) parts.push(`${st.fromStandard} started from an approved Standard Answer${st.adapted ? `, ${st.adapted} of them adapted for this funder: choose under each whether the Standard Answer should change too` : ""}.`);
  if (st.gaps) parts.push(`${st.gaps} kind${st.gaps === 1 ? "" : "s"} of card asked for still missing: see Calls for under each question.`);
  if (st.fallback) parts.push(`${st.fallback} question${st.fallback === 1 ? " was" : "s were"} arranged by the code's own pick because the model's reply could not be used.`);
  if (st.leftOut) parts.push(`${st.leftOut} piece${st.leftOut === 1 ? "" : "s"} of a Standard Answer left out because the card was retired.`);
  if (st.failed) parts.push(`${st.failed} question${st.failed === 1 ? "" : "s"} could not be auto-drafted.`);
  if (st.skipped) parts.push(`${st.skipped} left alone (marked done or approved).`);
  return parts.join(" ");
}

async function stillRunning(tenantId: string, jobId: string): Promise<boolean> {
  const { data } = await db.from("job").select("status").eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
  return (data as { status: string } | null)?.status === "running";
}

/** Open, locked (submitted, won, lost), or gone. A failed read counts as open: the next question checks again. */
async function draftLock(tenantId: string, draftId: string): Promise<"open" | "locked" | "gone"> {
  const { data, error } = await db.from("grant_draft").select("status").eq("tenant_id", tenantId).eq("id", draftId).maybeSingle();
  if (error) return "open";
  const st = (data as { status: string } | null)?.status;
  if (!st) return "gone";
  return LOCKED_STATUSES.has(st as DraftStatus) ? "locked" : "open";
}

/** The client's running auto-draft, however quiet it has gone (a quiet run is revived, not abandoned). */
export async function runningAutodraft(tenantId: string): Promise<{ jobId: string; draftId: string; done: number; total: number } | null> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await db.from("job").select("id, result, done, total").eq("tenant_id", tenantId).eq("kind", "autodraft")
    .eq("status", "running").gte("started_at", since).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const j = data as { id: string; result: { draftId?: string } | null; done: number; total: number } | null;
  return j?.result?.draftId ? { jobId: j.id, draftId: j.result.draftId, done: j.done, total: j.total } : null;
}

export async function runAutodraftPass(tenantId: string, jobId: string, opts: { chained?: boolean } = {}): Promise<PassOutcome> {
  if (!await claimJob(tenantId, jobId)) return { kind: "busy" };
  try {
    const { data: j } = await db.from("job").select("result, chain_passes, started_by").eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
    const job = j as { result: RunState | null; chain_passes: number | null; started_by: string | null } | null;
    const st = job?.result;
    if (!st || !Array.isArray(st.run)) {
      await releaseJob(tenantId, jobId);
      await failJob(tenantId, jobId, "This auto-draft run lost its plan. Nothing more was changed; start it again from the draft.");
      return { kind: "failed", error: "no plan" };
    }
    if (opts.chained) {
      const passes = (job?.chain_passes ?? 0) + 1;
      if (passes > MAX_CHAIN_PASSES) {
        await releaseJob(tenantId, jobId);
        const msg = `Stopped after ${MAX_CHAIN_PASSES} stages without finishing. Everything placed is kept; auto-draft again to carry on.`;
        await failJob(tenantId, jobId, msg);
        return { kind: "failed", error: msg };
      }
      await db.from("job").update({ chain_passes: passes }).eq("tenant_id", tenantId).eq("id", jobId);
    }

    const ctx = await loadRunCtx(tenantId, job?.started_by ?? null, st.draftId);
    const started = Date.now();
    while (st.next < st.run.length && (st.next === 0 || Date.now() - started < STAGE_BUDGET_MS)) {
      // Stopped (or failed) since this stage began: place nothing more (review fix, 12 Oct 2026).
      if (!(await stillRunning(tenantId, jobId))) { await releaseJob(tenantId, jobId); return { kind: "failed", error: "stopped" }; }
      // Locked since the run began (marked submitted elsewhere): a submitted application does not change.
      const lock = await draftLock(tenantId, st.draftId);
      if (lock !== "open") {
        await releaseJob(tenantId, jobId);
        await failJob(tenantId, jobId, lock === "locked"
          ? "The draft was marked submitted while auto-draft was running, so it stopped. Everything placed before that is kept."
          : "The draft is no longer there, so auto-draft stopped.");
        return { kind: "failed", error: lock };
      }
      const item = st.run[st.next];
      const o = await autodraftSection(ctx, item.id, item.start).catch(e => ({
        sectionId: item.id, start: item.start, placed: 0, fallback: false, leftOut: 0, gaps: 0,
        error: e instanceof Error ? e.message : "failed",
      }) as SectionOutcome);
      add(st, o);
      st.next += 1;
      void recordEvent(tenantId, jobId, {
        kind: o.error ? "warn" : "progress",
        text: o.error
          ? `Question ${item.n}: ${o.error}`
          : `Question ${item.n}: ${o.placed ? `${o.placed} placed${o.start === "standard_answer" ? ` from the Standard Answer${o.adapted ? ", adapted for this funder" : ""}` : ""}` : "nothing to add"}${o.gaps ? `, ${o.gaps} kind${o.gaps === 1 ? "" : "s"} still missing` : ""}${o.fallback ? " (the code's own pick)" : ""}.`,
      });
      // Where it got to, on the job, after every question: a stage killed at its
      // limit loses at most the question it was on.
      await db.from("job").update({ result: st, done: st.next, total: st.run.length, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", jobId).eq("status", "running");
      if (Date.now() - started >= STAGE_BUDGET_MS) break;
    }
    await releaseJob(tenantId, jobId);
    if (!(await stillRunning(tenantId, jobId))) return { kind: "failed", error: "stopped" };
    if (st.next >= st.run.length) {
      // Only while still running: a Stop pressed at the very end is not overwritten with "finished".
      await finishJob(tenantId, jobId, st as unknown as Record<string, unknown>, summaryText(st), { onlyIfRunning: true });
      return { kind: "done" };
    }
    return { kind: "more" };
  } catch (e) {
    await releaseJob(tenantId, jobId);
    const msg = e instanceof Error ? e.message : "The auto-draft run stopped.";
    await failJob(tenantId, jobId, `${msg} Everything placed so far is kept.`);
    return { kind: "failed", error: msg };
  }
}
