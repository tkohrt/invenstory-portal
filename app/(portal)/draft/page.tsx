// Draft an Application: the front door to the Storyboarding Tool.
//
// One question, two answers: start a new application, or carry on with one.
// For Granted only: clients never see it, and it is not a client toggle.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { lastApplication } from "@/lib/server/draft-start";
import DraftStartView from "@/components/DraftStartView";

export default async function DraftStartPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const [tenant, last] = await Promise.all([getTenant(session.tenantId), lastApplication(session.tenantId)]);
  return <DraftStartView tenantName={tenant?.name ?? "this client"} last={last} />;
}
