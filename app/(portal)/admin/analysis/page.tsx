// Inven(s)tory Analysis (trial) for the client being viewed. Admin only: Phase A
// runs beside the current reads and changes nothing a client sees.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getAnalysisTrial } from "@/lib/server/analysis-read";
import { getAnalysisComparison } from "@/lib/server/analysis-compare";
import { latestJob } from "@/lib/server/jobs";
import AnalysisTrialView from "@/components/AnalysisTrialView";

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
  return <AnalysisTrialView orgName={tenant?.name ?? "this client"} data={data} job={job} compare={compare} />;
}
