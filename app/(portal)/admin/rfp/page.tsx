import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { rfpAdminStatus } from "@/lib/server/rfp-golden-run";
import RfpEngineAdminView from "@/components/RfpEngineAdminView";

export default async function RfpEngineAdminPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  return <RfpEngineAdminView status={await rfpAdminStatus()} />;
}
