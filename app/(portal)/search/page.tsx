import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getTenant } from "@/lib/server/data";
import SearchView from "@/components/SearchView";

export default async function SearchPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, docs] = await Promise.all([getTenant(session.tenantId), getDocumentsWithTags(session.tenantId, session.role !== "admin")]);
  if (!tenant) redirect("/");
  const tags = [...new Set(docs.flatMap(d => d.tags))].sort();
  return <SearchView tenantName={tenant.name} tags={tags} docs={docs} isAdmin={session.role === "admin"} />;
}
