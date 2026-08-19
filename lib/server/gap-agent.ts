import "server-only";
import { db } from "./db";
import { userClient } from "./supabase";
import { embedTexts } from "./embed";
import { chatComplete, generationConfigured } from "./llm";
import type { Gap } from "@/lib/eligibility-fields";
import { checklistFor, TIER_WEIGHT, BLURBS, RETRIEVAL_QUERY, type ChecklistItem, type ReadinessItem } from "@/lib/checklist";

export type CoverState = "covered" | "thin" | "missing";
export interface ItemCoverage { state: CoverState; sources: { id: string; title: string }[] }
export type Coverage = Record<string, ItemCoverage>;


// Retrieval diversification: a larger candidate pool, capped per document, so one
// verbose transcript cannot monopolize an item's evidence and starve real matches.
type MatchRow = { document_id: string; chunk_id?: string; tenant_id: string; title: string; text: string; similarity: number };
function diversifyRows(rows: MatchRow[], perDocCap = 2, keep = 6): MatchRow[] {
  const sorted = [...rows].sort((a, b) => b.similarity - a.similarity);
  const perDoc = new Map<string, number>(); const out: MatchRow[] = [];
  for (const r of sorted) {
    const n = perDoc.get(r.document_id) ?? 0;
    if (n >= perDocCap) continue;
    perDoc.set(r.document_id, n + 1); out.push(r);
    if (out.length >= keep) break;
  }
  return out;
}

interface Evidence { key: string; label: string; docs: { id: string; title: string }[]; snippets: string[]; maxSim: number }

async function gatherEvidence(tenantId: string, items: ChecklistItem[]): Promise<Evidence[] | null> {
  const supabase = await userClient();
  const vectors = await embedTexts(items.map(i => RETRIEVAL_QUERY[i.key] ?? i.label));
  if (!vectors) return null;
  return Promise.all(items.map(async (it, idx) => {
    const v = vectors[idx];
    const ev: Evidence = { key: it.key, label: it.label, docs: [], snippets: [], maxSim: 0 };
    if (!v) return ev;
    const { data } = await supabase.rpc("match_chunks", { p_query_embedding: JSON.stringify(v), p_match_count: 20 });
    const rows = diversifyRows(((data ?? []) as MatchRow[]).filter(r => r.tenant_id === tenantId), 2, 6);
    ev.maxSim = rows.reduce((m, r) => Math.max(m, r.similarity), 0);
    const seen = new Set<string>();
    for (const r of rows) { if (!seen.has(r.document_id)) { seen.add(r.document_id); ev.docs.push({ id: r.document_id, title: r.title }); } }
    ev.snippets = rows.map(r => (r.text ?? "").slice(0, 180));
    return ev;
  }));
}

export interface Grade { state: CoverState; quote: string; source: string }

const GROUNDED =
  "You audit whether an organization's Inven(s)tory ACTUALLY CONTAINS each checklist item. " +
  "You are given retrieved document passages per item. Judge SUBSTANCE, not topic or domain. " +
  "For each item choose: 'covered' — a passage explicitly contains the item's substance and you can quote it verbatim; " +
  "'thin' — the item is touched on only partially or in passing; " +
  "'missing' — no passage actually contains the item's substance. " +
  "Topical or domain similarity is NOT evidence: a consulting agreement or signature block is NOT a cap table; " +
  "an about-us page is NOT an operating budget; a bio is NOT a track record of results. " +
  "Do NOT mark 'covered' unless you can quote text a funder would accept as proof of that SPECIFIC item. " +
  "If you cannot produce a real supporting quote, the answer is 'missing' (or 'thin' only if genuinely partial). " +
  "Return STRICT JSON only: an object mapping each key to {\"state\":\"covered|thin|missing\",\"quote\":\"<verbatim supporting text or empty>\",\"source\":\"<document title the quote came from, or empty>\"}.";

async function classifyGrounded(items: ChecklistItem[], evidenceText: string): Promise<{ result: Record<string, Grade>; raw: string }> {
  const out: Record<string, Grade> = {}; items.forEach(i => out[i.key] = { state: "missing", quote: "", source: "" });
  const list = items.map(i => `${i.key}: ${i.label} — ${RETRIEVAL_QUERY[i.key] ?? ""}`).join("\n");
  const res = await chatComplete({ system: GROUNDED + "\n\nCHECKLIST (key: label — what a qualifying document contains):\n" + list, user: evidenceText, maxTokens: 2200, temperature: 0 });
  if (!res) return { result: out, raw: "" };
  try {
    const m = res.text.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); items.forEach(i => {
      const c = p[i.key];
      if (c && typeof c === "object") { const st = c.state; if (st === "covered" || st === "thin" || st === "missing")
        out[i.key] = { state: st, quote: typeof c.quote === "string" ? c.quote : "", source: typeof c.source === "string" ? c.source : "" }; }
    }); }
  } catch { /* keep missing */ }
  return { result: out, raw: res.text };
}

// Pick the shown source: prefer the doc the model actually cited; else fall back to retrieved docs.
function pickSources(cited: string, docs: { id: string; title: string }[]): { id: string; title: string }[] {
  if (!docs.length) return [];
  const c = cited.trim().toLowerCase();
  if (c.length > 3) { const hit = docs.find(d => { const t = d.title.toLowerCase(); return t.includes(c) || c.includes(t); }); if (hit) return [hit]; }
  return docs;
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
    const { result: st } = await classifyGrounded(items, digest);
    items.forEach(i => cov[i.key] = { state: st[i.key].state, sources: [] });
    return cov;
  }

  const packed = evidence.map(e => {
    const titles = e.docs.length ? `TITLES: ${e.docs.map(d => d.title).join("; ")}` : "TITLES: (none matched)";
    const snips = e.snippets.length ? e.snippets.map(s => `• ${s}`).join("\n") : "(no related passages)";
    return `## ${e.key} — ${e.label}\n${titles}\ntopMatch=${e.maxSim.toFixed(2)}\n${snips}`;
  }).join("\n\n");
  const { result: st } = await classifyGrounded(items, "Evidence retrieved per item:\n\n" + packed);
  const byEv = new Map(evidence.map(e => [e.key, e]));
  items.forEach(i => {
    const ev = byEv.get(i.key); const g = st[i.key];
    // No similarity floor: a high-similarity but non-substantive match must be allowed to read "missing".
    cov[i.key] = { state: g.state, sources: g.state !== "missing" ? pickSources(g.source, ev?.docs ?? []) : [] };
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

// ---- Readiness audit: a traceable re-run of the coverage assessment ----
// Mirrors analyzeContentCoverage but captures every intermediate so admins can see
// exactly why each item was graded covered / thin / missing.
export interface RetrievedChunk { documentId: string; chunkId: string | null; title: string; similarity: number; text: string }
export interface ItemTrace {
  key: string; label: string; tier: string; query: string;
  retrieved: RetrievedChunk[]; maxSim: number; evidenceBlock: string;
  llmVerdict: CoverState; floorFired: boolean; finalState: CoverState;
  llmQuote: string; citedSource: string;
  sources: { id: string; title: string }[];
}
export interface CoverageTrace {
  generationConfigured: boolean; docCount: number; usedFallback: boolean;
  similarityFloor: number; evidenceSent: string; llmRaw: string; items: ItemTrace[];
}

export async function traceContentCoverage(tenantId: string, orgType: string | null): Promise<CoverageTrace> {
  const items = checklistFor(orgType);
  const SOME = 0.40;
  const genOK = generationConfigured();
  const { count } = await db.from("document").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "ready");
  const empty = (): CoverageTrace => ({
    generationConfigured: genOK, docCount: count ?? 0, usedFallback: false, similarityFloor: SOME,
    evidenceSent: "", llmRaw: "",
    items: items.map(i => ({ key: i.key, label: i.label, tier: i.tier, query: RETRIEVAL_QUERY[i.key] ?? i.label, retrieved: [], maxSim: 0, evidenceBlock: "", llmVerdict: "missing" as CoverState, floorFired: false, finalState: "missing" as CoverState, llmQuote: "", citedSource: "", sources: [] })),
  });
  if (!count || !genOK) return empty();

  const supabase = await userClient();
  const vectors = await embedTexts(items.map(i => RETRIEVAL_QUERY[i.key] ?? i.label));

  // per-item retrieval
  const per = await Promise.all(items.map(async (it, idx) => {
    const v = vectors?.[idx];
    let retrieved: RetrievedChunk[] = [];
    if (v) {
      const { data } = await supabase.rpc("match_chunks", { p_query_embedding: JSON.stringify(v), p_match_count: 20 });
      retrieved = diversifyRows(((data ?? []) as MatchRow[]).filter(r => r.tenant_id === tenantId), 2, 6)
        .map(r => ({ documentId: r.document_id, chunkId: r.chunk_id ?? null, title: r.title, similarity: r.similarity, text: r.text ?? "" }));
    }
    const maxSim = retrieved.reduce((m, r) => Math.max(m, r.similarity), 0);
    const seen = new Set<string>(); const docs: { id: string; title: string }[] = [];
    for (const r of retrieved) { if (!seen.has(r.documentId)) { seen.add(r.documentId); docs.push({ id: r.documentId, title: r.title }); } }
    const titles = docs.length ? `TITLES: ${docs.map(d => d.title).join("; ")}` : "TITLES: (none matched)";
    const snips = retrieved.length ? retrieved.map(r => `• ${(r.text ?? "").slice(0, 180)}`).join("\n") : "(no related passages)";
    const evidenceBlock = `## ${it.key} — ${it.label}\n${titles}\ntopMatch=${maxSim.toFixed(2)}\n${snips}`;
    return { it, retrieved, maxSim, docs, evidenceBlock };
  }));

  const usedFallback = !vectors;
  const evidenceSent = "Evidence retrieved per item:\n\n" + per.map(p => p.evidenceBlock).join("\n\n");

  // one grounded classifier call (same prompt as the live agent) — capture quotes + cited sources
  const { result: grades, raw: llmRaw } = await classifyGrounded(items, evidenceSent);

  const itemTraces: ItemTrace[] = per.map(p => {
    const g = grades[p.it.key];
    // No similarity floor: state is exactly what the grounded grader decided.
    const finalState: CoverState = g.state;
    return {
      key: p.it.key, label: p.it.label, tier: p.it.tier, query: RETRIEVAL_QUERY[p.it.key] ?? p.it.label,
      retrieved: p.retrieved, maxSim: p.maxSim, evidenceBlock: p.evidenceBlock,
      llmVerdict: g.state, floorFired: false, finalState,
      llmQuote: g.quote, citedSource: g.source,
      sources: finalState !== "missing" ? pickSources(g.source, p.docs) : [],
    };
  });

  return { generationConfigured: genOK, docCount: count, usedFallback, similarityFloor: SOME, evidenceSent, llmRaw, items: itemTraces };
}
