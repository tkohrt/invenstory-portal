// A client's own Story Cards: short batches to confirm, correct or mark out of
// date. Hidden until For Granted turns it on for the client (feature card_review).
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getClientCards } from "@/lib/server/client-cards";
import StoryCardsView from "@/components/StoryCardsView";

export default async function StoryCardsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await gateFeature(session.role, session.tenantId, "card_review");
  const [tenant, cards] = await Promise.all([getTenant(session.tenantId), getClientCards(session.tenantId)]);
  return <StoryCardsView orgName={tenant?.name ?? "Your organization"} cards={cards} isAdmin={session.role === "admin"} />;
}
