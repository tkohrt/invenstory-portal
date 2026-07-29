import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getTenant } from "@/lib/server/data";
import SearchView from "@/components/SearchView";

export default async function SearchPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, docs] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId),
  ]);
  if (!tenant) redirect("/");
  return <SearchView tenantName={tenant.name} docs={docs} />;
}
