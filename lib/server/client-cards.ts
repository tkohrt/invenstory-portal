import "server-only";
// A client's own Story Cards, as the client sees them.
//
// Through userClient: 0043 lets a signed-in client read its own cards, their
// versions and their evidence, and nothing else. What the reader refused, the
// raw candidates, possible-duplicate flags and every working signal stay in For
// Granted's Card Library.
import { userClient } from "./supabase";
import { CARD_KIND_MAP } from "@/lib/story-card";

export interface ClientCard {
  id: string; kind: string; kindLabel: string; statement: string;
  status: "suggested" | "verified"; verifiedByRole: "admin" | "client" | null;
  layer: "I" | "II" | "III" | null; sensitive: boolean; sensitiveCleared: string | null;
  edited: boolean; createdAt: string;
  evidence: { title: string; quote: string }[];
}

export async function getClientCards(tenantId: string): Promise<ClientCard[]> {
  const s = await userClient();
  const { data, error } = await s.from("story_card")
    .select("id, kind, statement, status, verified_by_role, layer, sensitive, sensitive_cleared, statement_origin, created_at, "
      + "story_card_evidence(quote, document:document_id(title, status))")
    .eq("tenant_id", tenantId).neq("status", "retired").order("created_at");
  if (error) throw new Error(`Could not read your Story Cards: ${error.message}`);
  type Ev = { quote: string; document: { title: string; status: string } | null };
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
    id: r.id as string, kind: r.kind as string,
    kindLabel: CARD_KIND_MAP[r.kind as string]?.label ?? (r.kind as string),
    statement: r.statement as string,
    status: r.status as ClientCard["status"],
    verifiedByRole: (r.verified_by_role as ClientCard["verifiedByRole"]) ?? null,
    layer: (r.layer as ClientCard["layer"]) ?? null,
    sensitive: !!r.sensitive, sensitiveCleared: (r.sensitive_cleared as string | null) ?? null,
    edited: r.statement_origin === "human", createdAt: r.created_at as string,
    evidence: ((r.story_card_evidence as Ev[]) ?? []).filter(e => e.document?.status === "ready")
      .map(e => ({ title: e.document!.title, quote: e.quote })),
  }));
}

/** How many cards are waiting for the client to look at, for the sidebar badge. */
export async function clientCardsWaiting(tenantId: string): Promise<number> {
  const s = await userClient();
  const { count } = await s.from("story_card").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("status", "suggested");
  return count ?? 0;
}
