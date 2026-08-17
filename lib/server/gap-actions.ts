"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { analyzeContentGaps } from "./gap-agent";

export async function runGapAnalysisAction() {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const gaps = await analyzeContentGaps(s.tenantId);
  await db.from("eligibility_gap").upsert(
    { tenant_id: s.tenantId, content_gaps: gaps, computed_at: new Date().toISOString() },
    { onConflict: "tenant_id" });
  revalidatePath("/funding-eligibility"); revalidatePath("/invenstory");
  return { ok: true, count: gaps.length };
}
