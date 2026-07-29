import "server-only";
import { userClient } from "./supabase";
import type { DraftBracket, DraftWithBrackets, GrantDraft } from "@/lib/types";

// Extract [BRACKET] labels from a draft body, in order, de-duplicated.
export function parseBrackets(body: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\[([^\]]+)\]/g)) {
    const label = m[1].trim();
    if (label && !seen.has(label)) { seen.add(label); found.push(label); }
  }
  return found;
}

export async function getDrafts(tenantId: string): Promise<DraftWithBrackets[]> {
  const s = await userClient();
  const { data } = await s.from("grant_draft")
    .select("*, draft_bracket(*)").eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((d: GrantDraft & { draft_bracket: DraftBracket[] }) => {
    const brackets = (d.draft_bracket ?? []).sort((a, b) => a.sort_order - b.sort_order);
    return { ...d, brackets, answered_count: brackets.filter(b => b.answer).length };
  });
}

export async function getDraft(tenantId: string, id: string): Promise<DraftWithBrackets | null> {
  const s = await userClient();
  const { data: d } = await s.from("grant_draft")
    .select("*, draft_bracket(*)").eq("tenant_id", tenantId).eq("id", id).single();
  if (!d) return null;
  const brackets = (d.draft_bracket ?? []).sort((a: DraftBracket, b: DraftBracket) => a.sort_order - b.sort_order);
  return { ...d, brackets, answered_count: brackets.filter((b: DraftBracket) => b.answer).length };
}
