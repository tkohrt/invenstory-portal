"use server";
// Answer Library actions. Generation may be run by a client or admin for the
// active tenant. Edit + mark-reviewed promote an answer's source to 'human' and
// are tenant-scoped server-side. Question-bank CRUD is admin-only.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";

async function requireSession() {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  return s;
}
async function requireAdmin() {
  const s = await requireSession();
  if (s.role !== "admin") throw new Error("admin required");
  return s;
}

/**
 * Paused on 30 September 2026 (Story Card Drafter spec, section 16).
 *
 * Every export of a "use server" module is a public endpoint, so removing the
 * button is not enough: this refuses outright. The generator itself stays in
 * lib/server/answers.ts until Standard Answers ship in Phase 3, then goes.
 */
export async function generateAnswersAction(): Promise<never> {
  await requireSession();
  throw new Error("Answer generation is paused while the Answer Library moves to Story Cards.");
}

export async function editAnswerAction(questionId: string, field: "short_answer" | "long_answer", value: string) {
  const s = await requireSession();
  await db.from("answer").upsert({
    tenant_id: s.tenantId, question_id: questionId, [field]: value,
    source: "human", updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,question_id" });
  await db.from("answer_event").insert({ tenant_id: s.tenantId, question_id: questionId, kind: "human_edited" });
  revalidatePath("/answer-library");
}

export async function markAnswerReviewedAction(questionId: string) {
  const s = await requireSession();
  await db.from("answer").update({
    source: "human", status: "published", reviewed_by: s.user.id, reviewed_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("question_id", questionId);
  await db.from("answer_event").insert({ tenant_id: s.tenantId, question_id: questionId, kind: "reviewed" });
  revalidatePath("/answer-library");
}

// ---- Question-bank CRUD (admin) ----
export async function saveQuestionAction(input: {
  id?: string; category: string; prompt_text: string; guidance: string;
  audience: "nonprofit" | "startup" | "both"; sort_order: number; active: boolean;
  /** Typical answer length in words; null or 0 uses the proposed default. */
  typical_limit?: number | null;
}) {
  const typical = Number.isInteger(input.typical_limit) && (input.typical_limit as number) > 0 && (input.typical_limit as number) < 5000
    ? input.typical_limit : null;
  await requireAdmin();
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  if (input.id) {
    await db.from("grant_question").update({
      category: input.category, prompt_text: input.prompt_text, guidance: input.guidance || null,
      audience: input.audience, sort_order: input.sort_order, active: input.active, typical_limit: typical,
    }).eq("id", input.id);
  } else {
    await db.from("grant_question").insert({
      slug: `${slugify(input.prompt_text || input.category)}-${Math.random().toString(36).slice(2, 6)}`,
      category: input.category, prompt_text: input.prompt_text, guidance: input.guidance || null,
      audience: input.audience, sort_order: input.sort_order, active: input.active, typical_limit: typical,
    });
  }
  revalidatePath("/admin/questions");
}

export async function deleteQuestionAction(id: string) {
  await requireAdmin();
  await db.from("grant_question").delete().eq("id", id);
  revalidatePath("/admin/questions");
}
