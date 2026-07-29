import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getTenant } from "@/lib/server/data";
import LibraryView from "@/components/LibraryView";

export default async function LibraryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, docs] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId),
  ]);
  if (!tenant) redirect("/");
  return <LibraryView tenantName={tenant.name} docs={docs} isAdmin={session.role === "admin"} />;
}
