// The Card Library for the client being viewed. Admin only: Decision 1 of the
// Story Card Drafter spec keeps it For Granted's working view in version 1.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getCardLibrary } from "@/lib/server/card-library";
import { latestJob } from "@/lib/server/jobs";
import CardLibraryView from "@/components/CardLibraryView";

export default async function CardLibraryPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const [tenant, data, job] = await Promise.all([
    getTenant(session.tenantId),
    getCardLibrary(session.tenantId),
    latestJob(session.tenantId, "cards"),
  ]);
  return <CardLibraryView orgName={tenant?.name ?? "this client"} data={data} job={job} />;
}
