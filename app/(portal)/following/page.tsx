import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getWorkspaceVisibility } from "@/lib/server/data";
import { closedInBrain } from "@/lib/server/brain";
import { getSavedItems } from "@/lib/server/saved";
import FollowingView from "@/components/FollowingView";

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
  if (!isAdmin) {
    const vis = await getWorkspaceVisibility(session.tenantId);
    if (!(vis.funder_matches === true || vis.funder_compass === true)) redirect("/invenstory");
  }
  const sp = await searchParams;
  const items = await getSavedItems(session.tenantId);
  return <FollowingView items={items} preview={isAdmin && sp.view === "client"} />;
}
