import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getDraftProgress, getDrafts as listDrafts } from "@/lib/server/drafts";
import { standardAnswersProgress } from "@/lib/server/draft-start";
import DraftsView from "@/components/DraftsView";

export default async function DraftsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "drafts");
  const isAdmin = session.role === "admin";
  const [tenant, drafts, progress, standard] = await Promise.all([
    getTenant(session.tenantId), listDrafts(session.tenantId),
    isAdmin ? getDraftProgress(session.tenantId) : Promise.resolve({}),
    isAdmin ? standardAnswersProgress(session.tenantId) : Promise.resolve(null),
  ]);
  if (!tenant) redirect("/");
  return <DraftsView tenantName={tenant.name} drafts={drafts} isAdmin={isAdmin} progress={progress} standard={standard} />;
}
