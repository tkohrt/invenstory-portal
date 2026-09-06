import { describe, it, expect } from "vitest";
import { chunkText } from "@/lib/search-profile";

/**
 * The regression this file exists for.
 *
 * The Search Profile build stalled at five of fifteen documents on RE-Assist,
 * and pressing Continue read the SAME five again, forever. The reader joined a
 * document's chunks with newlines and recorded the length of the result; the
 * staleness pre-filter added up the chunks' own lengths. The two answers differ
 * by one character per chunk boundary, so every document looked changed on
 * every pass, nothing was ever considered read, and the chain could not advance
 * past one budget's worth of work.
 *
 * Both sides now call chunkText. These tests keep them that way.
 */
describe("chunkText", () => {
  it("joins chunks with a newline between them", () => {
    expect(chunkText([{ text: "a" }, { text: "b" }, { text: "c" }])).toBe("a\nb\nc");
  });

  it("is longer than the sum of its chunks, which is the whole bug", () => {
    const rows = [{ text: "abc" }, { text: "de" }, { text: "f" }];
    const naiveSum = rows.reduce((n, r) => n + (r.text?.length ?? 0), 0);
    expect(naiveSum).toBe(6);
    expect(chunkText(rows).length).toBe(8);
    expect(chunkText(rows).length).not.toBe(naiveSum);
  });

  it("reproduces the exact lengths the stalled RE-Assist run recorded", () => {
    // Live values: summed chunk length, chunk count, and the length the reader
    // stored in search_profile_doc.chars. The stored figure is the sum plus one
    // per boundary, every time.
    const observed = [
      { sum: 3143, chunks: 4, stored: 3146 },
      { sum: 8059, chunks: 9, stored: 8067 },
      { sum: 8883, chunks: 10, stored: 8892 },
      { sum: 57207, chunks: 61, stored: 57267 },
      { sum: 7631, chunks: 9, stored: 7639 },
    ];
    for (const o of observed) {
      const each = Math.floor(o.sum / o.chunks);
      const rows = Array.from({ length: o.chunks }, (_, i) =>
        ({ text: "x".repeat(i === 0 ? o.sum - each * (o.chunks - 1) : each) }));
      expect(rows.reduce((n, r) => n + r.text.length, 0)).toBe(o.sum);
      expect(chunkText(rows).length).toBe(o.stored);
    }
  });

  it("treats a null chunk as empty rather than dropping its boundary", () => {
    expect(chunkText([{ text: "a" }, { text: null }, { text: "b" }])).toBe("a\n\nb");
  });

  it("gives one chunk no trailing separator", () => {
    expect(chunkText([{ text: "only" }])).toBe("only");
    expect(chunkText([])).toBe("");
  });
});
