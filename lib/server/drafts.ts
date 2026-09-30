import "server-only";
import { userClient } from "./supabase";
import type { DraftBracket, DraftSection, DraftWithBrackets, GrantDraft } from "@/lib/types";

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

// ---------------------------------------------------------------------------
// Card-mode drafts (Story Card Drafter, Phase 2). Admin views only: RLS keeps
// card-mode drafts and their sections away from client sessions (0041).
// ---------------------------------------------------------------------------

export async function getSections(tenantId: string, draftId: string): Promise<DraftSection[]> {
  const s = await userClient();
  const { data, error } = await s.from("draft_section")
    .select("id, draft_id, sort_order, prompt, guidance, limit_value, limit_unit, criteria, question_slugs, wanted_kinds, origin, in_source, match_reason, matched_prompt, confirmed")
    .eq("tenant_id", tenantId).eq("draft_id", draftId).order("sort_order");
  if (error) throw new Error(`Could not read the questions: ${error.message}`);
  return (data ?? []) as DraftSection[];
}

export interface BankOption { slug: string; category: string; prompt_text: string; audience: string }

/** The bank questions a question may be matched to by hand, for this client's org type. */
export async function getBankOptions(tenantId: string): Promise<BankOption[]> {
  const s = await userClient();
  const [{ data: prof }, { data: qs }] = await Promise.all([
    s.from("eligibility_profile").select("org_type").eq("tenant_id", tenantId).maybeSingle(),
    s.from("grant_question").select("slug, category, prompt_text, audience").eq("active", true).order("sort_order"),
  ]);
  const branch = prof?.org_type === "for_profit" ? "startup" : "nonprofit";
  return ((qs ?? []) as BankOption[]).filter(q => q.audience === "both" || q.audience === branch);
}

export interface MatchPrefill {
  title: string; funder: string; deadline: string; url: string; grantId?: string; funderId?: string;
}

/** What a Funder Matches row already knows, to start a draft from it. */
export async function getMatchPrefill(tenantId: string, ref: { grant?: string; funder?: string }): Promise<MatchPrefill | null> {
  const s = await userClient();
  if (ref.grant) {
    const { data } = await s.from("eligible_grant").select("grant_id, title, funder, url, close_date")
      .eq("tenant_id", tenantId).eq("grant_id", ref.grant).maybeSingle();
    if (!data) return null;
    return {
      title: data.title ?? "", funder: data.funder ?? "", deadline: data.close_date ?? "",
      url: data.url ?? "", grantId: data.grant_id,
    };
  }
  if (ref.funder) {
    const { data } = await s.from("matched_funder").select("funder_id, name, website")
      .eq("tenant_id", tenantId).eq("funder_id", ref.funder).maybeSingle();
    if (!data) return null;
    return { title: "", funder: data.name ?? "", deadline: "", url: data.website ?? "", funderId: data.funder_id };
  }
  return null;
}
