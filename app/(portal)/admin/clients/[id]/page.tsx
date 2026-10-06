// Admin, Client activity: one client, one month (Eastern time). For Granted only.
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getClientActivity } from "@/lib/server/activity-read";
import { isMonthKey } from "@/lib/activity";
import { monthKey } from "@/lib/usage-limits";
import ClientActivityView from "@/components/ClientActivityView";

export default async function ClientActivityPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const [{ id }, { m }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const month = isMonthKey(m) ? m : monthKey(new Date());
  const data = await getClientActivity(id, month);
  if (!data) notFound();
  return <ClientActivityView data={data} />;
}
