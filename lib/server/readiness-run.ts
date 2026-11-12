import "server-only";
import { db } from "./db";
import { withAiUsage, type UsageCtx } from "./ai-usage";

/**
 * Run the document-extraction readiness check and store the coverage.
 * Factored out of gap-actions (patch 29) so onboarding's finish can auto-run
 * it: the first portal view should show an assessed score, not a button. The
 * Run Readiness Check action and the admin refresh-all both call this too.
 */
export async function runExtractionCoverage(
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
