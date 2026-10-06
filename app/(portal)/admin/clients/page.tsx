import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getPortfolioStats } from "@/lib/server/data";
import { getGardenSummaries } from "@/lib/server/garden";
import { getPortfolioActivity } from "@/lib/server/activity-read";
import { isMonthKey } from "@/lib/activity";
import { monthKey } from "@/lib/usage-limits";
import AdminClientsView from "@/components/AdminClientsView";
import PortfolioActivity from "@/components/PortfolioActivity";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const { m } = await searchParams;
  const month = isMonthKey(m) ? m : monthKey(new Date());
  const [portfolio, gardens, activity] = await Promise.all([
    getPortfolioStats(), getGardenSummaries(),
    // A failure here never takes the clients list down with it.
    getPortfolioActivity(month).catch(() => null),
  ]);
  return (
    <>
      <AdminClientsView portfolio={portfolio} gardens={gardens} />
      {activity
        ? <PortfolioActivity data={activity} />
        : <div className="cl-error" style={{ marginTop: 18 }}>This month&rsquo;s activity could not be read.</div>}
    </>
  );
}
