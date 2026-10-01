// Start a draft from a funder's application. For Granted only.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getMatchPrefill } from "@/lib/server/drafts";
import NewApplicationView from "@/components/NewApplicationView";

export default async function NewApplicationPage({ searchParams }: {
  searchParams: Promise<{ grant?: string; funder?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const sp = await searchParams;
  const [tenant, prefill] = await Promise.all([
    getTenant(session.tenantId),
    sp.grant || sp.funder ? getMatchPrefill(session.tenantId, { grant: sp.grant, funder: sp.funder }) : Promise.resolve(null),
  ]);
  if (!tenant) redirect("/");
  return <NewApplicationView tenantName={tenant.name} prefill={prefill} />;
}
