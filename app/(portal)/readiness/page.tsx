import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getGaps } from "@/lib/server/eligibility";
import { tenantIsBrain } from "@/lib/server/brain";
import { db } from "@/lib/server/db";
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
  // The 990 importer (patch 42): offer the pull to nonprofits that have no
  // 990-type document yet. tenant.ein prefills the field for a re-run.
  let irs990: { ein: string } | null = null;
  if (tenant.org_type === "nonprofit") {
    const { data: doc990 } = await db.from("document").select("id")
      .eq("tenant_id", session.tenantId).eq("type_tag", "irs_990").limit(1).maybeSingle();
    if (!doc990) {
      // tenant-safe: own tenant row by id.
      const { data: t } = await db.from("tenant").select("ein").eq("id", session.tenantId).maybeSingle();
      irs990 = { ein: ((t as { ein: string | null } | null)?.ein) ?? "" };
    }
  }
  return (
    <ReadinessView
      tenantName={tenant.name}
      readiness={gapData.readiness}
      computedAt={gapData.computedAt}
      openItem={sp.item ?? null}
      orgType={tenant.org_type}
      irs990={irs990}
      unlock={sp.unlock === "funding"
        ? { eligibilityDone: criticalGaps === 0, readinessRun: !!gapData.computedAt }
        : null}
    />
  );
}
