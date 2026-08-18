import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getPrimaryContact, getTenant } from "@/lib/server/data";
import InvenstoryView from "@/components/InvenstoryView";
import { getGardenState } from "@/lib/server/garden";
import { getEligibilitySummary, getGaps } from "@/lib/server/eligibility";
import { getFeatureVisible } from "@/lib/server/data";

export default async function InvenstoryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, docs, contact, garden, eligSummary, eligVisible] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId, session.role !== "admin"),
    getPrimaryContact(session.tenantId),
    getGardenState(session.tenantId),
    getEligibilitySummary(session.tenantId),
    getFeatureVisible(session.tenantId, "eligibility"),
  ]);
  const showElig = session.role === "admin" || eligVisible;
  const gapData = showElig ? await getGaps(session.tenantId) : null;
  if (!tenant) redirect("/");
  return (
    <InvenstoryView
      tenantId={tenant.id}
      tenantName={tenant.name}
      orgType={tenant.org_type}
      website={tenant.website}
      contactName={contact}
      docs={docs}
      garden={garden}
      eligibility={showElig ? eligSummary : undefined}
      readiness={gapData ? gapData.readiness : undefined}
      readinessComputedAt={gapData ? gapData.computedAt : null}
      isAdmin={session.role === "admin"}
    />
  );
}
