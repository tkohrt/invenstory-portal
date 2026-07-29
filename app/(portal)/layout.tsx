import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { getSession } from "@/lib/server/session";
import { getPendingReviews, getTenants } from "@/lib/server/data";
import { db } from "@/lib/server/db";
import type { ArtifactType } from "@/lib/types";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/");
  const [tenants, { data: types }, pending] = await Promise.all([
    getTenants(),
    db.from("artifact_type").select("*").order("slug"),
    session.role === "admin" ? getPendingReviews() : Promise.resolve([]),
  ]);
  return (
    <Shell user={session.user} role={session.role} tenantId={session.tenantId}
      tenants={tenants} artifactTypes={(types ?? []) as ArtifactType[]} pendingCount={pending.length}>
      {children}
    </Shell>
  );
}
