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

/** What ingestion cuts passages from: the extracted text, or a text a person edited, which a re-extraction never replaces. */
export interface IngestText { text: string; pages: PageSpan[]; chunks: TextChunk[]; edited: boolean }

/**
 * The text a document's passages are cut from, without storing anything yet.
 * A version whose text a person edited (Phase 3) keeps that text: re-processing
 * the file cuts passages from the edited text rather than failing or
 * overwriting it.
 */
export async function textForIngest(
  doc: { id: string; tenant_id: string; current_version?: number | null }, pages: PageText[],
): Promise<IngestText> {
  const version = doc.current_version ?? 1;
  const { data: existing } = await db.from("document_text").select("origin, text, pages")
    .eq("tenant_id", doc.tenant_id).eq("document_id", doc.id).eq("version", version).maybeSingle();
  if (existing && existing.origin !== "extracted") {
    const spans = parsePageSpans(existing.pages);
    return { text: existing.text as string, pages: spans, chunks: chunkDocText(existing.text as string, spans), edited: true };
  }
  const built = buildDocText(pages);
  return { ...built, chunks: chunkDocText(built.text, built.pages), edited: false };
}

/**
 * Store an extracted text. Never replaces an edited one (the row is only
 * written while it is absent or extracted). `chunksAligned` false means the
 * document's passages do not point into this text yet; every reader then keeps
 * reading the old stitched text until they do.
 */
export async function storeExtractedText(
  doc: { id: string; tenant_id: string; current_version?: number | null },
  built: { text: string; pages: PageSpan[] },
  opts: { chunksAligned: boolean },
): Promise<void> {
  const version = doc.current_version ?? 1;
  const { data: existing } = await db.from("document_text").select("origin")
    .eq("tenant_id", doc.tenant_id).eq("document_id", doc.id).eq("version", version).maybeSingle();
  if (existing && existing.origin !== "extracted") return;
  const { error } = await db.from("document_text").upsert({
    tenant_id: doc.tenant_id, document_id: doc.id, version,
    text: built.text, text_hash: textHash(built.text), pages: built.pages,
    origin: "extracted", chunks_aligned: opts.chunksAligned,
  }, { onConflict: "document_id,version" });
  if (error) throw new Error(`could not store the document's text: ${error.message}`);
}

/** Mark a stored text's passages as pointing into it. */
export async function markAligned(tenantId: string, documentId: string, version: number): Promise<void> {
  const { error } = await db.from("document_text").update({ chunks_aligned: true })
    .eq("tenant_id", tenantId).eq("document_id", documentId).eq("version", version);
  if (error) throw new Error(`could not record the passages as re-pointed: ${error.message}`);
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
  // Only texts the passages point into. One the backfill could not align is
  // shown in the reader but not read by anything until a Re-process aligns it.
  let q = db.from("document_text").select("document_id, version, text").eq("tenant_id", tenantId).eq("chunks_aligned", true);
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
  // Paged: a request returns at most 1,000 rows, and a client with more passages
  // than that would otherwise get truncated texts (and re-reads every run).
  const chunks: { document_id: string; text: string | null }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = db.from("document_chunk").select("document_id, chunk_index, text").eq("tenant_id", tenantId);
    if (ids) q = q.in("document_id", ids);
    const { data, error } = await q.order("document_id").order("chunk_index").range(from, from + PAGE - 1);
    if (error) throw new Error(`could not read document text: ${error.message}`);
    const rows = (data ?? []) as { document_id: string; text: string | null }[];
    chunks.push(...rows);
    if (rows.length < PAGE) break;
  }
  const rowsByDoc = new Map<string, { text: string | null }[]>();
  for (const c of chunks) {
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
  // A transcript's speaker roster is reused while the text's length is the one
  // it was worked out for (lib/server/speaker-roster.ts): moved too, so the next
  // read does not pay to work it out again.
  const { data: d } = await db.from("document").select("speaker_roster")
    .eq("tenant_id", tenantId).eq("id", documentId).maybeSingle();
  const roster = d?.speaker_roster as { chars?: number } | null | undefined;
  if (roster && roster.chars === oldText.length && oldText.length !== newText.length) {
    const { error } = await db.from("document").update({ speaker_roster: { ...roster, chars: newText.length } })
      .eq("tenant_id", tenantId).eq("id", documentId);
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
    .eq("tenant_id", tenantId).eq("chunks_aligned", true).in("document_id", ids);
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
