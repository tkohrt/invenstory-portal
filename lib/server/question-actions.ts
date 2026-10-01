"use server";
// Question bank actions (admin only). Approved Standard Answers are written by
// approveStandardAnswerAction in workspace-actions.ts.
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
