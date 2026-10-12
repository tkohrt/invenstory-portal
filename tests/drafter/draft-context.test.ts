import { describe, expect, it } from "vitest";
import {
  addRefusal, contextFileKind, contextNotes, contextTitle, keepText, MAX_ITEM_CHARS, MAX_ITEMS_PER_PART, parsePart, wordCount,
} from "@/lib/draft-context";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("the grant context box (Auto-Draft patch 5)", () => {
  it("knows the two parts and nothing else", () => {
    expect(parsePart("funder")).toBe("funder");
    expect(parsePart("client")).toBe("client");
    expect(parsePart("Funder")).toBeNull();
    expect(parsePart(undefined)).toBeNull();
  });

  describe("what kind of file an upload is", () => {
    it("reads PDF and Word by their first bytes", () => {
      expect(contextFileKind("faq.pdf", bytes("%PDF-1.7"))).toBe("pdf");
      expect(contextFileKind("renamed.docx", bytes("%PDF-1.4"))).toBe("pdf");
      expect(contextFileKind("about.docx", new Uint8Array([0x50, 0x4b, 3, 4]))).toBe("docx");
    });
    it("takes a .txt file that is really text", () => {
      expect(contextFileKind("notes.txt", bytes("Lead with the summer program."))).toBe("txt");
    });
    it("refuses a binary file renamed .txt, a zip that is not .docx, and anything else", () => {
      expect(contextFileKind("sneaky.txt", new Uint8Array([0x41, 0, 0x42]))).toBeNull();
      expect(contextFileKind("archive.zip", new Uint8Array([0x50, 0x4b, 3, 4]))).toBeNull();
      expect(contextFileKind("image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    });
  });

  describe("an item's title", () => {
    it("uses the one given, tidied", () => {
      expect(contextTitle({ title: "  Gund   FAQ ", filename: "x.pdf" })).toBe("Gund FAQ");
    });
    it("falls back to the file name without its extension", () => {
      expect(contextTitle({ filename: "Gund_Foundation-FAQ.pdf" })).toBe("Gund Foundation FAQ");
    });
    it("falls back to the web address", () => {
      expect(contextTitle({ url: "https://www.gundfoundation.org/about/" })).toBe("gundfoundation.org/about");
      expect(contextTitle({ url: "https://kresge.org" })).toBe("kresge.org");
    });
    it("falls back to the text's first line, shortened at a word", () => {
      expect(contextTitle({ text: "\n\nLead with the summer program.\nThen the library." })).toBe("Lead with the summer program.");
      const long = contextTitle({ text: "The client would like us to lead with the summer program and mention the library partnership first" });
      expect(long.endsWith("…")).toBe(true);
      expect(long.length).toBeLessThanOrEqual(58);
    });
    it("is Untitled when there is nothing to go on", () => {
      expect(contextTitle({})).toBe("Untitled");
    });
  });

  it("keeps text up to the limit and says when it cut", () => {
    expect(keepText("short")).toEqual({ text: "short", cut: false });
    const k = keepText("x".repeat(MAX_ITEM_CHARS + 10));
    expect(k.cut).toBe(true);
    expect(k.text.length).toBe(MAX_ITEM_CHARS);
  });

  it("counts words", () => {
    expect(wordCount("  one two\nthree ")).toBe(3);
    expect(wordCount("   ")).toBe(0);
  });

  it("refuses another item once a part is full", () => {
    expect(addRefusal(MAX_ITEMS_PER_PART - 1)).toBeNull();
    expect(addRefusal(MAX_ITEMS_PER_PART)).toMatch(/Remove one/);
  });

  it("says which parts are empty, for the Auto-draft confirm window", () => {
    expect(contextNotes([])).toEqual({ funder: "missing", client: "missing" });
    expect(contextNotes([{ part: "client" }])).toEqual({ funder: "missing", client: null });
    expect(contextNotes([{ part: "funder" }, { part: "client" }])).toEqual({ funder: null, client: null });
  });
});
