import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getPortfolioStats } from "@/lib/server/data";
import AdminClientsView from "@/components/AdminClientsView";

export default async function ClientsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  return <AdminClientsView portfolio={await getPortfolioStats()} />;
}
