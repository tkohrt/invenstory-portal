import "server-only";
// Ingestion pipeline: extract -> chunk (page + char offsets) -> embed -> write.
// Runs inline after upload (docs at this scale take seconds). Scanned-PDF OCR
// via Textract needs an S3 staging bucket + IAM change — journaled follow-up;
// until then image-only PDFs fail loudly with a clear error, never silently.
import { embedText } from "./embed";
import { db } from "./db";

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
    if (totalChars < 20) throw new Error("No extractable text — likely a scanned/image PDF. OCR (Textract) integration pending.");
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
  if (docKind === "audio") {
    throw new Error("Audio transcription pending (Transcribe/Whisper integration — Phase 3b follow-up).");
  }
  if (docKind === "xlsx") {
    throw new Error("Spreadsheet text extraction pending — stored for reference; not yet searchable.");
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

export async function processDocument(documentId: string): Promise<void> {
  const { data: doc } = await db.from("document").select("*").eq("id", documentId).single();
  if (!doc) throw new Error("document not found");
  await db.from("document").update({ status: "processing", error_detail: null }).eq("id", documentId);
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
    await db.from("document_chunk").delete().eq("document_id", documentId);
    let embedFailure: string | null = null;
    for (const c of chunks) {
      const { data: row, error } = await db.from("document_chunk").insert({
        document_id: documentId, tenant_id: doc.tenant_id, ...c, embedding_model: EMBED_MODEL,
      }).select("id").single();
      if (error) throw error;
      if (embedFailure) continue; // text stays searchable; embeddings backfill via /api/ingest
      try {
        const vector = await embed(c.text);
        const { error: eErr } = await db.from("chunk_embedding").insert({
          chunk_id: row.id, tenant_id: doc.tenant_id, embedding: JSON.stringify(vector),
        });
        if (eErr) throw eErr;
      } catch (e) {
        embedFailure = e instanceof Error ? e.message.slice(0, 160) : "embedding failed";
      }
    }
    const snippet = chunks[0].text.slice(0, 220);
    await db.from("document").update({
      status: "ready", snippet,
      error_detail: embedFailure ? `semantic index pending: ${embedFailure}` : null,
    }).eq("id", documentId);
  } catch (e) {
    await db.from("document").update({
      status: "failed", error_detail: e instanceof Error ? e.message.slice(0, 300) : "unknown error",
    }).eq("id", documentId);
    throw e;
  }
}
