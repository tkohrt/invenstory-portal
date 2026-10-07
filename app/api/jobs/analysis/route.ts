// Inven(s)tory Analysis: start, carry on, or stop the one read for the client
// being viewed.
//
// For Granted can do anything here. A client (Phase C) can only start a read of
// what is new or changed, from their own Analyze page, while the per-client
// switch is on. Its spend counts toward the monthly AI allowance (Phase D,
// lib/allowance.ts) but building the Inven(s)tory is never stopped by it. A client cannot stop
// a run, re-read everything, or re-read one document: those stay For Granted's.
//
// The same stages as the Card Library build (app/api/jobs/cards), carried by
// the server so the page can be closed:
//   begin     create or rejoin the job and answer at once, reading nothing
//   kick      start the server-carried chain from where reading stopped
//             (with restart: forget what was read and read everything again, paid)
//             (with documentId: read that one document again, and only it)
//   stop      mark the run ended, keeping everything read
import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant, getFeatureVisible } from "@/lib/server/data";
import { db } from "@/lib/server/db";
import { clearAnalysisDocs, analysisProgress, REREAD_MARK } from "@/lib/server/analysis-extract";
import { createJob, supersedeRunning, failJob, releaseJob, latestJob, recordEvent } from "@/lib/server/jobs";
import { scheduleAnalysisPass } from "@/lib/server/job-chain";
import { pendingReading } from "@/lib/server/analysis-extract";
import { checkAllowance } from "@/lib/server/allowance";
import { onAnalysis } from "@/lib/server/analysis-source";
import { decideClientRun, describeCap } from "@/lib/analysis-cap";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const admin = session.role === "admin";
  const tenantId = session.tenantId;
  if (!admin && !(await getFeatureVisible(tenantId, "analysis"))) {
    return NextResponse.json({ error: "Inven(s)tory Analysis is not turned on for this account yet." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (!admin && (body?.stop || body?.restart || body?.documentId)) {
    return NextResponse.json({ error: "Only For Granted can do that." }, { status: 403 });
  }
  const tenant = await getTenant(tenantId);
  const orgName = tenant?.name ?? "this client";

  const existing = await latestJob(tenantId, "analysis");

  // A client starting a new run: something new to read, and the monthly AI
  // allowance, both checked before anything is created. Rejoining a run already
  // going is always free. The client's runs are recorded for the activity
  // dashboard (pages read); they no longer count against a cap of their own.
  let usage: { pending_docs: number; pending_chars: number } | null = null;
  if (!admin && !existing && !body?.stop && (body?.begin || !body?.begun)) {
    const [pending, allowance] = await Promise.all([pendingReading(tenantId), checkAllowance("client", tenantId, { kind: "build" })]);
    const d = decideClientRun({ pendingDocs: pending.docs, pendingChars: pending.chars, allowance });
    if (!d.allowed) {
      return NextResponse.json({ error: describeCap(d), capped: true, reason: d.reason, canRequest: d.reason === "allowance" }, { status: 429 });
    }
    usage = { pending_docs: pending.docs, pending_chars: pending.chars };
  }
  if (!admin && !existing && body?.kick && body?.begun) {
    return NextResponse.json({ error: "Start the analysis from the Analyze page." }, { status: 400 });
  }

  if (body?.stop) {
    if (!existing) return NextResponse.json({ stopped: true, complete: false, ...await analysisProgress(tenantId) });
    await releaseJob(tenantId, existing.id);
    await failJob(tenantId, existing.id, "Analysis stopped before it finished. What was read is saved.");
    return NextResponse.json({ jobId: existing.id, stopped: true, complete: false, ...await analysisProgress(tenantId) });
  }

  const jobId = existing?.id ?? await createJob(
    tenantId, "analysis", `Analysing ${orgName}'s Inven(s)tory`, session.user.id);
  if (!existing) await supersedeRunning(tenantId, "analysis", jobId);
  if (usage && !existing) {
    const { error: uErr } = await db.from("analysis_usage").insert({ tenant_id: tenantId, job_id: jobId, started_by: session.user.id, ...usage });
    if (uErr) console.error("[analysis] usage not recorded", uErr.message);
  }

  const switched = await onAnalysis(tenantId);
  const opening = () => recordEvent(tenantId, jobId, {
    kind: "phase",
    text: `Starting the analysis for ${orgName}. Each document is read once for its type, its Story Cards `
      + "and its facts, each proven by a quote. The code refuses anything whose quote is not in its document. "
      + (switched
        ? "When it finishes, readiness, the Card Library and the search profile are updated from it."
        : "This client is not on the analysis yet: nothing the client sees changes."),
  });

  if (body?.begin) {
    if (!existing || body?.restart) await opening();
    return NextResponse.json({ jobId, begun: true, ...await analysisProgress(tenantId) });
  }

  const documentId = typeof body?.documentId === "string" && /^[0-9a-f-]{36}$/i.test(body.documentId) ? body.documentId : null;
  if (documentId && !body?.restart) {
    // Keep what was read on screen until the new read replaces it; the mark only
    // makes this one document stale, so the chain reads it and nothing else new.
    const { data: marked, error: markErr } = await db.from("analysis_doc").update({ content_hash: REREAD_MARK })
      .eq("tenant_id", tenantId).eq("document_id", documentId).select("document_id");
    if (markErr) return NextResponse.json({ error: `Could not mark that document: ${markErr.message}` }, { status: 500 });
    if (!marked?.length) return NextResponse.json({ error: "That document has not been read yet; Check for changes reads it." }, { status: 400 });
    await recordEvent(tenantId, jobId, { kind: "phase", text: "Reading one document again, on request." });
  }

  if (body?.restart) {
    await clearAnalysisDocs(tenantId);
    if (!body?.begun) await opening();
  } else if (!body?.begun && !existing) {
    await opening();
  }
  await db.from("job").update({ chain_passes: 0, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", jobId).eq("status", "running");
  await recordEvent(tenantId, jobId, {
    kind: "phase",
    text: "Reading in stages on the server. This page can be closed; come back to it to see the results.",
  });
  const origin = new URL(req.url).origin;
  after(async () => { await scheduleAnalysisPass(origin, tenantId, jobId); });
  return NextResponse.json({ jobId, chained: true, complete: false, ...await analysisProgress(tenantId) });
}
