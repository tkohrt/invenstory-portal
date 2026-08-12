import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getDocumentsWithTags, getTenant, getChatSessions } from "@/lib/server/data";
import ChatView from "@/components/ChatView";

export default async function ChatPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "chat");
  const [tenant, docs, sessions] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId, session.role !== "admin"),
    getChatSessions(session.tenantId, session.user.id),
  ]);
  if (!tenant) redirect("/");
  return <ChatView tenantName={tenant.name} docs={docs} isAdmin={session.role === "admin"} sessions={sessions} />;
}
