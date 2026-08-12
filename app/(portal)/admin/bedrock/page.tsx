import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { runBedrockCheck } from "@/lib/server/bedrock-check";
import BedrockCheckView from "@/components/BedrockCheckView";

export default async function BedrockDiagPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const initial = await runBedrockCheck();
  return <BedrockCheckView initial={initial} />;
}
