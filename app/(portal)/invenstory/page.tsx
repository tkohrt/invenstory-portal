import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getPrimaryContact, getTenant } from "@/lib/server/data";
import InvenstoryView from "@/components/InvenstoryView";

export default async function InvenstoryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, docs, contact] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId, session.role !== "admin"),
    getPrimaryContact(session.tenantId),
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
      isAdmin={session.role === "admin"}
    />
  );
}
