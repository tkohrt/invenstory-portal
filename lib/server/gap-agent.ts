import "server-only";
import { db } from "./db";
import { userClient } from "./supabase";
import { embedTexts } from "./embed";
import { chatComplete, generationConfigured } from "./llm";
import type { Gap } from "@/lib/eligibility-fields";
import { checklistFor, readinessPct, TIER_WEIGHT, type ChecklistItem } from "@/lib/checklist";

export type CoverState = "covered" | "thin" | "missing";
export type Coverage = Record<string, CoverState>;

// Targeted retrieval: for each checklist item, pull the chunks most semantically
// related to it, so coverage is judged on the RIGHT passages (not a fixed sample)
// and the whole inventory is in scope regardless of size.
interface Evidence { key: string; label: string; titles: string[]; snippets: string[]; maxSim: number }

async function gatherEvidence(tenantId: string, items: ChecklistItem[]): Promise<Evidence[] | null> {
  const supabase = await userClient();
  const vectors = await embedTexts(items.map(i => i.label));
  if (!vectors) return null; // caller falls back to the digest method
  const results = await Promise.all(items.map(async (it, idx) => {
    const v = vectors[idx];
    const ev: Evidence = { key: it.key, label: it.label, titles: [], snippets: [], maxSim: 0 };
    if (!v) return ev;
    const { data } = await supabase.rpc("match_chunks", { p_query_embedding: JSON.stringify(v), p_match_count: 6 });
    const rows = ((data ?? []) as { tenant_id: string; title: string; text: string; similarity: number }[])
      .filter(r => r.tenant_id === tenantId)   // admins have RLS lifted; scope to the viewed tenant
      .slice(0, 4);
    ev.maxSim = rows.reduce((m, r) => Math.max(m, r.similarity), 0);
    ev.titles = [...new Set(rows.map(r => r.title))];
    ev.snippets = rows.map(r => (r.text ?? "").slice(0, 180));
    return ev;
  }));
  return results;
}

// Fallback when embeddings are unavailable: title + a small text digest.
async function digestFallback(tenantId: string, items: ChecklistItem[]): Promise<Coverage> {
  const cov: Coverage = {}; items.forEach(i => cov[i.key] = "missing");
  const [{ data: docs }, { data: chunks }] = await Promise.all([
    db.from("document").select("title, layer").eq("tenant_id", tenantId).eq("status", "ready"),
    db.from("document_chunk").select("text").eq("tenant_id", tenantId).limit(24),
  ]);
  if ((docs ?? []).length === 0 || !generationConfigured()) return cov;
  const digest = "DOCUMENTS:\n" + (docs ?? []).map(d => `- [L${d.layer}] ${d.title}`).join("\n") +
    "\n\nCONTENT SAMPLE:\n" + (chunks ?? []).map(c => (c.text ?? "").slice(0, 200)).join("\n---\n").slice(0, 6000);
  return classify(items, digest);
}

// The wide-berth classifier. Given per-item evidence (or a digest), decide
// covered / thin / missing, biased hard AGAINST false "missing".
const WIDE_BERTH =
  "You are grading whether an organization's Inven(s)tory covers each checklist item. " +
  "For each item return one of: 'covered' (the documents substantively address it), " +
  "'thin' (there is related content but it is light or partial), or 'missing' (there is " +
  "genuinely nothing related). CRITICAL RULES: never mark 'missing' if the evidence contains " +
  "ANYTHING related to the item — mark 'thin' instead. When unsure between 'covered' and " +
  "'thin', choose 'covered'. A matching document title alone is enough to be at least 'thin'. " +
  "The goal is to NEVER ask a client to add something they already have. " +
  "Return STRICT JSON only: an object mapping each item key to 'covered' | 'thin' | 'missing'.";

async function classify(items: ChecklistItem[], evidenceText: string): Promise<Coverage> {
  const cov: Coverage = {}; items.forEach(i => cov[i.key] = "missing");
  const list = items.map(i => `${i.key}: ${i.label}`).join("\n");
  const res = await chatComplete({ system: WIDE_BERTH + "\n\nCHECKLIST:\n" + list, user: evidenceText, maxTokens: 900, temperature: 0 });
  if (!res) return cov;
  try {
    const m = res.text.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); items.forEach(i => { const v = p[i.key]; if (v === "covered" || v === "thin" || v === "missing") cov[i.key] = v; }); }
  } catch { /* leave missing on parse error */ }
  return cov;
}

export async function analyzeContentCoverage(tenantId: string, orgType: string | null): Promise<Coverage> {
  const items = checklistFor(orgType);
  const cov: Coverage = {}; items.forEach(i => cov[i.key] = "missing");
  const { count } = await db.from("document").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "ready");
  if (!count) return cov; // empty inventory → all missing
  if (!generationConfigured()) return cov;

  const evidence = await gatherEvidence(tenantId, items);
  if (!evidence) return digestFallback(tenantId, items); // no embeddings → digest method

  // Deterministic floor from retrieval similarity, then LLM refines (wide berth).
  const STRONG = 0.62, SOME = 0.40;
  const packed = evidence.map(e => {
    const titles = e.titles.length ? `TITLES: ${e.titles.join("; ")}` : "TITLES: (none matched)";
    const snips = e.snippets.length ? e.snippets.map(s => `• ${s}`).join("\n") : "(no related passages retrieved)";
    return `## ${e.key} — ${e.label}\n${titles}\ntopMatch=${e.maxSim.toFixed(2)}\n${snips}`;
  }).join("\n\n");
  const llm = await classify(items, "Evidence retrieved per item:\n\n" + packed);
  // apply the floor: strong similarity can't be downgraded below 'thin'
  const bySim = new Map(evidence.map(e => [e.key, e.maxSim]));
  items.forEach(i => {
    const sim = bySim.get(i.key) ?? 0;
    if (sim >= STRONG && llm[i.key] === "missing") llm[i.key] = "thin";
    if (sim >= SOME && llm[i.key] === "missing") llm[i.key] = "thin";
  });
  return llm;
}

export async function getContentCoverage(tenantId: string): Promise<{ cov: Coverage; computedAt: string | null }> {
  const { data } = await db.from("eligibility_gap").select("content_gaps, computed_at").eq("tenant_id", tenantId).maybeSingle();
  const raw = data?.content_gaps;
  const cov = (raw && !Array.isArray(raw)) ? (raw as Coverage) : {};
  return { cov, computedAt: data?.computed_at ?? null };
}

// Missing AND thin become gaps. Thin is a "strengthen" gap (has some info).
export function coverageGaps(orgType: string | null, cov: Coverage): Gap[] {
  return checklistFor(orgType)
    .filter(i => cov[i.key] === "missing" || cov[i.key] === "thin")
    .map(i => cov[i.key] === "thin"
      ? { tier: i.tier, key: i.key, label: `${i.label}: found but thin — add more or write about it.`, fix: "upload" as const, layer: i.layer, weak: true }
      : { tier: i.tier, key: i.key, label: i.gap, fix: "upload" as const, layer: i.layer });
}

// Weighted readiness: covered = full, thin = half, missing = 0.
export function readiness(orgType: string | null, cov: Coverage): {
  pct: number; items: { key: string; label: string; tier: ChecklistItem["tier"]; layer: string; state: CoverState }[];
} {
  const items = checklistFor(orgType);
  const total = items.reduce((a, i) => a + TIER_WEIGHT[i.tier], 0) || 1;
  const got = items.reduce((a, i) => a + TIER_WEIGHT[i.tier] * (cov[i.key] === "covered" ? 1 : cov[i.key] === "thin" ? 0.5 : 0), 0);
  return {
    pct: Math.round((got / total) * 100),
    items: items.map(i => ({ key: i.key, label: i.label, tier: i.tier, layer: i.layer, state: (cov[i.key] ?? "missing") as CoverState })),
  };
}
