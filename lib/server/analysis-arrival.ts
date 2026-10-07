import "server-only";
// Inven(s)tory Analysis, Phase D: read on upload.
//
// For a client on the analysis, a document that becomes ready (uploaded,
// processed again with changed text, or filed as a note) starts an analysis
// run straight away, carried by the server like any other. The run reads only
// what is new or changed, so it is usually this one document. When it
// finishes, readiness, the Card Library and the search profile are updated from
// it (analysis-build.ts). Nobody has to press anything.
//
// A client's upload is started as that client, so the meter counts it toward
// the client's monthly AI allowance (a build step, never stopped by it). For
// Granted's reads never count. The guard that
// already existed for upload reads still applies: past 30 a day for one client,
// the read waits for the next analysis.
//
// A run already going for the client picks the document up itself, and a run
// that is about to finish carries on when something new arrived meanwhile
// (analysis-build.ts), so uploads in quick succession are all read.
import { db } from "./db";
import { onAnalysis } from "./analysis-source";
import { pendingReading } from "./analysis-extract";
import { checkAllowance } from "./allowance";
import { uploadReadsLastDay } from "./ai-usage";
import { createJob, latestJob, recordEvent, supersedeRunning } from "./jobs";
import { scheduleAnalysisPass } from "./job-chain";
import { LIMITS, type Actor } from "@/lib/usage-limits";
import { arrivalPlan } from "@/lib/analysis-switch";

/** Where the server reaches itself to carry the run, outside any request. */
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.forgranted.com";

export type ArrivalOutcome = "not_on_analysis" | "nothing_new" | "joined" | "started" | "deferred";

/**
 * Read a newly ready document with the analysis, if its client is on it.
 * Best-effort and quiet: an upload must never fail because its read could not
 * start; the next analysis picks the document up.
 */
export async function readOnArrival(doc: { id: string; tenant_id: string; title?: string | null; uploaded_by?: string | null }, actor: Actor): Promise<ArrivalOutcome> {
  const tenantId = doc.tenant_id;
  if (!(await onAnalysis(tenantId))) return "not_on_analysis";
  const [pending, readsToday, existing] = await Promise.all([
    pendingReading(tenantId),
    actor === "client" ? uploadReadsLastDay(tenantId) : Promise.resolve(0),
    latestJob(tenantId, "analysis"),
  ]);
  const plan = arrivalPlan({
    onAnalysis: true, pendingDocs: pending.docs, actor, readsToday,
    uploadReadsPerDay: LIMITS.uploadReadsPerDayPerClient, running: !!existing,
  });
  if (plan === "nothing_new") return "nothing_new";
  if (plan === "deferred") {
    await db.from("audit_log").insert({ tenant_id: tenantId, action: "upload_ai_read_deferred", detail: doc.id });
    return "deferred";
  }
  if (actor === "client") {
    await db.from("audit_log").insert({ tenant_id: tenantId, action: "upload_ai_read", detail: doc.id });
    // Counted, never stopped; the check is made for its alert to For Granted.
    await checkAllowance("client", tenantId, { kind: "build" });
  }
  if (plan === "join" && existing) {
    await recordEvent(tenantId, existing.id, { kind: "phase", text: `${doc.title ?? "A document"} arrived; this run reads it too.` });
    return "joined";
  }

  const title = doc.title ? `Reading ${doc.title}` : "Reading a new document";
  // Started as whoever caused the read, so the meter counts it as theirs: the
  // uploading client, or For Granted's uploader. For Granted pressing Process
  // again on a client's document is For Granted's read, but the uploader on
  // record is the client, so that run is started by nobody and metered as a
  // background step, never as the client's.
  let startedBy: string | undefined;
  if (doc.uploaded_by) {
    if (actor === "client") startedBy = doc.uploaded_by;
    else {
      const { data: u } = await db.from("app_user").select("role").eq("id", doc.uploaded_by).maybeSingle();  // tenant-safe: one user's role by id
      if ((u as { role: string } | null)?.role === "admin") startedBy = doc.uploaded_by;
    }
  }
  const jobId = await createJob(tenantId, "analysis", title, startedBy);
  await supersedeRunning(tenantId, "analysis", jobId);
  if (actor === "client") {
    const { error } = await db.from("analysis_usage").insert({
      tenant_id: tenantId, job_id: jobId, started_by: doc.uploaded_by ?? null,
      pending_docs: pending.docs, pending_chars: pending.chars,
    });
    if (error) console.error("[arrival] usage not recorded", error.message);
  }
  await recordEvent(tenantId, jobId, {
    kind: "phase",
    text: `${doc.title ?? "A new document"} arrived, so the analysis reads it now`
      + `${pending.docs > 1 ? `, with ${pending.docs - 1} other new or changed document${pending.docs === 2 ? "" : "s"}` : ""}. `
      + "Readiness, the Card Library and the search profile update when it finishes.",
  });
  // If this cannot reach the server, the run waits as "running" and the next
  // portal page anyone opens restarts it (reviveStalledChains).
  await scheduleAnalysisPass(APP_ORIGIN, tenantId, jobId);
  return "started";
}
