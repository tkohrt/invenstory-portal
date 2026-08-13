import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getPortfolioStats } from "@/lib/server/data";
import { getGardenSummaries } from "@/lib/server/garden";
import AdminClientsView from "@/components/AdminClientsView";

export default async function ClientsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const [portfolio, gardens] = await Promise.all([getPortfolioStats(), getGardenSummaries()]);
  return <AdminClientsView portfolio={portfolio} gardens={gardens} />;
}
