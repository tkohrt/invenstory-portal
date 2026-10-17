// The stored text (Document Reader, Phase 0): building it, cutting passages
// from it, and re-pointing passages read before Phase 0.
import { describe, expect, test } from "vitest";
import { contentHash } from "@/lib/story-card";
import {
  PAGE_JOIN, buildDocText, chunkDocText, alignChunks, cleanPageText, pageAt, parsePageSpans, legacyChunkText, restampHash,
} from "@/lib/doc-text";

// The chunker as it was before Phase 0 (lib/server/ingest.ts chunkPages), kept
// here to prove old passages re-point into the new text.
function oldChunkPages(pages: { page: number | null; text: string }[], target = 1100, overlap = 150) {
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
      if (slice.length > 0) chunks.push({ chunk_index: idx++, text: slice, page_number: pg.page, char_start: globalOffset + start, char_end: globalOffset + end });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
    globalOffset += text.length;
  }
  return chunks;
}

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `${seed}${i}${i % 9 === 0 ? ".\n" : ""}`).join(" ");

describe("building the stored text", () => {
  test("pages are joined with a blank line and their spans recorded", () => {
    const { text, pages } = buildDocText([{ page: 1, text: "First page." }, { page: 2, text: "Second page." }]);
    expect(text).toBe(`First page.${PAGE_JOIN}Second page.`);
    expect(pages).toEqual([{ page: 1, start: 0, end: 11 }, { page: 2, start: 13, end: 25 }]);
    expect(text.slice(pages[1].start, pages[1].end)).toBe("Second page.");
  });

  test("cleaning: carriage returns, NUL, control characters and a byte-order mark go; tabs and newlines stay", () => {
    expect(cleanPageText("﻿a\r\nb\u0000c\x07d\te")).toBe("a\nbcd\te");
  });

  test("a document without pages is one span", () => {
    const { text, pages } = buildDocText([{ page: null, text: "Only text" }]);
    expect(text).toBe("Only text");
    expect(pages).toEqual([{ page: null, start: 0, end: 9 }]);
  });

  test("pageAt and parsePageSpans", () => {
    const spans = parsePageSpans([{ page: 2, start: 13, end: 25 }, { page: 1, start: 0, end: 11 }, { bad: true }, { page: 3, start: -1, end: 4 }]);
    expect(spans).toEqual([{ page: 1, start: 0, end: 11 }, { page: 2, start: 13, end: 25 }]);
    expect(pageAt(spans, 5)).toBe(1);
    expect(pageAt(spans, 14)).toBe(2);
    expect(pageAt([], 5)).toBeNull();
  });
});

describe("cutting passages", () => {
  test("every passage is exactly the text between its positions, trimmed, never across a page", () => {
    const pages = [{ page: 1, text: `  ${words(400, "a")}  ` }, { page: 2, text: words(300, "b") }, { page: 3, text: "   " }];
    const { text, pages: spans } = buildDocText(pages);
    const chunks = chunkDocText(text, spans);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(text.slice(c.char_start, c.char_end)).toBe(c.text);
      expect(c.text).toBe(c.text.trim());
      const span = spans.find(s => s.page === c.page_number)!;
      expect(c.char_start).toBeGreaterThanOrEqual(span.start);
      expect(c.char_end).toBeLessThanOrEqual(span.end);
    }
    expect(chunks.map(c => c.chunk_index)).toEqual(chunks.map((_, i) => i));
  });

  test("the cuts match the old chunker's words", () => {
    const pages = [{ page: 1, text: words(500, "x") }, { page: 2, text: words(200, "y") }];
    const { text, pages: spans } = buildDocText(pages);
    expect(chunkDocText(text, spans).map(c => c.text)).toEqual(oldChunkPages(pages).map(c => c.text));
  });
});

describe("re-pointing passages read before Phase 0", () => {
  test("every old passage is found, at its real place in the new text", () => {
    const pages = [{ page: 1, text: `Intro\r\n ${words(500, "p")}` }, { page: 2, text: `  ${words(400, "q")}` }, { page: 3, text: words(50, "r") }];
    const old = oldChunkPages(pages).map((c, i) => ({ id: `c${i}`, ...c }));
    const { text, pages: spans } = buildDocText(pages);
    const moves = alignChunks(text, spans, old)!;
    expect(moves).not.toBeNull();
    expect(moves).toHaveLength(old.length);
    for (const m of moves) {
      const c = old.find(o => o.id === m.id)!;
      expect(text.slice(m.char_start, m.char_end)).toBe(c.text);
    }
  });

  test("a repeated passage is placed near its old position, not at the first copy", () => {
    const block = "The same paragraph appears twice in this document, word for word.";
    const pages = [{ page: 1, text: `${block}\n${"filler ".repeat(200)}` }, { page: 2, text: block }];
    const old = oldChunkPages(pages).map((c, i) => ({ id: `c${i}`, ...c }));
    const last = old[old.length - 1];
    expect(last.text).toBe(block);
    const { text, pages: spans } = buildDocText(pages);
    const moves = alignChunks(text, spans, old)!;
    const m = moves.find(x => x.id === last.id)!;
    expect(m.char_start).toBe(spans[1].start);
  });

  test("a passage the new text does not contain means the document needs a re-process", () => {
    const { text, pages } = buildDocText([{ page: 1, text: "What the file says today." }]);
    expect(alignChunks(text, pages, [{ id: "a", chunk_index: 0, text: "What the file said when it was read.", page_number: 1, char_start: 0 }])).toBeNull();
  });

  test("the old stitched text is passages joined with a newline", () => {
    expect(legacyChunkText([{ text: "a" }, { text: null }, { text: "b" }])).toBe("a\n\nb");
  });
});

describe("re-stamping a stored read (no paid re-read for the change of text source)", () => {
  const oldText = "passage one\npassage two";
  const newText = "passage one passage two, stored";
  test("the analysis's hash keeps its reader-version prefix", () => {
    expect(restampHash(`r3:${contentHash(oldText)}`, oldText, newText)).toBe(`r3:${contentHash(newText)}`);
  });
  test("the Card Library's and search profile's plain hash", () => {
    expect(restampHash(contentHash(oldText), oldText, newText)).toBe(contentHash(newText));
  });
  test("a read of some other text is left alone, so a changed document is still read", () => {
    expect(restampHash(contentHash("something else"), oldText, newText)).toBeNull();
    expect(restampHash(`r2:${contentHash("x")}`, oldText, newText)).toBeNull();
  });
  test("skip markers and the Read again mark never move", () => {
    for (const h of ["boilerplate", "empty", "reread", null]) expect(restampHash(h, oldText, newText)).toBeNull();
  });
  test("a hash that only ends like the old one is not mistaken for it", () => {
    expect(restampHash(`xx${contentHash(oldText)}`, oldText, newText)).toBeNull();
  });
});
