import "server-only";
// Ingestion pipeline: extract -> chunk (page + char offsets) -> embed -> write.
// Runs inline after upload (docs at this scale take seconds). Scanned-PDF OCR
// via Textract needs an S3 staging bucket + IAM change — journaled follow-up;
// until then image-only PDFs fail loudly with a clear error, never silently.
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { db } from "./db";

const bedrock = new BedrockRuntimeClient({
  region: process.env.PORTAL_AWS_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.PORTAL_AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.PORTAL_AWS_SECRET_ACCESS_KEY!,
  },
});
const EMBED_MODEL = process.env.BEDROCK_EMBED_MODEL_ID ?? "amazon.titan-embed-text-v2:0";

interface PageText { page: number | null; text: string }

async function extract(buffer: Buffer, docKind: string): Promise<PageText[]> {
  if (docKind === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const res = await parser.getText();
      const pages = (res.pages ?? []).map((p: { text?: string }, i: number) => ({ page: i + 1, text: p.text ?? "" }));
      const totalChars = pages.reduce((n, p) => n + p.text.trim().length, 0);
      if (totalChars < 20) throw new Error("No extractable text — likely a scanned/image PDF. OCR (Textract) integration pending.");
      return pages;
    } finally { await parser.destroy(); }
  }
  if (docKind === "docx") {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer });
    return [{ page: null, text: res.value }];
  }
  if (docKind === "note" || docKind === "web") {
    return [{ page: null, text: buffer.toString("utf8") }];
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
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: EMBED_MODEL,
    body: JSON.stringify({ inputText: text.slice(0, 8000) }),
    contentType: "application/json",
  }));
  const body = JSON.parse(new TextDecoder().decode(res.body));
  return body.embedding as number[];
}

export async function processDocument(documentId: string): Promise<void> {
  const { data: doc } = await db.from("document").select("*").eq("id", documentId).single();
  if (!doc) throw new Error("document not found");
  await db.from("document").update({ status: "processing", error_detail: null }).eq("id", documentId);
  try {
    const { data: blob, error: dlErr } = await db.storage.from("documents").download(doc.storage_key);
    if (dlErr || !blob) throw new Error(`storage download failed: ${dlErr?.message}`);
    const buffer = Buffer.from(await blob.arrayBuffer());
    const pages = await extract(buffer, doc.doc_kind);
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
