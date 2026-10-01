import "server-only";
// What the Draft an Application pages need to know: how far Standard Answers
// has got, and which application was worked on last.
//
// "Finished" means every RECOMMENDED Standard Answers question has an approved
// answer, not every question: the bank grows, and a gate that grows with it
// becomes a wall. Recommended is the same rule the Storyboard uses
// (recommendSection), so the two never disagree about what counts.
import { userClient } from "./supabase";
import { placeable } from "@/lib/card-sensitivity";
import { recommendSection } from "@/lib/story-card-rank";
import { SLUG_KINDS } from "@/lib/application-parse";
import { kindsFor } from "@/lib/story-card";


export interface StandardProgress { approved: number; recommended: number; finished: boolean; started: boolean }

export async function standardAnswersProgress(tenantId: string): Promise<StandardProgress> {
  const s = await userClient();
  const [{ data: prof }, { data: bank }, { data: cards }, { data: draft }, { data: answers }] = await Promise.all([
    s.from("eligibility_profile").select("org_type").eq("tenant_id", tenantId).maybeSingle(),
    s.from("grant_question").select("slug, audience, origin, observed, wanted_kinds").eq("active", true),
    s.from("story_card").select("kind, sensitive, sensitive_cleared").eq("tenant_id", tenantId).neq("status", "retired"),
    s.from("grant_draft").select("id").eq("tenant_id", tenantId).eq("purpose", "standard_answers").maybeSingle(),
    s.from("answer").select("status, draft_section_id, question:question_id(slug)").eq("tenant_id", tenantId).eq("status", "published"),
  ]);
  const orgType = (prof?.org_type as string | null) ?? null;
  const branch = orgType === "for_profit" ? "startup" : "nonprofit";
  const allowed = new Set(kindsFor(orgType).map(k => k.key));
  const kindsAvailable = new Set(((cards ?? []) as { kind: string; sensitive: boolean; sensitive_cleared: string | null }[])
    .filter(c => placeable({ sensitive: c.sensitive, sensitiveCleared: c.sensitive_cleared as never })).map(c => c.kind));
  type Q = { slug: string; audience: string; origin: "seed" | "observed"; observed: number; wanted_kinds: string[] | null };
  const questions = ((bank ?? []) as Q[]).filter(q => q.audience === "both" || q.audience === branch);
  const approvedSlugs = new Set(((answers ?? []) as unknown as { draft_section_id: string | null; question: { slug: string } | null }[])
    .filter(a => a.draft_section_id && a.question?.slug).map(a => a.question!.slug));

  let recommended = 0, approved = 0;
  for (const q of questions) {
    const wanted = ((q.wanted_kinds?.length ? q.wanted_kinds : SLUG_KINDS[q.slug]) ?? []).filter(k => allowed.has(k));
    if (!recommendSection({ origin: q.origin, observed: q.observed }, wanted, kindsAvailable).recommended) continue;
    recommended += 1;
    if (approvedSlugs.has(q.slug)) approved += 1;
  }
  return { approved, recommended, finished: recommended > 0 && approved >= recommended, started: !!draft };
}

export interface LastDraft { id: string; title: string; funder: string | null; updatedAt: string }

/** The application worked on most recently, for "Continue". Standard Answers and submitted ones are left out. */
export async function lastApplication(tenantId: string): Promise<LastDraft | null> {
  const s = await userClient();
  const { data } = await s.from("grant_draft").select("id, title, funder, updated_at, status, purpose")
    .eq("tenant_id", tenantId).eq("mode", "cards").neq("purpose", "standard_answers")
    .in("status", ["drafting", "client_review", "completed"])
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { id: data.id as string, title: data.title as string, funder: (data.funder as string | null) ?? null, updatedAt: data.updated_at as string } : null;
}
