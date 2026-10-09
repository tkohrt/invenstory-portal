import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getPrimaryContact, getTenant } from "@/lib/server/data";
import InvenstoryView from "@/components/InvenstoryView";
import { getGaps } from "@/lib/server/eligibility";
import { asksForClient } from "@/lib/server/asks";
import ClientAsks from "@/components/ClientAsks";

export default async function InvenstoryPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, docs, contact, gapData, asks] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId, session.role !== "admin"),
    getPrimaryContact(session.tenantId),
    getGaps(session.tenantId),
    asksForClient(session.tenantId),
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
      asks={asks.length ? <ClientAsks asks={asks} isAdmin={session.role === "admin"} tenantName={tenant.name} /> : null}
    />
  );
}
