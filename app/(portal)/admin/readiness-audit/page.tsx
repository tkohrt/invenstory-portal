import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import ReadinessAuditView from "@/components/ReadinessAuditView";

export default async function ReadinessAuditPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const tenant = await getTenant(session.tenantId);
  return <ReadinessAuditView tenantName={tenant?.name ?? "this client"} tenantId={session.tenantId} />;
}
