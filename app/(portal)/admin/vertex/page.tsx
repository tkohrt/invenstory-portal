import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { runVertexCheck } from "@/lib/server/vertex-check";
import VertexCheckView from "@/components/VertexCheckView";

export default async function VertexDiagPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  return <VertexCheckView initial={await runVertexCheck()} />;
}
