import "server-only";
import { actorForJob, withAiUsage } from "./ai-usage";
// One stage of an Inven(s)tory Analysis run, shared by the page's route and the
// server's own continuation. card-build.ts's shape: take the lease, read what
// fits, keep it, say what is left. A stage that reads nothing while documents
// are outstanding ends the run as failed rather than chaining forever.
import { db } from "./db";
import { getTenant } from "./data";
import { continueAnalysis, analysisProgress } from "./analysis-extract";
import { claimJob, failJob, finishJob, recordEvent, releaseJob, updateJob } from "./jobs";
import { MAX_CHAIN_PASSES } from "./job-chain";
import type { PassOutcome } from "./card-build";
import { refreshIfOnAnalysis } from "./analysis-switch";

const CHAINED_BUDGET_MS = 34_000;

/** The run's closing line: what was found, in totals, from what is stored. */
async function summarize(tenantId: string): Promise<{ result: Record<string, number>; text: string }> {
  const { data } = await db.from("analysis_doc")
    .select("doc_type, content_hash, cards, facts, document:document_id!inner(status)")
    .eq("tenant_id", tenantId).eq("document.status", "ready");
  const rows = (data ?? []) as unknown as { doc_type: string | null; content_hash: string; cards: unknown[]; facts: unknown[] }[];
  const result = {
    documents: rows.length,
    typed: rows.filter(r => r.doc_type && r.doc_type !== "other").length,
    cards: rows.reduce((n, r) => n + (r.cards?.length ?? 0), 0),
    facts: rows.reduce((n, r) => n + (r.facts?.length ?? 0), 0),
    unreadable: rows.filter(r => r.content_hash === "empty").length,
  };
  const text = `${result.documents} document(s) analysed: ${result.typed} with a recognised type, `
    + `${result.cards} card candidate(s), ${result.facts} fact(s)`
    + (result.unreadable ? `, ${result.unreadable} with no readable text.` : ".");
  return { result, text };
}

/** Every model call in a pass is metered against this client, as whoever started the run. */
export async function runAnalysisPass(tenantId: string, jobId: string, opts: { chained?: boolean } = {}): Promise<PassOutcome> {
  const who = await actorForJob(tenantId, jobId);
  return withAiUsage({ tenantId, userId: who.userId, actor: who.actor, feature: "analysis" }, () => runAnalysisPassMetered(tenantId, jobId, opts, who.userId));
}

async function runAnalysisPassMetered(tenantId: string, jobId: string, opts: { chained?: boolean }, userId: string | null): Promise<PassOutcome> {
  if (!await claimJob(tenantId, jobId)) return { kind: "busy" };
  try {
    if (opts.chained) {
      const { data: j } = await db.from("job").select("chain_passes").eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
      const passes = ((j?.chain_passes as number | undefined) ?? 0) + 1;
      if (passes > MAX_CHAIN_PASSES) {
        await releaseJob(tenantId, jobId);
        const msg = `Stopped after ${MAX_CHAIN_PASSES} stages without finishing. Everything read is saved; press Analyze to carry on.`;
        await failJob(tenantId, jobId, msg);
        return { kind: "failed", error: msg };
      }
      await db.from("job").update({ chain_passes: passes }).eq("tenant_id", tenantId).eq("id", jobId);
    }

    const [tenant, { data: prof }] = await Promise.all([
      getTenant(tenantId),
      db.from("eligibility_profile").select("org_type").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    const r = await continueAnalysis(tenantId, tenant?.name ?? "this client", (prof?.org_type as string | null) ?? null, {
      onProgress: p => { void updateJob(tenantId, jobId, p); },
      onEvent: e => { void recordEvent(tenantId, jobId, e); },
      budgetMs: opts.chained ? CHAINED_BUDGET_MS : undefined,
    });
    const progress = await analysisProgress(tenantId);

    if (r.complete) {
      await releaseJob(tenantId, jobId);
      const s = await summarize(tenantId);
      // Phase D: for a client on the analysis, what it found becomes the
      // client's readiness, Card Library and search profile now. Free.
      const applied = await refreshIfOnAnalysis(tenantId, userId);
      if (applied) await recordEvent(tenantId, jobId, { kind: "phase", text: `Updated from the analysis. ${applied.text}` });
      await finishJob(tenantId, jobId, s.result, applied ? `${s.text} ${applied.text}` : s.text);
      return { kind: "done", read: r.read, ...progress };
    }
    await updateJob(tenantId, jobId, { detail: `${progress.done} of ${progress.total} documents analysed` });
    await releaseJob(tenantId, jobId);
    if (r.read === 0) {
      const msg = `Stopped after analysing ${progress.done} of ${progress.total} documents: a stage read nothing while `
        + "documents were still outstanding. What has been read is saved.";
      await failJob(tenantId, jobId, msg);
      return { kind: "failed", error: msg };
    }
    return { kind: "more", read: r.read, remaining: r.remaining, ...progress };
  } catch (e) {
    await releaseJob(tenantId, jobId);
    const message = e instanceof Error ? e.message : "Could not finish analysing the Inven(s)tory.";
    await failJob(tenantId, jobId, message);
    return { kind: "failed", error: message };
  }
}
