import { redirect } from "next/navigation";
import { getFeatureVisible } from "./data";

// Client-side route gate for toggleable Workspace features. Admins always pass.
// A client hitting a hidden feature is sent to the always-visible Inven(s)tory.
export async function gateFeature(
  role: "client" | "admin", tenantId: string, featureKey: string,
): Promise<void> {
  if (role === "admin") return;
  const visible = await getFeatureVisible(tenantId, featureKey);
  if (!visible) redirect("/invenstory");
}
