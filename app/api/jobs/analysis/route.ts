// Inven(s)tory Analysis, Phase A: start, carry on, or stop the one read for the
// client being viewed. Admin-only while it is on trial; Phase C gives clients
// their own Analyze button.
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
import { getTenant } from "@/lib/server/data";
import { db } from "@/lib/server/db";
import { clearAnalysisDocs, analysisProgress, REREAD_MARK } from "@/lib/server/analysis-extract";
import { createJob, supersedeRunning, failJob, releaseJob, latestJob, recordEvent } from "@/lib/server/jobs";
import { scheduleAnalysisPass } from "@/lib/server/job-chain";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const tenantId = session.tenantId;
  const tenant = await getTenant(tenantId);
  const orgName = tenant?.name ?? "this client";

  const existing = await latestJob(tenantId, "analysis");

  if (body?.stop) {
    if (!existing) return NextResponse.json({ stopped: true, complete: false, ...await analysisProgress(tenantId) });
    await releaseJob(tenantId, existing.id);
    await failJob(tenantId, existing.id, "Analysis stopped before it finished. What was read is saved.");
    return NextResponse.json({ jobId: existing.id, stopped: true, complete: false, ...await analysisProgress(tenantId) });
  }

  const jobId = existing?.id ?? await createJob(
    tenantId, "analysis", `Analysing ${orgName}'s Inven(s)tory`, session.user.id);
  if (!existing) await supersedeRunning(tenantId, "analysis", jobId);

  const opening = () => recordEvent(tenantId, jobId, {
    kind: "phase",
    text: `Starting the trial analysis for ${orgName}. Each document is read once for its type, its Story Cards `
      + "and its facts, each proven by a quote. The code refuses anything whose quote is not in its document. "
      + "This is a trial: nothing the client sees changes.",
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
