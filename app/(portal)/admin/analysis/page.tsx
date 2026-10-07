// Inven(s)tory Analysis (trial) for the client being viewed. Admin only: Phase A
// runs beside the current reads and changes nothing a client sees.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getAnalysisTrial } from "@/lib/server/analysis-read";
import { getAnalysisComparison } from "@/lib/server/analysis-compare";
import { latestJob } from "@/lib/server/jobs";
import AnalysisTrialView from "@/components/AnalysisTrialView";
import { previewSwitch } from "@/lib/server/analysis-switch";
import { switchStatus } from "@/lib/server/analysis-source";
import { switchGate, PROVING_TENANT_ID } from "@/lib/analysis-switch";

export default async function AnalysisTrialPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const [tenant, data, job, compare] = await Promise.all([
    getTenant(session.tenantId),
    getAnalysisTrial(session.tenantId),
    latestJob(session.tenantId, "analysis"),
    // Phase B. A failure here never takes the trial page down with it.
    getAnalysisComparison(session.tenantId).then(c => ({ ok: true as const, c })).catch((e: unknown) => ({
      ok: false as const, error: e instanceof Error ? e.message : "The comparison could not be worked out.",
    })),
  ]);
  // Phase D: the switch-over. The gate is worked out from what this page already
  // loaded; the switch action checks it again on the server.
  const [status, preview] = await Promise.all([
    switchStatus(session.tenantId).catch(() => null),
    previewSwitch(session.tenantId).then(p => ({ ok: true as const, p })).catch((e: unknown) => ({
      ok: false as const, error: e instanceof Error ? e.message : "The preview could not be worked out.",
    })),
  ]);
  const proving = session.tenantId === PROVING_TENANT_ID;
  const gate = status && preview.ok ? switchGate({
    tenantId: session.tenantId, pendingDocs: preview.p.pendingDocs, analysedDocs: preview.p.analysedDocs, proofAt: status.proofAt,
    ...(proving ? {
      review: { passes: data.tally.passes, reviewed: data.tally.reviewed, target: data.tally.target, supportedPct: data.tally.supportedPct },
      compare: compare.ok ? compare.c.readiness.gate : undefined,
    } : {}),
  }) : null;
  return <AnalysisTrialView orgName={tenant?.name ?? "this client"} data={data} job={job} compare={compare}
    switchInfo={{ status, preview, gate, proving }} />;
}
