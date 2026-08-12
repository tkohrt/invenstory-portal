"use server";
// Answer Library actions. Generation may be run by a client or admin for the
// active tenant. Edit + mark-reviewed promote an answer's source to 'human' and
// are tenant-scoped server-side. Question-bank CRUD is admin-only.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { generateAnswers } from "./answers";

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

export async function generateAnswersAction() {
  const s = await requireSession();
  const { data: t } = await db.from("tenant").select("org_type").eq("id", s.tenantId).single();
  await generateAnswers(s.tenantId, (t?.org_type as "nonprofit" | "startup" | null) ?? null);
  revalidatePath("/answer-library");
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
}) {
  await requireAdmin();
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  if (input.id) {
    await db.from("grant_question").update({
      category: input.category, prompt_text: input.prompt_text, guidance: input.guidance || null,
      audience: input.audience, sort_order: input.sort_order, active: input.active,
    }).eq("id", input.id);
  } else {
    await db.from("grant_question").insert({
      slug: `${slugify(input.prompt_text || input.category)}-${Math.random().toString(36).slice(2, 6)}`,
      category: input.category, prompt_text: input.prompt_text, guidance: input.guidance || null,
      audience: input.audience, sort_order: input.sort_order, active: input.active,
    });
  }
  revalidatePath("/admin/questions");
}

export async function deleteQuestionAction(id: string) {
  await requireAdmin();
  await db.from("grant_question").delete().eq("id", id);
  revalidatePath("/admin/questions");
}
