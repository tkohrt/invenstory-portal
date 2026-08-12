import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant, getAnswerLibrary } from "@/lib/server/data";
import { gateFeature } from "@/lib/server/gate";
import AnswerLibraryView from "@/components/AnswerLibraryView";

export default async function AnswerLibraryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "answer_library");
  const tenant = await getTenant(session.tenantId);
  if (!tenant) redirect("/");
  const items = await getAnswerLibrary(session.tenantId, tenant.org_type);
  return <AnswerLibraryView items={items} isAdmin={session.role === "admin"} tenantName={tenant.name} />;
}
