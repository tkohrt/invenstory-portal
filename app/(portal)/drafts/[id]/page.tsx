import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getBankOptions, getDraft, getSections } from "@/lib/server/drafts";
import DraftDetailView from "@/components/DraftDetailView";
import ApplicationDraftView from "@/components/ApplicationDraftView";
import DraftWorkspace from "@/components/DraftWorkspace";
import { getWorkspace } from "@/lib/server/workspace";

// Confirming an application's questions re-matches any edited question to the
// question bank, which is a model call inside the confirm action.
export const maxDuration = 60;

export default async function DraftDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
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
    const { source_text, ...rest } = draft as typeof draft & { source_text?: string | null };
    // Confirmed questions open the drafting workspace (Phase 3). Until then the
    // page is the reading and confirmation screen (Phase 2).
    if (draft.confirmed_at) {
      const ws = await getWorkspace(session.tenantId, id);
      return <DraftWorkspace tenantName={tenant.name} draft={rest} ws={ws} sourceText={source_text ?? ""}
        initialQuestion={Math.max(1, Number.parseInt(q ?? "1", 10) || 1)} />;
    }
    const [sections, bank] = await Promise.all([getSections(session.tenantId, id), getBankOptions(session.tenantId)]);
    return <ApplicationDraftView tenantName={tenant.name} draft={rest} sections={sections} bank={bank} sourceText={source_text ?? ""} />;
  }
  return <DraftDetailView tenantName={tenant.name} draft={draft} isAdmin={session.role === "admin"} />;
}
