import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getDocumentsWithTags, getTenant, getChatSessions } from "@/lib/server/data";
import { guideStatus, guideSessions } from "@/lib/server/portal-guide";
import { invenstorySuggestions, guideSuggestions } from "@/lib/chat-suggestions";
import ChatView from "@/components/ChatView";

// Two tabs (patch 16, onboarding build, 3 Nov 2026): Chat with your
// Inven(s)tory, and the Portal Guide (?tab=guide).
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "chat");
  const [{ tab }, tenant, docs, sessions, status, guideConvos] = await Promise.all([
    searchParams,
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId, session.role !== "admin"),
    getChatSessions(session.tenantId, session.user.id),
    guideStatus(session),
    guideSessions(session.tenantId, session.user.id),
  ]);
  if (!tenant) redirect("/");
  const ready = docs.filter(d => d.status === "ready").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const invSuggest = invenstorySuggestions({
    recentDoc: ready[0] ? { title: ready[0].title, at: ready[0].created_at } : null,
    hasMatches: status.hasMatches, docCount: docs.length,
  });
  return (
    <ChatView tenantName={tenant.name} isAdmin={session.role === "admin"} sessions={sessions}
      guideSessions={guideConvos} initialTab={tab === "guide" ? "guide" : "invenstory"}
      invSuggest={invSuggest} guideSuggest={guideSuggestions(status)} />
  );
}
