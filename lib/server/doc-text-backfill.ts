import "server-only";
// Storing the text of documents read before Phase 0 (Document Reader; 0069).
//
// For Granted presses one button (Admin, Analysis, "Store document text"). One
// job per client (kind doc_text), carried from stage to stage by the server
// like an analysis run (lib/server/job-chain.ts), revived from the next portal
// page anyone opens if a hop is lost. No model is called: it costs nothing.
//
// For each ready document without a stored text, oldest first:
//   1. the original file is downloaded and extracted exactly as ingestion does;
//   2. the text is stored (document_text);
//   3. the document's existing passages are re-pointed into it (alignChunks):
//      same words, same ids, same embeddings, exact positions. When any passage
//      is not in the new text the passages are left alone and the text is marked
//      chunks_aligned = false; the job lists the document for a Re-process;
//   4. every stored read of the document (analysis, Card Library, search
//      profile) is re-stamped from the old stitched text to the stored text, so
//      nothing is re-read, and nothing is charged, because of this change;
//   5. its Story Card quotes are located in the text, and the count of those
//      placed is reported: a check of the locator against real quotes.
// A document whose file cannot be read is listed and skipped, never retried in
// a loop. Nothing is deleted.
import { after } from "next/server";
import { db } from "./db";
import { extractPages } from "./ingest";
import { saveExtractedText, restampReads } from "./doc-text";
import { claimJob, createJob, failJob, finishJob, recordEvent, releaseJob, supersedeRunning, updateJob } from "./jobs";
import { MAX_CHAIN_PASSES, signChain } from "./job-chain";
import { alignChunks, buildDocText, legacyChunkText } from "@/lib/doc-text";
import { locateQuote, prepare } from "@/lib/locate";

const STAGE_BUDGET_MS = 38_000;

export interface DocTextResult extends Record<string, unknown> {
  stored: number;
  aligned: number;
  /** Documents whose passages could not be re-pointed: Re-process them. */
  needReprocess: { id: string; title: string }[];
  /** Documents whose file could not be read. */
  failed: { id: string; title: string; error: string }[];
  restamped: number;
  quotes: number;
  placed: number;
  /** Documents with card quotes the locator could not place, and how many. */
  unplaced: { id: string; title: string; missing: number; of: number }[];
}

const emptyResult = (): DocTextResult => ({
  stored: 0, aligned: 0, needReprocess: [], failed: [], restamped: 0, quotes: 0, placed: 0, unplaced: [],
});

function asResult(raw: unknown): DocTextResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DocTextResult>;
  const base = emptyResult();
  return {
    stored: Number(r.stored) || 0, aligned: Number(r.aligned) || 0,
    needReprocess: Array.isArray(r.needReprocess) ? r.needReprocess : base.needReprocess,
    failed: Array.isArray(r.failed) ? r.failed : base.failed,
    restamped: Number(r.restamped) || 0, quotes: Number(r.quotes) || 0, placed: Number(r.placed) || 0,
    unplaced: Array.isArray(r.unplaced) ? r.unplaced : base.unplaced,
  };
}

interface DocRow { id: string; tenant_id: string; title: string; storage_key: string; doc_kind: string; current_version: number | null }

/** Ready documents of a client with no stored text yet, minus those already tried and failed in this run. */
async function documentsToStore(tenantId: string, skip: Set<string>): Promise<DocRow[]> {
  const [{ data: docs, error }, { data: have }] = await Promise.all([
    db.from("document").select("id, tenant_id, title, storage_key, doc_kind, current_version")
      .eq("tenant_id", tenantId).eq("status", "ready").order("created_at"),
    db.from("document_text").select("document_id").eq("tenant_id", tenantId),
  ]);
  if (error) throw new Error(`could not list documents: ${error.message}`);
  const stored = new Set(((have ?? []) as { document_id: string }[]).map(r => r.document_id));
  return ((docs ?? []) as DocRow[]).filter(d => !stored.has(d.id) && !skip.has(d.id));
}

/** One document, steps 1 to 5. */
async function storeOne(d: DocRow, out: DocTextResult): Promise<string> {
  const { data: blob, error: dlErr } = await db.storage.from("documents").download(d.storage_key);
  if (dlErr || !blob) throw new Error(`the original file could not be downloaded (${dlErr?.message ?? "no file"})`);
  const pages = await extractPages(Buffer.from(await blob.arrayBuffer()), d.doc_kind);

  const { data: chunkRows, error: cErr } = await db.from("document_chunk")
    .select("id, chunk_index, text, page_number, char_start")
    .eq("tenant_id", d.tenant_id).eq("document_id", d.id).order("chunk_index");
  if (cErr) throw new Error(`could not read its passages: ${cErr.message}`);
  const chunks = (chunkRows ?? []) as { id: string; chunk_index: number; text: string | null; page_number: number | null; char_start: number }[];
  const legacy = legacyChunkText(chunks);

  const built = buildDocText(pages);
  const moves = chunks.length ? alignChunks(built.text, built.pages, chunks) : [];
  const saved = await saveExtractedText(d, pages, { chunksAligned: !!moves });

  if (moves) {
    for (let i = 0; i < moves.length; i += 10) {
      const batch = moves.slice(i, i + 10);
      const results = await Promise.all(batch.map(m => db.from("document_chunk")
        .update({ char_start: m.char_start, char_end: m.char_end })
        .eq("tenant_id", d.tenant_id).eq("id", m.id)));
      const bad = results.find(r => r.error);
      if (bad?.error) throw new Error(`could not re-point its passages: ${bad.error.message}`);
    }
    out.aligned++;
  } else {
    out.needReprocess.push({ id: d.id, title: d.title });
  }
  out.stored++;
  out.restamped += await restampReads(d.tenant_id, d.id, legacy, saved.text);

  // The check: how many of this document's Story Card quotes the locator places.
  const { data: ev } = await db.from("story_card_evidence").select("quote")
    .eq("tenant_id", d.tenant_id).eq("document_id", d.id);
  const quotes = ((ev ?? []) as { quote: string }[]).map(r => r.quote);
  const prepared = prepare(saved.text);
  const missing = quotes.filter(q => locateQuote(prepared, q).status === "missing").length;
  out.quotes += quotes.length;
  out.placed += quotes.length - missing;
  if (missing) out.unplaced.push({ id: d.id, title: d.title, missing, of: quotes.length });

  return `Stored ${d.title}`
    + (moves ? "" : "; its passages differ from the file now, so it needs a Re-process")
    + (quotes.length ? `; ${quotes.length - missing} of ${quotes.length} card quotes placed.` : ".");
}

export type DocTextOutcome = { kind: "more" } | { kind: "done" } | { kind: "busy" } | { kind: "failed"; error: string };

/** One stage for one client. */
export async function runDocTextPass(tenantId: string, jobId: string, opts: { chained?: boolean } = {}): Promise<DocTextOutcome> {
  if (!await claimJob(tenantId, jobId)) return { kind: "busy" };
  try {
    const { data: j } = await db.from("job").select("chain_passes, result").eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
    if (opts.chained) {
      const passes = ((j?.chain_passes as number | undefined) ?? 0) + 1;
      if (passes > MAX_CHAIN_PASSES) {
        await releaseJob(tenantId, jobId);
        const msg = `Stopped after ${MAX_CHAIN_PASSES} stages without finishing. Everything stored is kept; press the button again to carry on.`;
        await failJob(tenantId, jobId, msg);
        return { kind: "failed", error: msg };
      }
      await db.from("job").update({ chain_passes: passes }).eq("tenant_id", tenantId).eq("id", jobId);
    }
    const out = asResult(j?.result);
    const skip = new Set(out.failed.map(f => f.id));
    const todo = await documentsToStore(tenantId, skip);
    const total = out.stored + out.failed.length + todo.length;
    const started = Date.now();
    let did = 0;
    for (const d of todo) {
      if (did > 0 && Date.now() - started > STAGE_BUDGET_MS) break;
      void updateJob(tenantId, jobId, { done: out.stored + out.failed.length, total, detail: `storing ${d.title}` });
      try {
        const line = await storeOne(d, out);
        void recordEvent(tenantId, jobId, { kind: "progress", text: line, done: out.stored + out.failed.length, total });
      } catch (e) {
        const error = e instanceof Error ? e.message.slice(0, 300) : "could not be read";
        out.failed.push({ id: d.id, title: d.title, error });
        void recordEvent(tenantId, jobId, { kind: "skip", text: `Skipped ${d.title}: ${error}.`, done: out.stored + out.failed.length, total });
      }
      did++;
      // Save the tally after every document, so a stage killed at the time limit loses nothing.
      await db.from("job").update({ result: out, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", jobId).eq("status", "running");
    }
    const left = todo.length - did;
    await releaseJob(tenantId, jobId);
    if (left > 0) {
      await updateJob(tenantId, jobId, { done: out.stored + out.failed.length, total, detail: `${left} document${left === 1 ? "" : "s"} still to store` });
      return { kind: "more" };
    }
    await finishJob(tenantId, jobId, out, summaryLine(out), { onlyIfRunning: true });
    return { kind: "done" };
  } catch (e) {
    await releaseJob(tenantId, jobId);
    const message = e instanceof Error ? e.message : "Could not store the document text.";
    await failJob(tenantId, jobId, message);
    return { kind: "failed", error: message };
  }
}

export function summaryLine(r: DocTextResult): string {
  const parts = [`${r.stored} document${r.stored === 1 ? "" : "s"} stored`];
  if (r.needReprocess.length) parts.push(`${r.needReprocess.length} need a Re-process`);
  if (r.failed.length) parts.push(`${r.failed.length} could not be read`);
  if (r.quotes) parts.push(`${r.placed} of ${r.quotes} card quotes placed`);
  return `${parts.join(", ")}.`;
}

/** Ask the server to run the next stage (no session: signed, scoped to this chain). */
export async function scheduleDocTextPass(origin: string, tenantId: string, jobId: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/jobs/doc-text/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, jobId, sig: signChain(tenantId, jobId, "doc-text-chain") }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) console.error(`[chain] doc-text continuation refused: ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("[chain] could not schedule the next doc-text stage", e);
    return false;
  }
}

/**
 * Start a run for every client (the Brain included) that has a ready document
 * with no stored text. Admin only: the caller checks. Returns the clients started.
 */
export async function startDocTextBackfill(origin: string, startedBy: string): Promise<{ tenants: number; documents: number }> {
  const { data: tenants, error } = await db.from("tenant").select("id");
  if (error) throw new Error(`could not list clients: ${error.message}`);
  let started = 0, documents = 0;
  for (const t of (tenants ?? []) as { id: string }[]) {
    const todo = await documentsToStore(t.id, new Set());
    if (!todo.length) continue;
    const jobId = await createJob(t.id, "doc_text", "Storing document text", startedBy);
    await supersedeRunning(t.id, "doc_text", jobId);
    await updateJob(t.id, jobId, { done: 0, total: todo.length, detail: `${todo.length} document${todo.length === 1 ? "" : "s"} to store` });
    started++;
    documents += todo.length;
    // Each client's first stage in its own invocation, started after this
    // request answers: run here one after another they would not fit in it.
    const tenantId = t.id;
    after(() => scheduleDocTextPass(origin, tenantId, jobId).then(() => undefined));
  }
  return { tenants: started, documents };
}

export interface DocTextStatus {
  ready: number;
  stored: number;
  needReprocess: number;
  running: number;
  /** The newest finished run per client, newest first. */
  recent: { tenantId: string; tenantName: string; status: string; detail: string | null; result: DocTextResult | null; finishedAt: string | null }[];
}

/** Across every client, for For Granted's panel. Admin only: the caller checks. */
export async function docTextStatus(): Promise<DocTextStatus> {
  const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const [{ count: ready }, { count: stored }, { count: needReprocess }, { data: jobs }, { data: tenants }] = await Promise.all([
    db.from("document").select("id", { count: "exact", head: true }).eq("status", "ready"),  // tenant-safe: a count across every client for For Granted's admin panel
    db.from("document_text").select("id", { count: "exact", head: true }),  // tenant-safe: a count across every client for For Granted's admin panel
    db.from("document_text").select("id", { count: "exact", head: true }).eq("chunks_aligned", false),  // tenant-safe: a count across every client for For Granted's admin panel
    db.from("job").select("tenant_id, status, detail, result, finished_at, started_at")  // tenant-safe: every client's backfill runs, for For Granted's admin panel
      .eq("kind", "doc_text").gte("started_at", since).order("started_at", { ascending: false }).limit(60),
    db.from("tenant").select("id, name"),
  ]);
  const name = new Map(((tenants ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name]));
  const seen = new Set<string>();
  const recent: DocTextStatus["recent"] = [];
  let running = 0;
  for (const j of (jobs ?? []) as { tenant_id: string; status: string; detail: string | null; result: unknown; finished_at: string | null }[]) {
    if (seen.has(j.tenant_id)) continue;
    seen.add(j.tenant_id);
    if (j.status === "running") running++;
    recent.push({ tenantId: j.tenant_id, tenantName: name.get(j.tenant_id) ?? "A client", status: j.status, detail: j.detail,
      result: j.result ? asResult(j.result) : null, finishedAt: j.finished_at });
  }
  return { ready: ready ?? 0, stored: stored ?? 0, needReprocess: needReprocess ?? 0, running, recent };
}
