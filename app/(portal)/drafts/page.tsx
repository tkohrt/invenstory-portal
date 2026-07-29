import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getDrafts as listDrafts } from "@/lib/server/drafts";
import DraftsView from "@/components/DraftsView";

export default async function DraftsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, drafts] = await Promise.all([getTenant(session.tenantId), listDrafts(session.tenantId)]);
  if (!tenant) redirect("/");
  return <DraftsView tenantName={tenant.name} drafts={drafts} isAdmin={session.role === "admin"} />;
}
