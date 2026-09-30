import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getBankOptions, getDraft, getSections } from "@/lib/server/drafts";
import DraftDetailView from "@/components/DraftDetailView";
import ApplicationDraftView from "@/components/ApplicationDraftView";

// Confirming an application's questions re-matches any edited question to the
// question bank, which is a model call inside the confirm action.
export const maxDuration = 60;

export default async function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "drafts");
  const [tenant, draft] = await Promise.all([getTenant(session.tenantId), getDraft(session.tenantId, id)]);
  if (!tenant) redirect("/");
  if (!draft) return <div className="empty">This draft doesn&rsquo;t exist.</div>;

  // A card-mode draft is For Granted's working tool. RLS already hides it from
  // client sessions; this is the second lock on the same door.
  if (draft.mode === "cards") {
    if (session.role !== "admin") return <div className="empty">This draft doesn&rsquo;t exist.</div>;
    const [sections, bank] = await Promise.all([getSections(session.tenantId, id), getBankOptions(session.tenantId)]);
    const { source_text, ...rest } = draft as typeof draft & { source_text?: string | null };
    return <ApplicationDraftView tenantName={tenant.name} draft={rest} sections={sections} bank={bank} sourceText={source_text ?? ""} />;
  }
  return <DraftDetailView tenantName={tenant.name} draft={draft} isAdmin={session.role === "admin"} />;
}
