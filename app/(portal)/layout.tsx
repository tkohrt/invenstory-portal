import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/server/session";
import { getWorkspaceVisibility, getNavArtifactTypes, getPendingReviews, getTenants } from "@/lib/server/data";
import { userClient } from "@/lib/server/supabase";
import { getGardenState } from "@/lib/server/garden";
import { getOverlayPendingCount } from "@/lib/server/ledger-overlay";
import { clientCardsWaiting } from "@/lib/server/client-cards";
import { tenantIsBrain } from "@/lib/server/brain";
import { getSetupState, ownerName } from "@/lib/server/setup";
import { setupGate } from "@/lib/setup";
import SetupUnderWay from "@/components/SetupUnderWay";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");
  const db = await userClient();
  // The Brain grows no plant (Auto-Draft patch 3): its garden is never read, so
  // no achievement is ever written for it.
  const brain = await tenantIsBrain(session.tenantId);
  // Company setup (patch 14): the first client user is taken through it; the
  // rest see a note. Never For Granted, never the Brain, never a client from
  // before 0077, and nobody at all if the table cannot be read.
  const gate = setupGate(await getSetupState(session.tenantId), session.user, brain);
  if (gate.kind === "run") redirect("/setup");
  const setupBy = gate.kind === "wait" ? await ownerName(session.tenantId, (await getSetupState(session.tenantId))?.ownerUserId ?? null) : null;
  const [tenants, types, pending, workspaceVis, garden, overlayPending] = await Promise.all([
    getTenants(),
    getNavArtifactTypes(session.tenantId, session.role === "admin"),
    session.role === "admin" ? getPendingReviews() : Promise.resolve([]),
    getWorkspaceVisibility(session.tenantId),
    brain ? Promise.resolve(null) : getGardenState(session.tenantId),
    session.role === "admin" ? getOverlayPendingCount() : Promise.resolve(0),
  ]);
  // The sidebar badge on Story Cards, only where the page is on.
  const storyCardsWaiting = workspaceVis.card_review && !brain ? await clientCardsWaiting(session.tenantId).catch(() => 0) : 0;
  return (
    <Shell user={session.user} role={session.role} tenantId={session.tenantId}
      tenants={tenants} artifactTypes={types} pendingCount={pending.length} overlayPendingCount={overlayPending} workspaceVis={workspaceVis} garden={garden} storyCardsWaiting={storyCardsWaiting}>
      {gate.kind === "wait" && <SetupUnderWay by={setupBy} done={gate.done} total={gate.total} />}
      {children}
    </Shell>
  );
}
