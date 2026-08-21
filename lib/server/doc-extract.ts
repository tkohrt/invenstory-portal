import "server-only";
// Document-level evidence extraction (parallel path to the retrieval-based gap-agent).
// Reads each document once and asks which checklist items it substantively supports —
// eliminating the per-item retrieval "routing lottery". Boilerplate (templates,
// unsigned/sample/draft docs) is skipped so placeholder values never count as evidence.
import { db } from "./db";
import { chatComplete, generationConfigured } from "./llm";
import { checklistFor, RETRIEVAL_QUERY } from "@/lib/checklist";

export type DocState = "covered" | "thin" | "missing";
export type Subject = "organization" | "competitor" | "third_party";
export interface DocItemFinding { key: string; label: string; tier: string; state: DocState; evidence: { documentId: string; title: string; quote: string; subject: Subject }[] }
export interface DocScan { documentId: string; title: string; boilerplate: boolean; skipped: boolean; chars: number; found: { key: string; state: DocState; quote: string; subject: Subject }[] }
export interface DocExtractTrace {
  generationConfigured: boolean; docCount: number; scanned: number; skipped: number;
  items: DocItemFinding[]; documents: DocScan[];
}


// Attribution guard: competitor / third-party facts must never satisfy the client's OWN
// checklist items. Only "competition" may use competitor evidence; only relationship items
// may use third-party evidence. Everything else requires the subject to be the organization.
function subjectAllowed(itemKey: string, subject: Subject): boolean {
  if (itemKey === "competition") return subject === "organization" || subject === "competitor";
  if (itemKey === "partnerships" || itemKey === "client_story") return subject === "organization" || subject === "third_party";
  return subject === "organization";
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
  "CRITICAL: evidence must be about THE ORGANIZATION ITSELF — its own facts, results, artifacts, and history. " +
  "Do NOT count the organization describing its product's capabilities, what it does for clients, or general commentary about its field/domain as evidence that the organization possesses that item itself. " +
  "(Example: a company whose product 'extracts impact metrics for clients' is NOT the same as that company measuring its OWN impact; describing a problem its customers face is NOT a data-backed statement of the organization's own need.) " +
  "Judge SUBSTANCE, not topic. Only include an item if the document actually contains that item's substance and you can quote it verbatim. " +
  "Do NOT infer, and do NOT treat placeholder, hypothetical, or blank-template values as real evidence. " +
  "'covered' requires an EXPLICIT, SPECIFIC quote a funder would accept as direct proof — concrete facts, figures, names, dates, or a clear formal statement of that item. " +
  "A vague, passing, or conversational mention is 'thin', NOT 'covered'. " +
  "For items that require data (e.g. a data-backed statement of need, impact measurement), 'covered' requires actual numbers or statistics; a narrative without data is 'thin'. " +
  "For track record or traction, 'covered' requires specific results, amounts, or named clients; general aspiration is 'thin'. " +
  "When in doubt between covered and thin, choose 'thin'. Omit items the document does not genuinely support. " +
  "For every finding also include \"subject\": who the quoted text is actually ABOUT — \"organization\" (this organization itself), \"competitor\" (a competing company or product), or \"third_party\" (a client, partner, funder, or other outside entity). " +
  "Competitor and third-party facts describe SOMEONE ELSE, not this organization — for example a competitor's funding, customers, or metrics are NOT this organization's. " +
  "Return STRICT JSON only: an array of objects {\"key\":\"<checklist key>\",\"state\":\"covered|thin\",\"quote\":\"<verbatim supporting text>\",\"subject\":\"organization|competitor|third_party\"}.\n\n" +
  "CHECKLIST (key: label — what a qualifying document contains):\n" + list;

async function scanWindow(title: string, itemsList: string, text: string): Promise<{ key: string; state: DocState; quote: string; subject: Subject }[]> {
  const res = await chatComplete({ system: EXTRACT_SYS(itemsList), user: `DOCUMENT TITLE: ${title}\n\nDOCUMENT TEXT:\n${text}`, maxTokens: 1800, temperature: 0 });
  const out: { key: string; state: DocState; quote: string; subject: Subject }[] = [];
  if (!res) return out;
  try { const m = res.text.match(/\[[\s\S]*\]/); if (m) { const arr = JSON.parse(m[0]);
    if (Array.isArray(arr)) for (const o of arr) { if (o && typeof o.key === "string" && (o.state === "covered" || o.state === "thin")) {
      const subj: Subject = (o.subject === "competitor" || o.subject === "third_party") ? o.subject : "organization";
      out.push({ key: o.key, state: o.state, quote: typeof o.quote === "string" ? o.quote : "", subject: subj });
    } }
  } } catch { /* ignore */ }
  return out;
}

async function scanDoc(doc: { id: string; title: string }, itemsList: string, text: string): Promise<DocScan> {
  const boilerplate = isBoilerplate(doc.title);
  if (boilerplate || !text.trim()) return { documentId: doc.id, title: doc.title, boilerplate, skipped: boilerplate, chars: text.length, found: [] };
  const results = await Promise.all(windows(text).map(w => scanWindow(doc.title, itemsList, w)));
  const merged = new Map<string, { key: string; state: DocState; quote: string; subject: Subject }>();
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
      if (!subjectAllowed(f.key, f.subject)) continue; // quarantine competitor/third-party facts
      const cur = agg.get(f.key)!;
      cur.evidence.push({ documentId: sc.documentId, title: sc.title, quote: f.quote, subject: f.subject });
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


type CovVal = { state: DocState; sources: { id: string; title: string; quote?: string }[] };
const RANK: Record<DocState, number> = { missing: 0, thin: 1, covered: 2 };

function normalizeCoverage(raw: unknown): Record<string, CovVal> {
  const cov: Record<string, CovVal> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") cov[k] = { state: v as DocState, sources: [] };
      else if (v && typeof v === "object") { const o = v as CovVal; cov[k] = { state: (o.state ?? "missing") as DocState, sources: Array.isArray(o.sources) ? o.sources : [] }; }
    }
  }
  return cov;
}

// Scan one just-added document and merge its findings into the tenant's stored coverage
// (additive: upgrades state + adds the document as a source). Cheap on-upload path.
// A full recompute ("Run Readiness Check") still corrects downgrades/removals.
export async function mergeDocumentIntoCoverage(documentId: string): Promise<void> {
  if (!generationConfigured()) return;
  const { data: doc } = await db.from("document").select("id, tenant_id, title, status").eq("id", documentId).maybeSingle();  // tenant-safe: resolves the document + its tenant_id; later writes scoped to doc.tenant_id
  if (!doc || doc.status !== "ready" || isBoilerplate(doc.title)) return;
  const { data: prof } = await db.from("eligibility_profile").select("org_type").eq("tenant_id", doc.tenant_id).maybeSingle();
  const items = checklistFor((prof?.org_type as string | null) ?? null);
  const validKeys = new Set(items.map(i => i.key));
  const { data: chunks } = await db.from("document_chunk").select("text").eq("document_id", documentId).eq("tenant_id", doc.tenant_id);
  const text = (chunks ?? []).map(c => c.text ?? "").join("\n");
  if (!text.trim()) return;
  const itemsList = items.map(i => `${i.key}: ${i.label} — ${RETRIEVAL_QUERY[i.key] ?? ""}`).join("\n");
  const scan = await scanDoc({ id: doc.id, title: doc.title }, itemsList, text);
  if (!scan.found.length) return;

  const { data: row } = await db.from("eligibility_gap").select("content_gaps").eq("tenant_id", doc.tenant_id).maybeSingle();
  const cov = normalizeCoverage(row?.content_gaps);
  for (const f of scan.found) {
    if (!validKeys.has(f.key)) continue;
    if (!subjectAllowed(f.key, f.subject)) continue; // quarantine competitor/third-party facts
    const cur = cov[f.key] ?? { state: "missing", sources: [] };
    if (!cur.sources.some(sx => sx.id === documentId)) cur.sources.push({ id: documentId, title: doc.title, quote: (f.quote || "").trim() || undefined });
    if (RANK[f.state] > RANK[cur.state]) cur.state = f.state;
    cov[f.key] = cur;
  }
  await db.from("eligibility_gap").upsert({ tenant_id: doc.tenant_id, content_gaps: cov, computed_at: new Date().toISOString() }, { onConflict: "tenant_id" });
}
