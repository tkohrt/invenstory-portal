// Analyze my Inven(s)tory: the client's own path (Inven(s)tory Analysis, Phase
// C). Hidden until For Granted turns it on for the client (feature 'analysis').
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getClientAnalysis } from "@/lib/server/analysis-client-read";
import { latestJob } from "@/lib/server/jobs";
import ClientAnalysisView from "@/components/ClientAnalysisView";

export default async function AnalyzePage() {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "analysis");
  const [tenant, data, job] = await Promise.all([
    getTenant(session.tenantId),
    getClientAnalysis(session.tenantId),
    latestJob(session.tenantId, "analysis"),
  ]);
  return <ClientAnalysisView orgName={tenant?.name ?? "Your organization"} data={data} job={job} isAdmin={session.role === "admin"} />;
}
