import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getTenant } from "@/lib/server/data";
import ChatView from "@/components/ChatView";

export default async function ChatPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, docs] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId),
  ]);
  if (!tenant) redirect("/");
  return <ChatView tenantName={tenant.name} docs={docs} isAdmin={session.role === "admin"} />;
}
