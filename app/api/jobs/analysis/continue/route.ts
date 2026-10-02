// The next stage of an Inven(s)tory Analysis run, called by the server itself.
// No session: authorised by a signature over the job and its client, scoped to
// analysis so a Card Library signature cannot continue it (lib/server/job-chain.ts).
import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/db";
import { verifyChain, scheduleAnalysisPass } from "@/lib/server/job-chain";
import { runAnalysisPass } from "@/lib/server/analysis-build";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { tenantId?: string; jobId?: string; sig?: string };
  const { tenantId, jobId, sig } = body;
  if (!tenantId || !jobId || !sig || !verifyChain(tenantId, jobId, sig, "analysis-chain")) {
    return NextResponse.json({ error: "not authorised" }, { status: 403 });
  }
  const { data: job } = await db.from("job").select("id, kind, status")
    .eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
  if (!job || job.kind !== "analysis" || job.status !== "running") {
    return NextResponse.json({ skipped: true }, { status: 202 });
  }
  const origin = new URL(req.url).origin;
  after(async () => {
    const out = await runAnalysisPass(tenantId, jobId, { chained: true });
    if (out.kind === "more") await scheduleAnalysisPass(origin, tenantId, jobId);
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
