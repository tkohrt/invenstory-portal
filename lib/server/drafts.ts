import "server-only";
import { userClient } from "./supabase";
import type { DraftSection, GrantDraft } from "@/lib/types";

export async function getDrafts(tenantId: string): Promise<GrantDraft[]> {
  const s = await userClient();
  const { data } = await s.from("grant_draft").select("*").eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  return (data ?? []) as GrantDraft[];
}

export async function getDraft(tenantId: string, id: string): Promise<GrantDraft | null> {
  const s = await userClient();
  const { data } = await s.from("grant_draft").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return (data as GrantDraft | null) ?? null;
}

// ---------------------------------------------------------------------------
// Storyboarding Tool drafts. Admin views only: RLS keeps drafts and their
// sections away from client sessions (0041).
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

export interface DraftProgress { done: number; total: number; lastEdited: string }

/**
 * For the Drafts list: questions marked done of all questions, and when any of
 * them last changed, per card-mode draft. RLS keeps these rows to admins, so a
 * client session simply gets an empty map.
 */
export async function getDraftProgress(tenantId: string): Promise<Record<string, DraftProgress>> {
  const s = await userClient();
  const { data } = await s.from("draft_section").select("draft_id, status, updated_at").eq("tenant_id", tenantId);
  const out: Record<string, DraftProgress> = {};
  for (const r of (data ?? []) as { draft_id: string; status: string; updated_at: string }[]) {
    const p = out[r.draft_id] ??= { done: 0, total: 0, lastEdited: r.updated_at };
    p.total += 1;
    if (r.status === "done") p.done += 1;
    if (r.updated_at > p.lastEdited) p.lastEdited = r.updated_at;
  }
  return out;
}
