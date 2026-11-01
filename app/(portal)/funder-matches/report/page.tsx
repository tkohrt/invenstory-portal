// The fit report (patch 6 of the 1 November 2026 build): every lead from every
// source on one printable page, each with the same four answers and a next
// step. Built from what Funder Matches already stored; nothing is re-run and no
// model is called. Rules: lib/fit-report.ts.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getCachedMatches, getCachedFunders } from "@/lib/server/matching";
import { getEligibilityProfile } from "@/lib/server/eligibility";
import { getJudgments } from "@/lib/server/triage";
import { getLeads } from "@/lib/server/discovery";
import { closedInBrain } from "@/lib/server/brain";
import { buildFitReport } from "@/lib/fit-report";
import { suppresses } from "@/lib/triage";
import FitReportView from "@/components/FitReportView";

export default async function FitReportPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await closedInBrain(session.tenantId);
  await gateFeature(session.role, session.tenantId, "funder_matches");
  const isAdmin = session.role === "admin";

  const [tenant, matches, funders, eligibility, judgments, leads] = await Promise.all([
    getTenant(session.tenantId),
    getCachedMatches(session.tenantId),
    getCachedFunders(session.tenantId),
    getEligibilityProfile(session.tenantId).catch(() => null),
    // Read for clients too, through the service client scoped to their own
    // tenant: a row For Granted ruled out must not appear in a client's report.
    getJudgments(session.tenantId).catch(() => new Map()),
    getLeads(session.tenantId, !isAdmin).catch(() => []),
  ]);

  const ruledOut = new Set<string>();
  for (const [key, j] of judgments) if (suppresses(j.state)) ruledOut.add(key);

  const report = buildFitReport({
    matches, funders, leads, eligibility, ruledOut,
    includeRuledOut: isAdmin,
  });

  return (
    <FitReportView
      report={report}
      orgName={tenant?.name ?? "this organization"}
      isAdmin={isAdmin}
      generatedAt={new Date().toISOString()}
      lastRun={matches[0]?.matched_at ?? funders[0]?.matched_at ?? null}
    />
  );
}
