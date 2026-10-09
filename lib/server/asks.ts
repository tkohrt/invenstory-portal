import "server-only";
// Reading the questions For Granted asked a client (0058, 9 October 2026).
// Through userClient, so RLS decides: a client reads its own, an admin any, and
// every query still names the tenant.
import { userClient } from "./supabase";
import { CARD_KIND_MAP } from "@/lib/story-card";
import type { GapAsk } from "@/lib/draft-gaps";

type Raw = Record<string, unknown>;

const COLS = "id, section_id, kind, question, status, answer, card_id, asked_at, answered_at";

const toAsk = (r: Raw): GapAsk => ({
  id: r.id as string, sectionId: (r.section_id as string | null) ?? null, kind: r.kind as string,
  question: r.question as string, status: r.status as GapAsk["status"],
  answer: (r.answer as string | null) ?? null, cardId: (r.card_id as string | null) ?? null,
  askedAt: r.asked_at as string, answeredAt: (r.answered_at as string | null) ?? null,
});

/** Every question asked for one draft, newest first. A missing table (0058 not run) reads as none. */
export async function asksForDraft(tenantId: string, draftId: string): Promise<GapAsk[]> {
  const s = await userClient();
  const { data, error } = await s.from("client_ask").select(COLS)
    .eq("tenant_id", tenantId).eq("draft_id", draftId).order("asked_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as Raw[]).map(toAsk);
}

export interface ClientAskItem extends GapAsk { kindLabel: string }

/** What the client sees on their Inven(s)tory page: questions waiting, and answers from the last two weeks. */
export async function asksForClient(tenantId: string): Promise<ClientAskItem[]> {
  const s = await userClient();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await s.from("client_ask").select(COLS)
    .eq("tenant_id", tenantId).in("status", ["open", "answered"]).order("asked_at", { ascending: true });
  if (error) return [];
  return ((data ?? []) as Raw[])
    .filter(r => r.status === "open" || ((r.answered_at as string | null) ?? "") >= since)
    .map(r => ({ ...toAsk(r), kindLabel: CARD_KIND_MAP[r.kind as string]?.label ?? (r.kind as string) }));
}
