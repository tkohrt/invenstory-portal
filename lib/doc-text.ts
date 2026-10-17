// The stored text of a document (Document Reader, Phase 0; migration 0069).
//
// One text per document version, and every reader reads that exact text: the
// reader page, the analysis, the readiness reader, the Card Library and the
// search profile. A quote checked against it is then located in the same text a
// person reads, and a passage's position means the same thing everywhere.
//
// Pure and tested (tests/reader/doc-text.test.ts). The server half, which reads
// and writes the table, is lib/server/doc-text.ts.
//
// How the text is made from what extraction returns, page by page:
//   - each page is cleaned exactly as ingestion always cleaned it (a leading
//     byte-order mark, NUL and other control characters except tab, newline and
//     carriage return removed), then carriage returns are removed, as chunking
//     always did. Every passage read before Phase 0 is therefore a substring of
//     the new text, which is what lets the backfill re-point old passages
//     without re-reading anything (alignChunks).
//   - pages are joined with a blank line (PAGE_JOIN). Before Phase 0 they were
//     joined with nothing, so a quote could run the last word of one page into
//     the first of the next; the locator's spacing-blind pass still finds those.

import { contentHash } from "./story-card";

export interface PageText { page: number | null; text: string }
/** Where one page sits in the stored text: [start, end). */
export interface PageSpan { page: number | null; start: number; end: number }

export const PAGE_JOIN = "\n\n";

/** The cleaning ingestion has always applied to extracted text, then carriage returns removed. */
export function cleanPageText(s: string): string {
  return s
    .replace(/^﻿/, "")
    .replace(/\u0000/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\r/g, "");
}

/** The stored text and where each page sits in it. */
export function buildDocText(pages: PageText[]): { text: string; pages: PageSpan[] } {
  let text = "";
  const spans: PageSpan[] = [];
  pages.forEach((p, i) => {
    if (i > 0) text += PAGE_JOIN;
    const t = cleanPageText(p.text ?? "");
    spans.push({ page: p.page, start: text.length, end: text.length + t.length });
    text += t;
  });
  return { text, pages: spans };
}

/** Read page spans stored as jsonb, keeping only well-formed entries. */
export function parsePageSpans(raw: unknown): PageSpan[] {
  if (!Array.isArray(raw)) return [];
  const out: PageSpan[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const start = Number(o.start), end = Number(o.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) continue;
    const page = o.page === null || o.page === undefined ? null : Number(o.page);
    out.push({ page: page !== null && Number.isFinite(page) ? page : null, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The page a position falls on, or null for kinds without pages. */
export function pageAt(pages: PageSpan[], offset: number): number | null {
  let found: PageSpan | null = null;
  for (const p of pages) {
    if (p.start <= offset) found = p; else break;
  }
  return found?.page ?? null;
}

export interface TextChunk {
  chunk_index: number; text: string; page_number: number | null; char_start: number; char_end: number;
}

const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === " ";

/**
 * The passages a document is searched by, cut from the stored text.
 *
 * The same cuts as before Phase 0 (about 1,100 characters, 150 of overlap,
 * breaking at a line or a space, never across a page), with one difference:
 * char_start and char_end are now EXACT, so text.slice(char_start, char_end)
 * is the passage, whitespace trimmed off both ends included.
 */
export function chunkDocText(text: string, pages: PageSpan[], target = 1100, overlap = 150): TextChunk[] {
  const chunks: TextChunk[] = [];
  let idx = 0;
  const spans = pages.length ? pages : [{ page: null, start: 0, end: text.length }];
  for (const pg of spans) {
    const pageText = text.slice(pg.start, pg.end);
    let start = 0;
    while (start < pageText.length) {
      let end = Math.min(start + target, pageText.length);
      if (end < pageText.length) {
        const breakAt = pageText.lastIndexOf("\n", end);
        if (breakAt > start + target / 2) end = breakAt;
        else { const sp = pageText.lastIndexOf(" ", end); if (sp > start + target / 2) end = sp; }
      }
      let s = start, e = end;
      while (s < e && isSpace(pageText[s])) s++;
      while (e > s && isSpace(pageText[e - 1])) e--;
      if (e > s) {
        chunks.push({ chunk_index: idx++, text: pageText.slice(s, e), page_number: pg.page,
          char_start: pg.start + s, char_end: pg.start + e });
      }
      if (end >= pageText.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return chunks;
}

export interface OldChunk { id: string; chunk_index: number; text: string | null; page_number: number | null; char_start: number }
export interface ChunkMove { id: string; char_start: number; char_end: number }

/**
 * Re-point passages read before Phase 0 into the stored text, without changing
 * their words, ids or embeddings. Each passage's text must appear in the
 * stored text exactly; it is looked for near where its old position says it
 * should be (old positions ignored the page breaks and trimmed spaces), then
 * anywhere after the previous passage. Returns null when any passage cannot be
 * found: the stored text then differs from what was read, and the document
 * needs a Re-process instead (chunks_aligned false).
 */
export function alignChunks(text: string, pages: PageSpan[], chunks: OldChunk[]): ChunkMove[] | null {
  const ordered = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  const pageIndex = new Map<number, number>();
  pages.forEach((p, i) => { if (p.page !== null) pageIndex.set(p.page, i); });
  const moves: ChunkMove[] = [];
  let floor = 0;
  for (const c of ordered) {
    const t = c.text ?? "";
    if (!t) return null;
    const shift = c.page_number !== null ? (pageIndex.get(c.page_number) ?? 0) * PAGE_JOIN.length : 0;
    const estimate = c.char_start + shift;
    const WINDOW = 400;
    let at = text.indexOf(t, Math.max(0, estimate - WINDOW));
    if (at < 0 || at > estimate + WINDOW) at = text.indexOf(t, floor);
    if (at < 0) return null;
    moves.push({ id: c.id, char_start: at, char_end: at + t.length });
    floor = at;
  }
  return moves;
}

/** The text the readers built before Phase 0: passages in order, joined with a newline, overlap included. */
export function legacyChunkText(rows: { text: string | null }[]): string {
  return rows.map(c => c.text ?? "").join("\n");
}

/**
 * A read's stored hash, moved from the old text to the new (no re-read, no
 * charge, for a change of where the text comes from). Every read stores a hash
 * ending `${length}:${hash}` (contentHash), the analysis's with a reader-version
 * prefix ("r3:"). The ending of the OLD text is replaced by the new text's,
 * keeping the prefix. Null when the stored hash is not of the old text: a
 * document that really changed, a skip marker ("boilerplate", "empty"), or a
 * Read again mark. Then nothing moves, and the document is read as it should be.
 */
export function restampHash(stored: string | null, oldText: string, newText: string): string | null {
  if (!stored) return null;
  const oldH = contentHash(oldText);
  if (!stored.endsWith(oldH)) return null;
  const prefix = stored.slice(0, stored.length - oldH.length);
  if (prefix && !/^r\d+:$/.test(prefix)) return null;
  return prefix + contentHash(newText);
}
