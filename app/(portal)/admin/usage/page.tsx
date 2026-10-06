// AI usage across every client: chat questions against the limits, AI spend by
// client and feature, and requests for more (6 October 2026). For Granted only.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getUsageOverview } from "@/lib/server/usage-read";
import AdminUsageView from "@/components/AdminUsageView";

export default async function AdminUsagePage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const data = await getUsageOverview().catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Usage could not be read." }));
  return <AdminUsageView data={data} />;
}
