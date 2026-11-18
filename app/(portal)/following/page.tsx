import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getWorkspaceVisibility } from "@/lib/server/data";
import { closedInBrain } from "@/lib/server/brain";
import { getSavedItems } from "@/lib/server/saved";
import FollowingView from "@/components/FollowingView";
import { getJudgments } from "@/lib/server/triage";
import { suppresses } from "@/lib/triage";

/**
 * Following (patch 66): the one list of what a client is tracking, shared
 * across the client's team: funders followed from a dossier, grants and
 * accelerators starred on Funding, and RFPs For Granted added. Open to a
 * client whenever either Funding mode is; never in the Brain. The calendar
 * view and each person's own email opt-in are later patches, by decision
 * (18 Nov 2026).
 */
export default async function FollowingPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  await closedInBrain(session.tenantId);
  const isAdmin = session.role === "admin";
  const sp = await searchParams;
  const preview = isAdmin && sp.view === "client";
  const [vis, items, judgments] = await Promise.all([
    getWorkspaceVisibility(session.tenantId),
    getSavedItems(session.tenantId),
    getJudgments(session.tenantId).catch(() => new Map()),
  ]);
  if (!isAdmin && !(vis.funder_matches === true || vis.funder_compass === true)) redirect("/invenstory");
  // What a client sees of funders follows the dossier's own rules (review of
  // patch 66): none while Funders mode is off, and never one For Granted has
  // since ruled out. The rows stay on file; For Granted still sees them.
  const asClient = !isAdmin || preview;
  const shown = !asClient ? items : items.filter(i => {
    if (i.kind !== "funder") return true;
    if (vis.funder_compass !== true) return false;
    const j = judgments.get(`funder:${i.target_id}`);
    return !(j && suppresses(j.state));
  });
  return <FollowingView items={shown} preview={preview} />;
}
