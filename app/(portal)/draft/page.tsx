// Draft an Application: the front door to the Storyboarding Tool.
//
// One question, two answers: start a new application, or carry on with one.
// Hidden from clients until an admin turns it on (feature draft_application),
// and the tool behind it is For Granted only for now.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { lastApplication } from "@/lib/server/draft-start";
import DraftStartView from "@/components/DraftStartView";

export default async function DraftStartPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "draft_application");
  const [tenant, last] = await Promise.all([
    getTenant(session.tenantId),
    session.role === "admin" ? lastApplication(session.tenantId) : Promise.resolve(null),
  ]);
  return <DraftStartView tenantName={tenant?.name ?? "this client"} last={last} isAdmin={session.role === "admin"} />;
}
