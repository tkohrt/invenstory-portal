import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getDraft } from "@/lib/server/drafts";
import DraftDetailView from "@/components/DraftDetailView";

export default async function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, draft] = await Promise.all([getTenant(session.tenantId), getDraft(session.tenantId, id)]);
  if (!tenant) redirect("/");
  if (!draft) return <div className="empty">This draft doesn&rsquo;t exist.</div>;
  return <DraftDetailView tenantName={tenant.name} draft={draft} isAdmin={session.role === "admin"} />;
}
