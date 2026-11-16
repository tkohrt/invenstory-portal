import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getEligibilityProfile, getGaps } from "@/lib/server/eligibility";
import FundingEligibilityView from "@/components/FundingEligibilityView";
import { closedInBrain } from "@/lib/server/brain";
import { getPeerOrgs } from "@/lib/server/setup";
import { getClientTasks } from "@/lib/server/analysis-client-read";
import { rfpEngineOn, getGovReadiness } from "@/lib/server/gov-readiness";

export default async function FundingEligibilityPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await closedInBrain(session.tenantId);  // Auto-Draft patch 3: not a client page
  await gateFeature(session.role, session.tenantId, "eligibility");
  const [profile, tenant, gapData, peerOrgs, tasks, rfpOn, gov] = await Promise.all([
    getEligibilityProfile(session.tenantId),
    getTenant(session.tenantId),
    getGaps(session.tenantId),
    getPeerOrgs(session.tenantId),
    getClientTasks(session.tenantId),
    // The RFP Engine (patch 53). Neither read can take the page down: off and
    // unavailable are the answers when anything goes wrong.
    rfpEngineOn(session.tenantId).catch(() => false),
    getGovReadiness(session.tenantId).catch(() => ({ available: false as const, interest: null, answers: {}, updatedAt: null })),
  ]);
  return (
    <FundingEligibilityView
      profile={profile}
      peerOrgs={peerOrgs}
      suggestions={tasks.suggestions}
      orgName={tenant?.name ?? "your organization"}
      adminViewing={session.role === "admin"}
      gaps={gapData.gaps}
      gapsComputedAt={gapData.computedAt}
      readinessPct={gapData.readiness.pct}
      gov={gov.available ? { engineOn: rfpOn, interest: gov.interest, answers: gov.answers } : null}
    />
  );
}
