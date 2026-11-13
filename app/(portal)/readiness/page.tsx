import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getGaps } from "@/lib/server/eligibility";
import { tenantIsBrain } from "@/lib/server/brain";
import ReadinessView from "@/components/ReadinessView";

/**
 * P1.5 (patch 38): the readiness checklist's own screen. The Brain has no
 * readiness, so it goes back to its documents.
 */
export default async function ReadinessPage({ searchParams }: { searchParams: Promise<{ item?: string; unlock?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/");
  if (await tenantIsBrain(session.tenantId)) redirect("/invenstory");
  const [tenant, gapData] = await Promise.all([
    getTenant(session.tenantId),
    getGaps(session.tenantId),
  ]);
  if (!tenant) redirect("/");
  const criticalGaps = gapData.gaps.filter(g => g.tier === "critical").length;
  return (
    <ReadinessView
      tenantName={tenant.name}
      readiness={gapData.readiness}
      computedAt={gapData.computedAt}
      openItem={sp.item ?? null}
      orgType={tenant.org_type}
      unlock={sp.unlock === "funding"
        ? { eligibilityDone: criticalGaps === 0, readinessRun: !!gapData.computedAt }
        : null}
    />
  );
}
