"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";

async function storeExtractionCoverage(tenantId: string, orgType: string | null): Promise<{ covered: number; thin: number; missing: number }> {
  const { extractDocumentEvidence } = await import("./doc-extract");
  const trace = await extractDocumentEvidence(tenantId, orgType);
  const cov: Record<string, { state: string; sources: { id: string; title: string }[] }> = {};
  const counts = { covered: 0, thin: 0, missing: 0 } as Record<string, number>;
  for (const it of trace.items) {
    const seen = new Set<string>(); const sources: { id: string; title: string }[] = [];
    for (const e of it.evidence) { if (e.documentId && !seen.has(e.documentId)) { seen.add(e.documentId); sources.push({ id: e.documentId, title: e.title }); } }
    cov[it.key] = { state: it.state, sources: it.state !== "missing" ? sources : [] };
    counts[it.state] = (counts[it.state] ?? 0) + 1;
  }
  await db.from("eligibility_gap").upsert(
    { tenant_id: tenantId, content_gaps: cov, computed_at: new Date().toISOString() },
    { onConflict: "tenant_id" });
  return { covered: counts.covered, thin: counts.thin, missing: counts.missing };
}

export async function runGapAnalysisAction() {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const profile = await getEligibilityProfile(s.tenantId);
  await storeExtractionCoverage(s.tenantId, profile.org_type);
  revalidatePath("/funding-eligibility"); revalidatePath("/invenstory");
  return { ok: true };
}

export interface RefreshResult { tenant: string; ok: boolean; covered?: number; thin?: number; missing?: number; error?: string }
export async function refreshAllReadinessAction(): Promise<{ results: RefreshResult[] }> {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("unauthorized");
  const { data: tenants } = await db.from("tenant").select("id, name").order("name");
  const results: RefreshResult[] = [];
  for (const t of tenants ?? []) {
    try {
      const { data: prof } = await db.from("eligibility_profile").select("org_type").eq("tenant_id", t.id).maybeSingle();
      const c = await storeExtractionCoverage(t.id, (prof?.org_type as string | null) ?? null);
      results.push({ tenant: t.name, ok: true, ...c });
    } catch (e) { results.push({ tenant: t.name, ok: false, error: e instanceof Error ? e.message : "failed" }); }
  }
  revalidatePath("/invenstory"); revalidatePath("/funding-eligibility");
  return { results };
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
