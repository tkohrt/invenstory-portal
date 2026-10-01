// Create New Draft: Standard Answers first, unless they are finished.
//
// The portal decides which screen to show rather than asking. When every
// recommended Standard Answers question is approved, this goes straight to
// bringing in the funder's application. Otherwise it explains the approach,
// shows the progress, and offers to carry on, with a quieter way to start the
// application anyway: a grant due Friday is never held up by the common app.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { standardAnswersProgress } from "@/lib/server/draft-start";
import StandardAnswersIntro from "@/components/StandardAnswersIntro";

export default async function DraftNewPage({ searchParams }: { searchParams: Promise<{ grant?: string; funder?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "draft_application");
  if (session.role !== "admin") redirect("/draft");
  const sp = await searchParams;
  const carry = sp.grant ? `?grant=${encodeURIComponent(sp.grant)}` : sp.funder ? `?funder=${encodeURIComponent(sp.funder)}` : "";
  const [tenant, progress] = await Promise.all([getTenant(session.tenantId), standardAnswersProgress(session.tenantId)]);
  if (progress.finished) redirect(`/drafts/new${carry}`);
  return <StandardAnswersIntro tenantName={tenant?.name ?? "this client"} progress={progress} skipHref={`/drafts/new${carry}`} />;
}
