import "server-only";
// Document-level evidence extraction (parallel path to the retrieval-based gap-agent).
// Reads each document once and asks which checklist items it substantively supports —
// eliminating the per-item retrieval "routing lottery". Boilerplate (templates,
// unsigned/sample/draft docs) is skipped so placeholder values never count as evidence.
import { db } from "./db";
import { chatComplete, generationConfigured } from "./llm";
import { checklistFor, RETRIEVAL_QUERY } from "@/lib/checklist";

export type DocState = "covered" | "thin" | "missing";
export interface DocItemFinding { key: string; label: string; tier: string; state: DocState; evidence: { title: string; quote: string }[] }
export interface DocScan { documentId: string; title: string; boilerplate: boolean; skipped: boolean; chars: number; found: { key: string; state: DocState; quote: string }[] }
export interface DocExtractTrace {
  generationConfigured: boolean; docCount: number; scanned: number; skipped: number;
  items: DocItemFinding[]; documents: DocScan[];
}

function isBoilerplate(title: string): boolean {
  return /\b(template|unsigned|sample|draft|boilerplate)\b/i.test(title);
}

function windows(text: string, size = 10000, overlap = 500, max = 6): string[] {
  if (text.length <= 12000) return [text];
  const out: string[] = []; let i = 0;
  while (i < text.length && out.length < max) { out.push(text.slice(i, i + size)); i += size - overlap; }
  return out;
}

const EXTRACT_SYS = (list: string) =>
  "You are reading ONE document from an organization's Inven(s)tory and deciding which grant-readiness checklist items it provides REAL, substantive evidence for. " +
  "Judge SUBSTANCE, not topic. Only include an item if the document actually contains that item's substance and you can quote it verbatim. " +
  "Do NOT infer, and do NOT treat placeholder, hypothetical, or blank-template values as real evidence. " +
  "'covered' = the document explicitly and strongly contains the item; 'thin' = partial or in passing. " +
  "Omit items the document does not genuinely support. " +
  "Return STRICT JSON only: an array of objects {\"key\":\"<checklist key>\",\"state\":\"covered|thin\",\"quote\":\"<verbatim supporting text>\"}.\n\n" +
  "CHECKLIST (key: label — what a qualifying document contains):\n" + list;

async function scanWindow(title: string, itemsList: string, text: string): Promise<{ key: string; state: DocState; quote: string }[]> {
  const res = await chatComplete({ system: EXTRACT_SYS(itemsList), user: `DOCUMENT TITLE: ${title}\n\nDOCUMENT TEXT:\n${text}`, maxTokens: 1600, temperature: 0 });
  const out: { key: string; state: DocState; quote: string }[] = [];
  if (!res) return out;
  try { const m = res.text.match(/\[[\s\S]*\]/); if (m) { const arr = JSON.parse(m[0]);
    if (Array.isArray(arr)) for (const o of arr) { if (o && typeof o.key === "string" && (o.state === "covered" || o.state === "thin")) out.push({ key: o.key, state: o.state, quote: typeof o.quote === "string" ? o.quote : "" }); }
  } } catch { /* ignore */ }
  return out;
}

async function scanDoc(doc: { id: string; title: string }, itemsList: string, text: string): Promise<DocScan> {
  const boilerplate = isBoilerplate(doc.title);
  if (boilerplate || !text.trim()) return { documentId: doc.id, title: doc.title, boilerplate, skipped: boilerplate, chars: text.length, found: [] };
  const results = await Promise.all(windows(text).map(w => scanWindow(doc.title, itemsList, w)));
  const merged = new Map<string, { key: string; state: DocState; quote: string }>();
  for (const arr of results) for (const f of arr) {
    const cur = merged.get(f.key);
    if (!cur || (f.state === "covered" && cur.state !== "covered")) merged.set(f.key, f);
  }
  return { documentId: doc.id, title: doc.title, boilerplate: false, skipped: false, chars: text.length, found: [...merged.values()] };
}

export async function extractDocumentEvidence(tenantId: string, orgType: string | null): Promise<DocExtractTrace> {
  const items = checklistFor(orgType);
  const validKeys = new Set(items.map(i => i.key));
  const byKey = new Map(items.map(i => [i.key, i]));
  const genOK = generationConfigured();
  const { data: docs } = await db.from("document").select("id, title").eq("tenant_id", tenantId).eq("status", "ready");
  const docList = docs ?? [];
  const emptyItems = (): DocItemFinding[] => items.map(i => ({ key: i.key, label: i.label, tier: i.tier, state: "missing" as DocState, evidence: [] }));
  if (!genOK || !docList.length) return { generationConfigured: genOK, docCount: docList.length, scanned: 0, skipped: 0, items: emptyItems(), documents: [] };

  const { data: chunks } = await db.from("document_chunk").select("document_id, text").eq("tenant_id", tenantId);
  const textByDoc = new Map<string, string>();
  for (const c of chunks ?? []) textByDoc.set(c.document_id, (textByDoc.get(c.document_id) ?? "") + "\n" + (c.text ?? ""));
  const itemsList = items.map(i => `${i.key}: ${i.label} — ${RETRIEVAL_QUERY[i.key] ?? ""}`).join("\n");

  const scans = await Promise.all(docList.map(d => scanDoc(d, itemsList, textByDoc.get(d.id) ?? "")));

  const agg = new Map<string, DocItemFinding>();
  items.forEach(i => agg.set(i.key, { key: i.key, label: i.label, tier: i.tier, state: "missing", evidence: [] }));
  for (const sc of scans) {
    if (sc.skipped) continue;
    for (const f of sc.found) {
      if (!validKeys.has(f.key) || !byKey.has(f.key)) continue;
      const cur = agg.get(f.key)!;
      cur.evidence.push({ title: sc.title, quote: f.quote });
      if (f.state === "covered") cur.state = "covered";
      else if (cur.state !== "covered") cur.state = "thin";
    }
  }
  return {
    generationConfigured: genOK, docCount: docList.length,
    scanned: scans.filter(s => !s.skipped).length, skipped: scans.filter(s => s.skipped).length,
    items: [...agg.values()], documents: scans,
  };
}
