import "server-only";
// The stored text of a document, server side (Document Reader, Phase 0; 0069).
// The pure rules are lib/doc-text.ts.
//
// Every reader takes a document's text from here: the reader page, the
// analysis, the readiness reader, the Card Library and the search profile. A
// document with no stored text yet (read before Phase 0 and not yet reached by
// the backfill) falls back to the text those readers built before: passages in
// order, joined with a newline (legacyChunkText). So nothing changes for a
// document until its text is stored, and then everything reads the same text.
//
// Re-reads are never paid for because of this change. Each read stores a hash
// of the text it read, ending `${length}:${hash}` (contentHash in
// lib/story-card.ts, with the analysis's "r3:" reader-version prefix in front).
// When a document's stored text replaces the old stitched text, that ending is
// re-stamped from the old text to the new (restampHash), by the backfill and,
// as a backstop, by healLegacyHashes when a reader finds a read whose hash
// matches the OLD text of a document that now has a stored text.
import { createHash } from "node:crypto";
import { db } from "./db";
import {
  buildDocText, chunkDocText, legacyChunkText, parsePageSpans, restampHash,
  type PageText, type PageSpan, type TextChunk,
} from "@/lib/doc-text";

export interface StoredText { documentId: string; version: number; text: string; pages: PageSpan[]; chunksAligned: boolean }

export function textHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Store a document's text as extracted, and return it with the passages cut
 * from it. Replaces only an extracted text of the same version; a text a
 * person edited (Phase 3) is never overwritten by a re-extraction.
 */
export async function saveExtractedText(
  doc: { id: string; tenant_id: string; current_version?: number | null },
  pages: PageText[],
  opts: { chunksAligned?: boolean } = {},
): Promise<{ text: string; pages: PageSpan[]; chunks: TextChunk[] }> {
  const built = buildDocText(pages);
  const version = doc.current_version ?? 1;
  const { data: existing } = await db.from("document_text").select("origin")
    .eq("tenant_id", doc.tenant_id).eq("document_id", doc.id).eq("version", version).maybeSingle();
  if (existing && existing.origin !== "extracted") {
    throw new Error("This version of the document has edited text, and re-extracting would overwrite it.");
  }
  const { error } = await db.from("document_text").upsert({
    tenant_id: doc.tenant_id, document_id: doc.id, version,
    text: built.text, text_hash: textHash(built.text), pages: built.pages,
    origin: "extracted", chunks_aligned: opts.chunksAligned ?? true,
  }, { onConflict: "document_id,version" });
  if (error) throw new Error(`could not store the document's text: ${error.message}`);
  return { ...built, chunks: chunkDocText(built.text, built.pages) };
}

/** The stored text of one of a tenant's documents (latest version), or null. */
export async function storedText(tenantId: string, documentId: string): Promise<StoredText | null> {
  const { data } = await db.from("document_text")
    .select("document_id, version, text, pages, chunks_aligned")
    .eq("tenant_id", tenantId).eq("document_id", documentId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return {
    documentId: data.document_id as string, version: data.version as number, text: data.text as string,
    pages: parsePageSpans(data.pages), chunksAligned: data.chunks_aligned as boolean,
  };
}

/**
 * Each document's text, as every reader reads it: the stored text, or for a
 * document without one the old stitched text. `ids` limits it to some
 * documents of the tenant.
 */
export async function readerTexts(tenantId: string, ids?: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let q = db.from("document_text").select("document_id, version, text").eq("tenant_id", tenantId);
  if (ids) {
    if (!ids.length) return out;
    q = q.in("document_id", ids);
  }
  const { data: stored, error } = await q;
  if (error) throw new Error(`could not read document text: ${error.message}`);
  const best = new Map<string, number>();
  for (const r of (stored ?? []) as { document_id: string; version: number; text: string }[]) {
    if ((best.get(r.document_id) ?? -1) < r.version) { best.set(r.document_id, r.version); out.set(r.document_id, r.text); }
  }
  const legacy = await legacyTexts(tenantId, ids ? ids.filter(id => !out.has(id)) : undefined, out);
  for (const [id, t] of legacy) if (!out.has(id)) out.set(id, t);
  return out;
}

/** The text readers built before Phase 0, from the passages. `skip` holds documents already answered. */
export async function legacyTexts(tenantId: string, ids?: string[], skip?: Map<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids && !ids.length) return out;
  let q = db.from("document_chunk").select("document_id, chunk_index, text").eq("tenant_id", tenantId);
  if (ids) q = q.in("document_id", ids);
  const { data: chunks, error } = await q.order("chunk_index");
  if (error) throw new Error(`could not read document text: ${error.message}`);
  const rowsByDoc = new Map<string, { text: string | null }[]>();
  for (const c of ((chunks ?? []) as { document_id: string; text: string | null }[])) {
    if (skip?.has(c.document_id)) continue;
    const list = rowsByDoc.get(c.document_id) ?? [];
    list.push({ text: c.text });
    rowsByDoc.set(c.document_id, list);
  }
  for (const [id, rows] of rowsByDoc) out.set(id, legacyChunkText(rows));
  return out;
}

export const READ_TABLES = ["analysis_doc", "story_card_doc", "search_profile_doc"] as const;
export type ReadTable = typeof READ_TABLES[number];

/** Re-stamp one document's reads in every read table. Returns how many were moved. */
export async function restampReads(tenantId: string, documentId: string, oldText: string, newText: string): Promise<number> {
  let moved = 0;
  for (const table of READ_TABLES) {
    const { data } = await db.from(table).select("content_hash")
      .eq("tenant_id", tenantId).eq("document_id", documentId).maybeSingle();
    const next = restampHash((data?.content_hash as string | null) ?? null, oldText, newText);
    if (!next || next === data?.content_hash) continue;
    const { error } = await db.from(table).update({ content_hash: next })
      .eq("tenant_id", tenantId).eq("document_id", documentId).eq("content_hash", data!.content_hash as string);
    if (!error) moved++;
  }
  return moved;
}

/**
 * The backstop. A reader about to treat these documents as changed asks first
 * whether each one's stored hash is of its OLD stitched text while the
 * document now has a stored text: if so, the read is re-stamped and the
 * document is not changed at all. Returns the ids healed. Costs one passage
 * read for the few documents in question, and nothing when there are none.
 */
export async function healLegacyHashes(
  tenantId: string, table: ReadTable,
  candidates: { documentId: string; hash: string | null; text: string }[],
  /** Would the reader accept this hash as a read of the current text? (A read under older rules stays stale.) */
  fresh: (hash: string, text: string) => boolean,
): Promise<Set<string>> {
  const healed = new Set<string>();
  const ids = candidates.filter(c => c.hash).map(c => c.documentId);
  if (!ids.length) return healed;
  const { data: hasText } = await db.from("document_text").select("document_id")
    .eq("tenant_id", tenantId).in("document_id", ids);
  const withText = new Set(((hasText ?? []) as { document_id: string }[]).map(r => r.document_id));
  const todo = candidates.filter(c => c.hash && withText.has(c.documentId));
  if (!todo.length) return healed;
  const legacy = await legacyTexts(tenantId, todo.map(c => c.documentId));
  for (const c of todo) {
    const old = legacy.get(c.documentId);
    if (old === undefined) continue;
    const next = restampHash(c.hash, old, c.text);
    if (!next) continue;
    const { error } = await db.from(table).update({ content_hash: next })
      .eq("tenant_id", tenantId).eq("document_id", c.documentId).eq("content_hash", c.hash!);
    if (!error && fresh(next, c.text)) healed.add(c.documentId);
  }
  return healed;
}
