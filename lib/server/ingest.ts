import "server-only";
// Ingestion pipeline: extract -> chunk (page + char offsets) -> embed -> write.
// Runs inline after upload (docs at this scale take seconds). Scanned-PDF OCR
// via Textract needs an S3 staging bucket + IAM change — journaled follow-up;
// until then image-only PDFs fail loudly with a clear error, never silently.
import { after } from "next/server";
import { embedText, embedTextsParallel } from "./embed";
import { db } from "./db";
import { uploadReadsLastDay, withAiUsage } from "./ai-usage";
import { checkAllowance } from "./allowance";
import { uploadReadNow, type Actor } from "@/lib/usage-limits";

const EMBED_MODEL = "gte-small";

interface PageText { page: number | null; text: string }

// Decode text robustly: many transcript exports are UTF-16. Detect by BOM.
function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le");
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      const swapped = Buffer.from(buffer);
      for (let i = 0; i + 1 < swapped.length; i += 2) { const t = swapped[i]; swapped[i] = swapped[i + 1]; swapped[i + 1] = t; }
      return swapped.toString("utf16le");
    }
  }
  return buffer.toString("utf8");
}

// Postgres text cannot store null bytes; strip them, a leading BOM, and other
// non-printable control chars (keep tab/newline/carriage return).
function sanitizeText(s: string): string {
  return s.replace(/^\uFEFF/, "").replace(/\u0000/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function stripRtf(buffer: Buffer): string {
  let s = buffer.toString("latin1");
  s = s.replace(/\\'[0-9a-fA-F]{2}/g, "");      // hex-escaped chars
  s = s.replace(/\\u-?\d+\??/g, "");           // unicode escapes
  s = s.replace(/\\par[d]?\b/g, "\n");         // paragraph breaks
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, "");     // control words
  s = s.replace(/[{}]/g, "").replace(/\\\*/g, "");
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function extract(buffer: Buffer, docKind: string): Promise<PageText[]> {
  if (docKind === "pdf") {
    // unpdf: serverless-safe PDF text extraction (no DOMMatrix/browser globals,
    // unlike pdf-parse/pdf.js which fails on Vercel's Node runtime).
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const res = await extractText(pdf, { mergePages: false });
    const perPage = Array.isArray(res.text) ? res.text : [res.text];
    const pages = perPage.map((t, i) => ({ page: i + 1, text: t ?? "" }));
    const totalChars = pages.reduce((n, p) => n + p.text.trim().length, 0);
    if (totalChars < 20) throw new Error("This PDF is a scan: its pages are pictures with no text in them, and the portal cannot read scans yet. Upload a text-based copy instead (for a 990, the e-filed PDF from ProPublica Nonprofit Explorer or the IRS usually has text).");
    return pages;
  }
  if (docKind === "docx") {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer });
    return [{ page: null, text: res.value }];
  }
  if (docKind === "note" || docKind === "web") {
    return [{ page: null, text: decodeText(buffer) }];
  }
  if (docKind === "rtf") {
    return [{ page: null, text: stripRtf(buffer) }];
  }
  if (docKind === "audio") {
    throw new Error("Audio files can't be read yet. Upload a transcript of the recording instead.");
  }
  if (docKind === "xlsx") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    const pages: PageText[] = [];
    wb.SheetNames.forEach((name, i) => {
      const ws = wb.Sheets[name];
      if (!ws) return;
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false }).trim();
      if (csv) pages.push({ page: i + 1, text: `# Sheet: ${name}\n${csv}` });
    });
    const total = pages.reduce((n, p) => n + p.text.trim().length, 0);
    if (total < 5) throw new Error("No extractable text in this spreadsheet — it may be empty or contain only images/charts.");
    return pages;
  }
  throw new Error(`Unsupported doc kind: ${docKind}`);
}

export function chunkPages(pages: PageText[], target = 1100, overlap = 150): {
  chunk_index: number; text: string; page_number: number | null; char_start: number; char_end: number;
}[] {
  const chunks: { chunk_index: number; text: string; page_number: number | null; char_start: number; char_end: number }[] = [];
  let idx = 0; let globalOffset = 0;
  for (const pg of pages) {
    const text = pg.text.replace(/\r/g, "");
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + target, text.length);
      if (end < text.length) {
        const breakAt = text.lastIndexOf("\n", end);
        if (breakAt > start + target / 2) end = breakAt;
        else { const sp = text.lastIndexOf(" ", end); if (sp > start + target / 2) end = sp; }
      }
      const slice = text.slice(start, end).trim();
      if (slice.length > 0) {
        chunks.push({ chunk_index: idx++, text: slice, page_number: pg.page,
          char_start: globalOffset + start, char_end: globalOffset + end });
      }
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
    globalOffset += text.length;
  }
  return chunks;
}

export async function embed(text: string): Promise<number[]> {
  const v = await embedText(text);
  if (!v) throw new Error("embedding unavailable");
  return v;
}

/**
 * Read a document into passages and embeddings, then fold it into readiness.
 *
 * `actor` is who caused this read (defaults from the document's source). The
 * readiness read is the only model call here, and for a client it follows the
 * limits of 6 October 2026 (lib/usage-limits.ts): when a client processes a
 * document again and its text has not changed, it is skipped, and past 30
 * readiness reads a day for one client it waits (the next readiness refresh or
 * analysis picks it up). The upload itself is never blocked. Admins never wait.
 */
export async function processDocument(documentId: string, opts: { actor?: Actor; reprocess?: boolean } = {}): Promise<void> {
  const { data: doc } = await db.from("document").select("*").eq("id", documentId).single();  // tenant-safe: ingestion worker: single document resolved by id
  if (!doc) throw new Error("document not found");
  const actor: Actor = opts.actor ?? (doc.source === "client" ? "client" : "admin");
  // The text read last time, to tell a real change from a repeat press.
  let previousText: string | null = null;
  if (opts.reprocess) {
    const { data: old } = await db.from("document_chunk").select("text, chunk_index").eq("document_id", documentId).order("chunk_index");  // tenant-safe: ingestion worker: chunks of the document being processed
    previousText = ((old ?? []) as { text: string | null }[]).map(c => c.text ?? "").join("\n");
  }
  await db.from("document").update({ status: "processing", error_detail: null }).eq("id", documentId);  // tenant-safe: ingestion worker: same document by id
  try {
    const { data: blob, error: dlErr } = await db.storage.from("documents").download(doc.storage_key);
    if (dlErr || !blob) throw new Error(`storage download failed: ${dlErr?.message}`);
    const buffer = Buffer.from(await blob.arrayBuffer());
    const rawPages = await extract(buffer, doc.doc_kind);
    const pages = rawPages.map(p => ({ ...p, text: sanitizeText(p.text) }));
    if (pages.reduce((n, p) => n + p.text.trim().length, 0) < 20) throw new Error("No usable text after decoding — the file may be empty, image-only, or an unsupported encoding.");
    const chunks = chunkPages(pages);
    if (chunks.length === 0) throw new Error("extraction produced no text");
    // replace any prior chunks (reprocess-safe)
    await db.from("document_chunk").delete().eq("document_id", documentId);  // tenant-safe: ingestion worker: chunks of the document being processed

    // Chunks in bulk, then embeddings in parallel batches, then vectors in bulk.
    // One round trip per chunk (insert, embed, insert) cost about half a second
    // each, so a long transcript ran out the 60-second function budget before it
    // could be marked ready (30 September 2026, a 127-chunk transcript: 504).
    for (let i = 0; i < chunks.length; i += 200) {
      const { error } = await db.from("document_chunk").insert(
        chunks.slice(i, i + 200).map(c => ({ document_id: documentId, tenant_id: doc.tenant_id, ...c, embedding_model: EMBED_MODEL })),
      );
      if (error) throw error;
    }
    const { missing, total } = await indexMissingEmbeddings(documentId, doc.tenant_id, Date.now() + 35_000);
    const embedFailure = missing > 0 ? `${missing} of ${total} passages not yet embedded` : null;

    const snippet = chunks[0].text.slice(0, 220);
    await db.from("document").update({  // tenant-safe: ingestion worker: same document by id
      status: "ready", snippet,
      // Text stays readable either way; the drawer's "Finish indexing" completes the rest.
      error_detail: embedFailure ? `${INDEX_PENDING}: ${embedFailure}` : null,
    }).eq("id", documentId);

    // Best-effort: fold this new document's evidence into the tenant's readiness
    // coverage so the Readiness Checklist updates on upload (full recompute still
    // available via the button). It is model calls over the whole document, so it
    // runs after the response has been sent: a long transcript must not turn a
    // successful upload into a timeout. Outside a request it simply runs inline.
    const sameText = previousText !== null && previousText === chunks.map(c => c.text ?? "").join("\n");
    const mergeCoverage = async () => {
      try {
        if (actor === "client") {
          if (sameText) return;  // processed again with nothing new to read
          if (!uploadReadNow(actor, await uploadReadsLastDay(doc.tenant_id))) {
            await db.from("audit_log").insert({ tenant_id: doc.tenant_id, action: "upload_ai_read_deferred", detail: documentId });
            return;
          }
          // Counted toward the monthly AI allowance (Phase D) and never
          // stopped by it: reading what a client uploads is building the
          // Inven(s)tory. The check is made for its alert to For Granted.
          await checkAllowance("client", doc.tenant_id, { kind: "build" });
          await db.from("audit_log").insert({ tenant_id: doc.tenant_id, action: "upload_ai_read", detail: documentId });
        }
        const { mergeDocumentIntoCoverage } = await import("./doc-extract");
        await withAiUsage({ tenantId: doc.tenant_id, userId: doc.uploaded_by ?? null, actor, feature: "upload_readiness" },
          () => mergeDocumentIntoCoverage(documentId));
      } catch { /* non-fatal */ }
    };
    try { after(mergeCoverage); } catch { await mergeCoverage(); }
  } catch (e) {
    await db.from("document").update({  // tenant-safe: ingestion worker: same document by id
      status: "failed", error_detail: e instanceof Error ? e.message.slice(0, 300) : "unknown error",
    }).eq("id", documentId);
    throw e;
  }
}

/** The error_detail prefix for a document whose text is in but whose semantic index is not complete. */
export const INDEX_PENDING = "semantic index pending";

/**
 * Embed whichever of a document's passages have no vector yet, until the
 * deadline. Safe to call repeatedly: it only ever fills gaps, and a vector
 * written twice is ignored (chunk_id is the primary key).
 */
export async function indexMissingEmbeddings(
  documentId: string, tenantId: string, deadline: number,
): Promise<{ missing: number; total: number }> {
  const { data: chunks, error } = await db.from("document_chunk")
    .select("id, text").eq("tenant_id", tenantId).eq("document_id", documentId).order("chunk_index");
  if (error) throw error;
  const all = (chunks ?? []) as { id: string; text: string }[];
  if (!all.length) return { missing: 0, total: 0 };
  const have = new Set<string>();
  for (let i = 0; i < all.length; i += 200) {
    const { data } = await db.from("chunk_embedding").select("chunk_id")
      .eq("tenant_id", tenantId).in("chunk_id", all.slice(i, i + 200).map(c => c.id));
    for (const r of (data ?? []) as { chunk_id: string }[]) have.add(r.chunk_id);
  }
  const todo = all.filter(c => !have.has(c.id));
  if (todo.length && Date.now() < deadline) {
    const vectors = await embedTextsParallel(todo.map(c => c.text), { deadline });
    const rows = todo.flatMap((c, i) => vectors[i]
      ? [{ chunk_id: c.id, tenant_id: tenantId, embedding: JSON.stringify(vectors[i]) }] : []);
    for (let i = 0; i < rows.length; i += 100) {
      // tenant-safe: every row in the payload carries this document's tenant_id
      const { error: eErr } = await db.from("chunk_embedding").upsert(rows.slice(i, i + 100), { onConflict: "chunk_id", ignoreDuplicates: true });
      if (eErr) throw eErr;
      for (const r of rows.slice(i, i + 100)) have.add(r.chunk_id);
    }
  }
  return { missing: all.filter(c => !have.has(c.id)).length, total: all.length };
}
