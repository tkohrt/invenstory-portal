import "server-only";
// Building the Search Profile: one pass over the Inven(s)tory, asking what
// matters for finding money.
//
// Deliberately a SEPARATE pass from doc-extract, which reads the same documents
// to grade readiness. Folding both questions into one prompt would halve the
// model cost, but the readiness prompt reached its accuracy through a
// documented evolution (two real failures, several calibrations), and a prompt
// doing two jobs usually does both worse. Not worth destabilising a working
// engine to save a call per document.
//
// What it inherits from doc-extract, on purpose: windowing long documents,
// skipping boilerplate, verbatim quotes, and the subject tag that decides
// whether a line may describe the client at all.
import { db } from "./db";
import { chatComplete, generationConfigured } from "./llm";
import {
  parseFacts, mergeFacts, assessProfile, documentFingerprint,
  type ProfileFact, type SearchProfile,
} from "@/lib/search-profile";

type Layer = "I" | "II" | "III" | null;

function isBoilerplate(title: string): boolean {
  return /\b(template|unsigned|sample|draft|boilerplate)\b/i.test(title);
}

function windows(text: string, size = 10000, overlap = 500, max = 6): string[] {
  if (text.length <= 12000) return [text];
  const out: string[] = []; let i = 0;
  while (i < text.length && out.length < max) { out.push(text.slice(i, i + size)); i += size - overlap; }
  return out;
}

const SYS =
  "You are reading ONE document from an organization's Inven(s)tory and pulling out the facts that matter " +
  "for finding this organization funding. You are not summarising the document.\n\n" +
  "Return facts under these facets:\n" +
  "  identity      what kind of organization this is, as a funder would classify it\n" +
  "  work          what it actually does: its programmes, products or services\n" +
  "  need          what it wants funded. A project, a role, capacity, equipment, a pilot\n" +
  "  evidence      what it can prove: outcomes, figures, traction, awards, contracts\n" +
  "  geography     where it operates, as specifically as the document says\n" +
  "  distinctive   what a programme officer would remember about it\n" +
  "  constraints   anything limiting eligibility: no 501(c)(3), fiscal sponsorship, no SAM.gov registration, tiny budget\n" +
  "  beneficiaries who it serves\n\n" +
  "RULES.\n" +
  "1. Every fact needs a VERBATIM quote from the document. No quote, no fact. Do not paraphrase into the quote field.\n" +
  "2. `text` is a short clause in the organization's own vocabulary, usable in a search query. Not a sentence about the document.\n" +
  "3. Say who each quote is ABOUT in `subject`: \"organization\" (this organization itself), \"competitor\" (a rival company or product), " +
  "or \"third_party\" (a client, partner, funder, hospital, school or other outside entity). Get this right. A partner's programme and a " +
  "competitor's product are NOT this organization's work, and mislabelling them sends the search after the wrong money.\n" +
  "4. Do not infer. If the document never says what they want funded, return no `need` fact. An empty facet is a useful answer.\n" +
  "5. Do not turn who they SERVE into what they ARE. A company building software for hospitals is a software company, not a hospital. " +
  "A charity serving veterans is a service provider, not a veteran.\n" +
  "6. Prefer specific over grand. \"two more case managers in Cuyahoga County\" beats \"expanding capacity\".\n\n" +
  "Return STRICT JSON only: an array of " +
  "{\"facet\":\"<one of the above>\",\"text\":\"<short clause>\",\"quote\":\"<verbatim>\",\"subject\":\"organization|competitor|third_party\"}. " +
  "Return [] if the document says nothing useful.";

async function scanWindow(title: string, text: string, src: { documentId: string; documentTitle: string; layer: Layer }) {
  const res = await chatComplete({
    system: SYS,
    user: `DOCUMENT TITLE: ${title}\n\nDOCUMENT TEXT:\n${text}`,
    maxTokens: 1800, temperature: 0,
  });
  return res ? parseFacts(res.text, src) : [];
}

export interface ProfileBuildResult {
  /** Documents read in THIS invocation. */
  read: number;
  /** Documents still to read after it. */
  remaining: number;
  /** True when every document is read and the profile has been assembled. */
  complete: boolean;
  /** Only set once complete. */
  profile?: SearchProfile;
  note?: string;
  usable?: boolean;
}

/** Leave enough of the function's budget to write results and answer. */
const WORK_BUDGET_MS = 42_000;

interface DocRow { id: string; title: string; layer: string | null; }

/**
 * A cheap fingerprint of a document's text.
 *
 * Documents are re-processed in place: same id, chunks deleted and rewritten.
 * Without this, a re-uploaded document keeps the facts and the verbatim quotes
 * extracted from content that no longer exists, and the profile reports itself
 * as current. For a system whose whole discipline is "no quote, no fact",
 * stored quotes that are no longer in the document are the worst failure
 * available.
 */
function contentHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** Read one document and store its facts. Idempotent: re-reading replaces. */
async function extractOne(tenantId: string, d: DocRow, text: string): Promise<number> {
  const layer = (["I", "II", "III"].includes(d.layer ?? "") ? d.layer : null) as Layer;
  const src = { documentId: d.id, documentTitle: d.title, layer };
  const w = windows(text);
  const parts = await Promise.all(w.map(win => scanWindow(d.title, win, src)));
  const facts = parts.flat();

  const { error } = await db.from("search_profile_doc").upsert({
    tenant_id: tenantId, document_id: d.id, facts,
    chars: text.length, windows: w.length,
    content_hash: contentHash(text),
    extracted_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,document_id" });
  // Loud: a document silently failing to save would be re-read on every
  // continuation, and the chain would never finish.
  if (error) throw new Error(`Could not save what was read from "${d.title}": ${error.message}`);
  return facts.length;
}

/**
 * Do as much of the build as fits in one invocation, then stop.
 *
 * The unit of work is one document, because that is the unit that is
 * independent: reading document 4 does not depend on document 3, and there is
 * no sweep for a partial pass to corrupt. Whatever is read is kept, and the
 * next call picks up the documents that are still missing.
 *
 * Returns complete:false when the budget ran out with work left. That is a
 * normal outcome, not a failure, and the caller is expected to come back.
 */
export async function continueProfileBuild(
  tenantId: string, userId: string,
  opts: { onProgress?: (p: { done: number; total: number; detail: string }) => void } = {},
): Promise<ProfileBuildResult> {
  if (!generationConfigured()) throw new Error("No generation model is configured in this environment.");
  const started = Date.now();
  const step = (done: number, total: number, detail: string) => {
    try { opts.onProgress?.({ done, total, detail }); } catch { /* never fatal */ }
  };

  const { data: docs, error } = await db.from("document")
    .select("id, title, layer").eq("tenant_id", tenantId).eq("status", "ready");
  if (error) throw new Error(`document read failed: ${error.message}`);
  const docList = (docs ?? []) as DocRow[];

  const { data: doneRows } = await db.from("search_profile_doc")
    .select("document_id, content_hash").eq("tenant_id", tenantId);
  const done = new Map(((doneRows ?? []) as { document_id: string; content_hash: string | null }[])
    .map(r => [r.document_id, r.content_hash]));

  // Current text length per document, cheap, so a document that was
  // re-processed in place is re-read rather than trusted forever. The full
  // hash is compared inside extractOne's stored value; this is the pre-filter.
  const { data: sizes } = await db.from("document_chunk")
    .select("document_id, text").eq("tenant_id", tenantId);
  const lenByDoc = new Map<string, number>();
  for (const c of ((sizes ?? []) as { document_id: string; text: string | null }[])) {
    lenByDoc.set(c.document_id, (lenByDoc.get(c.document_id) ?? 0) + (c.text?.length ?? 0));
  }

  const stale = (d: DocRow) => {
    if (!done.has(d.id)) return true;
    const h = done.get(d.id);
    if (!h || h === "boilerplate" || h === "empty") return false;   // deliberate skips stay skipped
    const len = lenByDoc.get(d.id) ?? 0;
    return !h.startsWith(`${len}:`);                                 // length changed, so content did
  };

  const todo = docList.filter(stale);
  const total = docList.length;
  const already = new Set(docList.filter(d => !stale(d)).map(d => d.id));

  let read = 0;
  for (const d of todo) {
    if (Date.now() - started > WORK_BUDGET_MS) break;
    step(already.size + read, total, `reading ${d.title}`);

    if (isBoilerplate(d.title)) {
      // Recorded as read, and loudly. A skip that fails to save is re-tried on
      // every continuation and the chain never finishes.
      const { error: skipErr } = await db.from("search_profile_doc").upsert({
        tenant_id: tenantId, document_id: d.id, facts: [], chars: 0, windows: 0,
        content_hash: "boilerplate",
      }, { onConflict: "tenant_id,document_id" });
      if (skipErr) throw new Error(`Could not record skipping "${d.title}": ${skipErr.message}`);
      read += 1;
      continue;
    }

    const { data: chunks } = await db.from("document_chunk")
      .select("text").eq("tenant_id", tenantId).eq("document_id", d.id);
    const text = ((chunks ?? []) as { text: string | null }[]).map(c => c.text ?? "").join("\n");
    if (!text.trim()) {
      // No chunks yet, or an extraction that produced nothing. Recording it
      // avoids a model call on empty input every time the chain comes round.
      const { error: emptyErr } = await db.from("search_profile_doc").upsert({
        tenant_id: tenantId, document_id: d.id, facts: [], chars: 0, windows: 0,
        content_hash: "empty",
      }, { onConflict: "tenant_id,document_id" });
      if (emptyErr) throw new Error(`Could not record "${d.title}" as empty: ${emptyErr.message}`);
      read += 1;
      continue;
    }
    await extractOne(tenantId, d, text);
    read += 1;
  }

  const remaining = todo.length - read;
  if (remaining > 0) return { read, remaining, complete: false };

  step(total, total, "working out what to search on");
  const assembled = await assembleProfile(tenantId, userId, docList);
  return { read, remaining: 0, complete: true, ...assembled };
}

/**
 * Merge every document's facts into the profile the search actually uses.
 *
 * Cheap and pure once the reading is done, which is the other half of why the
 * split is worth it: adding one document costs one document of model time and
 * then this, rather than a full rebuild.
 */
export async function assembleProfile(
  tenantId: string, userId: string, docList?: { id: string }[],
): Promise<{ profile: SearchProfile; note: string; usable: boolean }> {
  // Joined to document, so a row for something no longer ready (re-processing,
  // archived, a failed re-ingest) does not keep contributing facts to a profile
  // that claims to describe the current Inven(s)tory.
  const { data: rows } = await db.from("search_profile_doc")
    .select("facts, chars, document:document_id!inner(status)")
    .eq("tenant_id", tenantId).eq("document.status", "ready");
  const all = ((rows ?? []) as unknown as { facts: ProfileFact[]; chars: number }[]);

  const facts = mergeFacts(all.flatMap(r => (r.facts ?? []) as ProfileFact[]));
  const layers = [...new Set(facts.map(f => f.layer).filter(Boolean))] as ("I" | "II" | "III")[];

  const docs = docList ?? (((await db.from("document")
    .select("id").eq("tenant_id", tenantId).eq("status", "ready")).data ?? []) as { id: string }[]);

  const profile: SearchProfile = {
    facts,
    generatedAt: new Date().toISOString(),
    // Documents that actually contributed text, not the raw count: a profile
    // built from twelve documents and three empty ones was built from twelve.
    documentCount: all.filter(r => r.chars > 0).length,
    layers,
  };
  const health = assessProfile(profile);

  const { error } = await db.from("search_profile").upsert({
    tenant_id: tenantId,
    facts: profile.facts,
    document_count: profile.documentCount,
    layers: profile.layers,
    doc_fingerprint: documentFingerprint(docs),
    note: health.note,
    generated_at: profile.generatedAt,
    generated_by: userId,
  }, { onConflict: "tenant_id" });
  if (error) throw new Error(`Search Profile could not be saved: ${error.message}`);

  return { profile, note: health.note, usable: health.usable };
}

/**
 * Forget what was read, so the next build starts clean.
 *
 * Used by an explicit rebuild. An ordinary continuation must never do this, or
 * the chain would restart itself forever.
 */
export async function clearProfileDocs(tenantId: string): Promise<void> {
  const { error } = await db.from("search_profile_doc").delete().eq("tenant_id", tenantId);
  if (error) throw new Error(`could not clear the previous read: ${error.message}`);
}

/** Documents read, and documents there are, for the panel and the chain. */
export async function profileBuildProgress(tenantId: string): Promise<{ done: number; total: number }> {
  const [{ count: done }, { count: total }] = await Promise.all([
    // Counted the same way as the assembly, or the panel can be handed a
    // "done" larger than its "total".
    db.from("search_profile_doc")
      .select("document_id, document:document_id!inner(status)", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("document.status", "ready"),
    db.from("document").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("status", "ready"),
  ]);
  return { done: Math.min(done ?? 0, total ?? 0), total: total ?? 0 };
}

