"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { withAiUsage, type UsageCtx } from "./ai-usage";
import { checkAllowance } from "./allowance";
import { onAnalysis } from "./analysis-source";
import { applyReadiness } from "./analysis-switch";
import { getEligibilityProfile } from "./eligibility";

async function storeExtractionCoverage(
  tenantId: string, orgType: string | null,
  who: Pick<UsageCtx, "actor" | "userId"> = { actor: "admin" },
): Promise<{ covered: number; thin: number; missing: number }> {
  const { extractDocumentEvidence } = await import("./doc-extract");
  const trace = await withAiUsage({ tenantId, ...who, feature: "readiness_refresh" }, () => extractDocumentEvidence(tenantId, orgType));
  const cov: Record<string, { state: string; sources: { id: string; title: string; quote?: string }[] }> = {};
  const counts = { covered: 0, thin: 0, missing: 0 } as Record<string, number>;
  for (const it of trace.items) {
    const seen = new Set<string>(); const sources: { id: string; title: string; quote?: string }[] = [];
    for (const e of it.evidence) { if (e.documentId && !seen.has(e.documentId)) { seen.add(e.documentId); sources.push({ id: e.documentId, title: e.title, quote: (e.quote || "").trim() || undefined }); } }
    cov[it.key] = { state: it.state, sources: it.state !== "missing" ? sources : [] };
    counts[it.state] = (counts[it.state] ?? 0) + 1;
  }
  await db.from("eligibility_gap").upsert(
    { tenant_id: tenantId, content_gaps: cov, computed_at: new Date().toISOString() },
    { onConflict: "tenant_id" });
  return { covered: counts.covered, thin: counts.thin, missing: counts.missing };
}

/**
 * Run Readiness Check. A client can press it, so it is metered as whoever
 * pressed it (until 6 October 2026 every run was recorded as For Granted's,
 * which hid the most expensive thing a client could start), and a client's
 * press is held to the monthly AI allowance (Phase D).
 */
export async function runGapAnalysisAction(): Promise<{ ok: true } | { ok: false; allowance: string }> {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  // Phase D: on the analysis, readiness is worked out from what it stored. Free,
  // so it is never held to the allowance.
  if (await onAnalysis(s.tenantId)) {
    await applyReadiness(s.tenantId);
    revalidatePath("/funding-eligibility"); revalidatePath("/invenstory");
    return { ok: true };
  }
  const actor = s.role === "admin" ? "admin" : "client";
  const allowance = await checkAllowance(actor, s.tenantId);
  if (!allowance.ok) return { ok: false, allowance: allowance.message };
  const profile = await getEligibilityProfile(s.tenantId);
  await storeExtractionCoverage(s.tenantId, profile.org_type, { actor, userId: s.user.id });
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
      if (await onAnalysis(t.id)) {
        // On the analysis: free, from what it stored.
        await applyReadiness(t.id);
        results.push({ tenant: `${t.name} (from the analysis)`, ok: true });
        continue;
      }
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
  return withAiUsage({ tenantId: s.tenantId, userId: s.user.id, actor: "admin", feature: "readiness_audit" }, () => traceContentCoverage(s.tenantId, profile.org_type));
}

export async function runDocExtractionAuditAction() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("unauthorized");
  const profile = await getEligibilityProfile(s.tenantId);
  const { extractDocumentEvidence } = await import("./doc-extract");
  return withAiUsage({ tenantId: s.tenantId, userId: s.user.id, actor: "admin", feature: "readiness_audit" }, () => extractDocumentEvidence(s.tenantId, profile.org_type));
}
