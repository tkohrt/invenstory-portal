import "server-only";
import { db } from "./db";
import { userClient } from "./supabase";
import { embedTexts } from "./embed";
import { chatComplete, generationConfigured } from "./llm";
import type { Gap } from "@/lib/eligibility-fields";
import { checklistFor, TIER_WEIGHT, BLURBS, type ChecklistItem, type ReadinessItem } from "@/lib/checklist";

export type CoverState = "covered" | "thin" | "missing";
export interface ItemCoverage { state: CoverState; sources: { id: string; title: string }[] }
export type Coverage = Record<string, ItemCoverage>;

interface Evidence { key: string; label: string; docs: { id: string; title: string }[]; snippets: string[]; maxSim: number }

async function gatherEvidence(tenantId: string, items: ChecklistItem[]): Promise<Evidence[] | null> {
  const supabase = await userClient();
  const vectors = await embedTexts(items.map(i => i.label));
  if (!vectors) return null;
  return Promise.all(items.map(async (it, idx) => {
    const v = vectors[idx];
    const ev: Evidence = { key: it.key, label: it.label, docs: [], snippets: [], maxSim: 0 };
    if (!v) return ev;
    const { data } = await supabase.rpc("match_chunks", { p_query_embedding: JSON.stringify(v), p_match_count: 6 });
    const rows = ((data ?? []) as { document_id: string; tenant_id: string; title: string; text: string; similarity: number }[])
      .filter(r => r.tenant_id === tenantId).slice(0, 4);
    ev.maxSim = rows.reduce((m, r) => Math.max(m, r.similarity), 0);
    const seen = new Set<string>();
    for (const r of rows) { if (!seen.has(r.document_id)) { seen.add(r.document_id); ev.docs.push({ id: r.document_id, title: r.title }); } }
    ev.snippets = rows.map(r => (r.text ?? "").slice(0, 180));
    return ev;
  }));
}

const WIDE_BERTH =
  "You are grading whether an organization's Inven(s)tory covers each checklist item. " +
  "For each item return one of: 'covered' (documents substantively address it), 'thin' (related but light/partial), " +
  "or 'missing' (genuinely nothing related). CRITICAL: never mark 'missing' if the evidence contains ANYTHING related — mark 'thin'. " +
  "When unsure between covered and thin, choose covered. A matching document title alone is enough to be at least 'thin'. " +
  "The goal is to NEVER ask a client to add something they already have. Return STRICT JSON only mapping each key to 'covered'|'thin'|'missing'.";

async function classify(items: ChecklistItem[], evidenceText: string): Promise<Record<string, CoverState>> {
  const out: Record<string, CoverState> = {}; items.forEach(i => out[i.key] = "missing");
  const list = items.map(i => `${i.key}: ${i.label}`).join("\n");
  const res = await chatComplete({ system: WIDE_BERTH + "\n\nCHECKLIST:\n" + list, user: evidenceText, maxTokens: 900, temperature: 0 });
  if (!res) return out;
  try { const m = res.text.match(/\{[\s\S]*\}/); if (m) { const p = JSON.parse(m[0]); items.forEach(i => { const v = p[i.key]; if (v === "covered" || v === "thin" || v === "missing") out[i.key] = v; }); } } catch { /* keep missing */ }
  return out;
}

export async function analyzeContentCoverage(tenantId: string, orgType: string | null): Promise<Coverage> {
  const items = checklistFor(orgType);
  const cov: Coverage = {}; items.forEach(i => cov[i.key] = { state: "missing", sources: [] });
  const { count } = await db.from("document").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "ready");
  if (!count || !generationConfigured()) return cov;

  const evidence = await gatherEvidence(tenantId, items);
  if (!evidence) { // fallback: whole-inventory digest, no per-item sources
    const [{ data: docs }, { data: chunks }] = await Promise.all([
      db.from("document").select("title, layer").eq("tenant_id", tenantId).eq("status", "ready"),
      db.from("document_chunk").select("text").eq("tenant_id", tenantId).limit(24),
    ]);
    const digest = "DOCUMENTS:\n" + (docs ?? []).map(d => `- [L${d.layer}] ${d.title}`).join("\n") +
      "\n\nCONTENT SAMPLE:\n" + (chunks ?? []).map(c => (c.text ?? "").slice(0, 200)).join("\n---\n").slice(0, 6000);
    const st = await classify(items, digest);
    items.forEach(i => cov[i.key] = { state: st[i.key], sources: [] });
    return cov;
  }

  const packed = evidence.map(e => {
    const titles = e.docs.length ? `TITLES: ${e.docs.map(d => d.title).join("; ")}` : "TITLES: (none matched)";
    const snips = e.snippets.length ? e.snippets.map(s => `• ${s}`).join("\n") : "(no related passages)";
    return `## ${e.key} — ${e.label}\n${titles}\ntopMatch=${e.maxSim.toFixed(2)}\n${snips}`;
  }).join("\n\n");
  const st = await classify(items, "Evidence retrieved per item:\n\n" + packed);
  const SOME = 0.40;
  const byEv = new Map(evidence.map(e => [e.key, e]));
  items.forEach(i => {
    const ev = byEv.get(i.key);
    if (ev && ev.maxSim >= SOME && st[i.key] === "missing") st[i.key] = "thin"; // floor
    cov[i.key] = { state: st[i.key], sources: st[i.key] !== "missing" ? (ev?.docs ?? []) : [] };
  });
  return cov;
}

export async function getContentCoverage(tenantId: string): Promise<{ cov: Coverage; computedAt: string | null }> {
  const { data } = await db.from("eligibility_gap").select("content_gaps, computed_at").eq("tenant_id", tenantId).maybeSingle();
  const raw = data?.content_gaps;
  const cov: Coverage = {};
  if (raw && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") cov[k] = { state: v as CoverState, sources: [] };           // legacy format
      else if (v && typeof v === "object") cov[k] = { state: (v as ItemCoverage).state ?? "missing", sources: (v as ItemCoverage).sources ?? [] };
    }
  }
  return { cov, computedAt: data?.computed_at ?? null };
}

export function coverageGaps(orgType: string | null, cov: Coverage): Gap[] {
  return checklistFor(orgType)
    .filter(i => (cov[i.key]?.state ?? "missing") !== "covered")
    .map(i => (cov[i.key]?.state === "thin")
      ? { tier: i.tier, key: i.key, label: `${i.label}: found but thin — add more or write about it.`, fix: "upload" as const, layer: i.layer, weak: true }
      : { tier: i.tier, key: i.key, label: i.gap, fix: "upload" as const, layer: i.layer });
}

export function readiness(orgType: string | null, cov: Coverage): { pct: number; items: ReadinessItem[] } {
  const items = checklistFor(orgType);
  const total = items.reduce((a, i) => a + TIER_WEIGHT[i.tier], 0) || 1;
  const got = items.reduce((a, i) => { const st = cov[i.key]?.state ?? "missing"; return a + TIER_WEIGHT[i.tier] * (st === "covered" ? 1 : st === "thin" ? 0.5 : 0); }, 0);
  return {
    pct: Math.round((got / total) * 100),
    items: items.map(i => ({ key: i.key, label: i.label, tier: i.tier, layer: i.layer, state: cov[i.key]?.state ?? "missing", sources: cov[i.key]?.sources ?? [], blurb: BLURBS[i.key] ?? "" })),
  };
}
