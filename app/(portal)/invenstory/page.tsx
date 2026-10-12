import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getPrimaryContact, getTenant } from "@/lib/server/data";
import InvenstoryView from "@/components/InvenstoryView";
import { getGaps } from "@/lib/server/eligibility";
import { asksForClient } from "@/lib/server/asks";
import ClientAsks from "@/components/ClientAsks";
import { tenantIsBrain } from "@/lib/server/brain";

export default async function InvenstoryPage({ searchParams }: { searchParams: Promise<{ item?: string; brain?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/");
  // The Brain (Auto-Draft patch 3) has documents only: no readiness, contact or asks.
  const brain = await tenantIsBrain(session.tenantId);
  const [tenant, docs, contact, gapData, asks] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId, session.role !== "admin"),
    brain ? Promise.resolve(null) : getPrimaryContact(session.tenantId),
    brain ? Promise.resolve(null) : getGaps(session.tenantId),
    brain ? Promise.resolve([]) : asksForClient(session.tenantId),
  ]);
  if (!tenant) redirect("/");
  return (
    <InvenstoryView
      tenantId={tenant.id}
      tenantName={tenant.name}
      orgType={tenant.org_type}
      website={tenant.website}
      contactName={contact}
      docs={docs}
      readiness={gapData ? gapData.readiness : undefined}
      readinessComputedAt={gapData ? gapData.computedAt : null}
      isAdmin={session.role === "admin"}
      openItem={sp.item ?? null}
      brain={brain ? { closedPage: sp.brain === "closed" } : null}
      asks={asks.length ? <ClientAsks asks={asks} isAdmin={session.role === "admin"} tenantName={tenant.name} /> : null}
    />
  );
}
