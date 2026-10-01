// The next stage of a Card Library build, called by the server itself.
//
// No session: the request is authorised by a signature over the job and its
// client (lib/server/job-chain.ts). It answers at once and does the stage after
// answering, then hands on to the next stage, so each link in the chain is one
// invocation inside the 60-second limit.
import { NextResponse, after } from "next/server";
import { db } from "@/lib/server/db";
import { verifyChain, scheduleCardPass } from "@/lib/server/job-chain";
import { runCardPass } from "@/lib/server/card-build";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { tenantId?: string; jobId?: string; sig?: string };
  const { tenantId, jobId, sig } = body;
  if (!tenantId || !jobId || !sig || !verifyChain(tenantId, jobId, sig)) {
    return NextResponse.json({ error: "not authorised" }, { status: 403 });
  }
  const { data: job } = await db.from("job").select("id, kind, status")
    .eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
  if (!job || job.kind !== "cards" || job.status !== "running") {
    return NextResponse.json({ skipped: true }, { status: 202 });
  }
  const origin = new URL(req.url).origin;
  after(async () => {
    const out = await runCardPass(tenantId, jobId, { chained: true });
    // "busy": another stage holds the lease and will hand on itself.
    if (out.kind === "more") await scheduleCardPass(origin, tenantId, jobId);
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
