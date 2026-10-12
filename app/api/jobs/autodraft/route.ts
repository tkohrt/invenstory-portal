// Auto-draft a whole draft (Auto-Draft patch 6, spec sections 1 and 4).
// For Granted only, and metered as For Granted's spend.
//
//   { draftId }          start: check the minimum, save "Before auto-draft",
//                        mark the draft auto-drafted, and start the
//                        server-carried run; the page can be closed
//   { draftId, stop }    stop the run, keeping everything placed so far
//
// One auto-draft run per client at a time.
import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { createJob, supersedeRunning, failJob, releaseJob, latestJob, recordEvent } from "@/lib/server/jobs";
import { scheduleAutodraftPass } from "@/lib/server/job-chain";
import { autodraftPreview, markAutoDrafted } from "@/lib/server/autodraft";
import { saveBeforeAutoDraftAction } from "@/lib/server/version-actions";
import type { RunState } from "@/lib/server/autodraft-run";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "For Granted only." }, { status: 403 });
  const tenantId = session.tenantId;
  const body = await req.json().catch(() => ({})) as { draftId?: string; stop?: boolean };
  const draftId = typeof body.draftId === "string" ? body.draftId : "";
  const existing = await latestJob(tenantId, "autodraft");
  const existingDraft = (existing?.result as { draftId?: string } | null)?.draftId ?? null;

  if (body.stop) {
    if (!existing || existingDraft !== draftId) return NextResponse.json({ stopped: true });
    await releaseJob(tenantId, existing.id);
    await failJob(tenantId, existing.id, "Auto-draft stopped before it finished. Everything placed so far is kept.");
    return NextResponse.json({ stopped: true, jobId: existing.id });
  }

  if (existing) {
    if (existingDraft === draftId) return NextResponse.json({ jobId: existing.id, rejoined: true, total: existing.total });
    return NextResponse.json({ error: "Another auto-draft is running for this client. Wait for it to finish, or stop it from its draft." }, { status: 409 });
  }

  const preview = await autodraftPreview(tenantId, draftId);
  if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: 400 });
  if (!preview.minimum.met) return NextResponse.json({ error: preview.minimum.message }, { status: 400 });
  if (!preview.plan.run.length) return NextResponse.json({ error: "There is nothing to auto-draft: every question is marked done or already approved." }, { status: 400 });

  try { await saveBeforeAutoDraftAction(draftId); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save the version before auto-draft, so nothing was changed." }, { status: 500 }); }
  await markAutoDrafted(tenantId, draftId);

  const state: RunState = {
    draftId, title: preview.title,
    run: preview.plan.run.map(r => ({ ...r, n: preview.prompts[r.id]?.n ?? 0 })),
    next: 0, placed: 0, fromStandard: 0, arranged: 0, fallback: 0, gaps: 0, leftOut: 0, failed: 0,
    skipped: preview.plan.skipped.length,
  };
  const jobId = await createJob(tenantId, "autodraft", `Auto-drafting ${preview.title}`, session.user.id);
  await supersedeRunning(tenantId, "autodraft", jobId);
  const { error } = await db.from("job").update({ result: state, done: 0, total: state.run.length, chain_passes: 0, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", jobId);
  if (error) {
    await failJob(tenantId, jobId, "The run could not be set up. Nothing was changed after the version was saved.");
    return NextResponse.json({ error: "The run could not be set up. Has migration 0064 been run?" }, { status: 500 });
  }
  await recordEvent(tenantId, jobId, {
    kind: "phase",
    text: `Auto-drafting ${state.run.length} question${state.run.length === 1 ? "" : "s"} of "${preview.title}", one at a time on the server. `
      + "A version named \"Before auto-draft\" was saved first. This page can be closed.",
  });
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: tenantId, action: "autodraft_started", detail: `${draftId}: ${state.run.length} questions` });
  const origin = new URL(req.url).origin;
  after(async () => { await scheduleAutodraftPass(origin, tenantId, jobId); });
  return NextResponse.json({ jobId, total: state.run.length });
}
