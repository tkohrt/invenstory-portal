import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getEligibilityProfile, getGaps } from "@/lib/server/eligibility";
import FundingEligibilityView from "@/components/FundingEligibilityView";
import { closedInBrain } from "@/lib/server/brain";

export default async function FundingEligibilityPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await closedInBrain(session.tenantId);  // Auto-Draft patch 3: not a client page
  await gateFeature(session.role, session.tenantId, "eligibility");
  const [profile, tenant, gapData] = await Promise.all([
    getEligibilityProfile(session.tenantId),
    getTenant(session.tenantId),
    getGaps(session.tenantId),
  ]);
  return (
    <FundingEligibilityView
      profile={profile}
      orgName={tenant?.name ?? "your organization"}
      adminViewing={session.role === "admin"}
      gaps={gapData.gaps}
      gapsComputedAt={gapData.computedAt}
    />
  );
}
