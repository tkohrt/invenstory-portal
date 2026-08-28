import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/server/session";
import { getWorkspaceVisibility, getNavArtifactTypes, getPendingReviews, getTenants } from "@/lib/server/data";
import { userClient } from "@/lib/server/supabase";
import { getGardenState } from "@/lib/server/garden";
import { getOverlayPendingCount } from "@/lib/server/ledger-overlay";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");
  const db = await userClient();
  const [tenants, types, pending, workspaceVis, garden, overlayPending] = await Promise.all([
    getTenants(),
    getNavArtifactTypes(session.tenantId, session.role === "admin"),
    session.role === "admin" ? getPendingReviews() : Promise.resolve([]),
    getWorkspaceVisibility(session.tenantId),
    getGardenState(session.tenantId),
    session.role === "admin" ? getOverlayPendingCount() : Promise.resolve(0),
  ]);
  return (
    <Shell user={session.user} role={session.role} tenantId={session.tenantId}
      tenants={tenants} artifactTypes={types} pendingCount={pending.length} overlayPendingCount={overlayPending} workspaceVis={workspaceVis} garden={garden}>
      {children}
    </Shell>
  );
}
