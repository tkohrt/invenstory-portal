import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getPrimaryContact, getTenant } from "@/lib/server/data";
import LibraryView from "@/components/LibraryView";

export default async function LibraryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, docs, contact] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId),
    getPrimaryContact(session.tenantId),
  ]);
  if (!tenant) redirect("/");
  return (
    <LibraryView
      tenantName={tenant.name}
      orgType={tenant.org_type}
      website={tenant.website}
      contactName={contact}
      docs={docs}
      isAdmin={session.role === "admin"}
    />
  );
}
