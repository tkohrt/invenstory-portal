"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";

export async function runGapAnalysisAction() {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const profile = await getEligibilityProfile(s.tenantId);
  const { extractDocumentEvidence } = await import("./doc-extract");
  const trace = await extractDocumentEvidence(s.tenantId, profile.org_type);
  const cov: Record<string, { state: string; sources: { id: string; title: string }[] }> = {};
  for (const it of trace.items) {
    const seen = new Set<string>(); const sources: { id: string; title: string }[] = [];
    for (const e of it.evidence) { if (e.documentId && !seen.has(e.documentId)) { seen.add(e.documentId); sources.push({ id: e.documentId, title: e.title }); } }
    cov[it.key] = { state: it.state, sources: it.state !== "missing" ? sources : [] };
  }
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
