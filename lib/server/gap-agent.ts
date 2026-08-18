import "server-only";
import { db } from "./db";
import { chatComplete, generationConfigured } from "./llm";
import type { Gap } from "@/lib/eligibility-fields";
import { checklistFor, readinessPct, type ChecklistItem } from "@/lib/checklist";

// Run the Bedrock coverage pass over a tenant's inventory against the full,
// org-type-aware document checklist. Returns a coverage map {itemKey: present}.
export async function analyzeContentCoverage(tenantId: string, orgType: string | null): Promise<Record<string, boolean>> {
  const items = checklistFor(orgType);
  const [{ data: docs }, { data: chunks }] = await Promise.all([
    db.from("document").select("title, layer").eq("tenant_id", tenantId).eq("status", "ready"),
    db.from("document_chunk").select("text").eq("tenant_id", tenantId).limit(24),
  ]);
  const D = docs ?? [];
  const cov: Record<string, boolean> = {};
  items.forEach(i => { cov[i.key] = false; });
  if (D.length === 0 || !generationConfigured()) return cov; // empty inventory / no model → all missing

  const digest =
    "DOCUMENTS:\n" + D.map(d => `- [L${d.layer}] ${d.title}`).join("\n") +
    "\n\nCONTENT SAMPLE:\n" + (chunks ?? []).map(c => (c.text ?? "").slice(0, 200)).join("\n---\n").slice(0, 6000);
  const list = items.map(i => `${i.key}: ${i.label}`).join("\n");
  const res = await chatComplete({
    system: "You assess whether an organization's document inventory covers each item in a checklist. " +
      "Return STRICT JSON only: an object mapping each item key to true (clearly present in the documents) or " +
      "false (missing or too weak to count). Be strict — mark true only if the documents actually contain it.\n\nCHECKLIST:\n" + list,
    user: digest,
    maxTokens: 700, temperature: 0,
  });
  if (!res) return cov;
  try {
    const m = res.text.match(/\{[\s\S]*\}/);
    if (m) { const parsed = JSON.parse(m[0]); items.forEach(i => { cov[i.key] = parsed[i.key] === true; }); }
  } catch { /* leave all-false on parse error */ }
  return cov;
}

export async function getContentCoverage(tenantId: string): Promise<{ cov: Record<string, boolean>; computedAt: string | null }> {
  const { data } = await db.from("eligibility_gap").select("content_gaps, computed_at").eq("tenant_id", tenantId).maybeSingle();
  // content_gaps now stores the coverage map (object), not a list.
  const raw = data?.content_gaps;
  const cov = (raw && !Array.isArray(raw)) ? (raw as Record<string, boolean>) : {};
  return { cov, computedAt: data?.computed_at ?? null };
}

// Turn coverage into gaps (missing items) using the checklist tiers.
export function coverageGaps(orgType: string | null, cov: Record<string, boolean>): Gap[] {
  return checklistFor(orgType)
    .filter(i => cov[i.key] === false)
    .map(i => ({ tier: i.tier, key: i.key, label: i.gap, fix: "upload" as const, layer: i.layer }));
}

// Weighted Inven(s)tory readiness (documents only) + per-item present/missing.
export function readiness(orgType: string | null, cov: Record<string, boolean>): {
  pct: number; items: { key: string; label: string; tier: ChecklistItem["tier"]; layer: string; present: boolean }[];
} {
  const items = checklistFor(orgType);
  const present = new Set(items.filter(i => cov[i.key]).map(i => i.key));
  return {
    pct: readinessPct(items, present),
    items: items.map(i => ({ key: i.key, label: i.label, tier: i.tier, layer: i.layer, present: !!cov[i.key] })),
  };
}
