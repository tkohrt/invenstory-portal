"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { analyzeContentCoverage } from "./gap-agent";
import { getEligibilityProfile } from "./eligibility";

export async function runGapAnalysisAction() {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const profile = await getEligibilityProfile(s.tenantId);
  const cov = await analyzeContentCoverage(s.tenantId, profile.org_type);
  await db.from("eligibility_gap").upsert(
    { tenant_id: s.tenantId, content_gaps: cov, computed_at: new Date().toISOString() },
    { onConflict: "tenant_id" });
  revalidatePath("/funding-eligibility"); revalidatePath("/invenstory");
  return { ok: true };
}

export async function runReadinessAuditAction() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("unauthorized");
  const profile = await getEligibilityProfile(s.tenantId);
  const { traceContentCoverage } = await import("./gap-agent");
  return traceContentCoverage(s.tenantId, profile.org_type);
}

export async function runDocExtractionAuditAction() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("unauthorized");
  const profile = await getEligibilityProfile(s.tenantId);
  const { extractDocumentEvidence } = await import("./doc-extract");
  return extractDocumentEvidence(s.tenantId, profile.org_type);
}
