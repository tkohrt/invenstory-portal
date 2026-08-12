import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getClientStats, getPortfolioStats, getTenant } from "@/lib/server/data";
import DashboardView from "@/components/DashboardView";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "dashboard");
  if (session.role === "admin") {
    const portfolio = await getPortfolioStats();
    return <DashboardView role="admin" portfolio={portfolio} />;
  }
  const [stats, tenant] = await Promise.all([getClientStats(session.tenantId), getTenant(session.tenantId)]);
  return <DashboardView role="client" orgName={tenant?.name ?? "Your organization"} stats={stats} />;
}
