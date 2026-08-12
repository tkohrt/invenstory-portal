import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/server/session";
import { getFeatureVisible, getNavArtifactTypes, getPendingReviews, getTenants } from "@/lib/server/data";
import { userClient } from "@/lib/server/supabase";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");
  const db = await userClient();
  const [tenants, types, pending, answerLibraryVisible] = await Promise.all([
    getTenants(),
    getNavArtifactTypes(session.tenantId, session.role === "admin"),
    session.role === "admin" ? getPendingReviews() : Promise.resolve([]),
    getFeatureVisible(session.tenantId, "answer_library"),
  ]);
  return (
    <Shell user={session.user} role={session.role} tenantId={session.tenantId}
      tenants={tenants} artifactTypes={types} pendingCount={pending.length} answerLibraryVisible={answerLibraryVisible}>
      {children}
    </Shell>
  );
}
