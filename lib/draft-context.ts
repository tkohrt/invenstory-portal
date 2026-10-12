// The grant context box (Auto-Draft build spec, section 4a; 12 October 2026).
// Pure; tested in tests/drafter/draft-context.test.ts.
//
// Each draft has two parts of context, each holding any number of items:
//   funder  the funder's overview, FAQ, website, About page, mission, priorities;
//   client  anything the client has said that should shape this application.
// An item is typed or pasted text, a PDF, a Word file (.docx), a .txt file, or
// a web address, read into text the same way the funder's application is
// (lib/application-text.ts). Every part is optional. Auto-draft reads it (a
// later patch); it is never filed into the client's Inven(s)tory. Reading an
// upload costs no AI, so no allowance is touched.

export type ContextPart = "funder" | "client";
export type ContextSourceKind = "text" | "pdf" | "docx" | "txt" | "url";

export const CONTEXT_PARTS: { key: ContextPart; label: string; describe: string; placeholder: string }[] = [
  {
    key: "funder", label: "Funder context",
    describe: "The funder's overview, FAQ, website, About page, mission and priorities.",
    placeholder: "Paste the funder's priorities, FAQ or About page, or a few lines on what they care about.",
  },
  {
    key: "client", label: "Client context",
    describe: "Anything the client has said that should shape this application: which program to lead with, a partner to mention, what to avoid, a recent change.",
    placeholder: "e.g. Lead with the summer program, mention the partnership with the library, avoid the 2023 pilot.",
  },
];

export const CONTEXT_PART_LABEL: Record<ContextPart, string> = { funder: "Funder context", client: "Client context" };

export const CONTEXT_KIND_LABEL: Record<ContextSourceKind, string> = {
  text: "Typed text", pdf: "PDF", docx: "Word", txt: "Text file", url: "Web page",
};

/** The most text one item keeps: roughly 35 dense pages. Longer text is cut, and the item says so. */
export const MAX_ITEM_CHARS = 100_000;
/** At most this many items in each part of one draft. */
export const MAX_ITEMS_PER_PART = 20;
/** Uploads go through a Vercel function, which refuses bodies over 4.5 MB. */
export const MAX_CONTEXT_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_TITLE_CHARS = 160;
/** The least text worth keeping as an item. */
export const MIN_ITEM_CHARS = 3;

export function parsePart(v: unknown): ContextPart | null {
  return v === "funder" || v === "client" ? v : null;
}

/**
 * What kind of file an upload is: PDF and Word by their first bytes (as the
 * application upload does), a .txt file by its name and by holding no NUL
 * byte, so a binary file renamed .txt is refused.
 */
export function contextFileKind(filename: string, head: Uint8Array): "pdf" | "docx" | "txt" | null {
  const n = filename.toLowerCase();
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";   // %PDF
  if (head[0] === 0x50 && head[1] === 0x4b && n.endsWith(".docx")) return "docx";                   // PK, a .docx
  if (n.endsWith(".txt") && !head.subarray(0, 8192).includes(0)) return "txt";
  return null;
}

/** An item's title: the one given, else from the file name, the web address, or the text's first line. */
export function contextTitle(input: { title?: string | null; filename?: string | null; url?: string | null; text?: string | null }): string {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const given = clean(input.title ?? "");
  if (given) return given.slice(0, MAX_TITLE_CHARS);
  if (input.filename) {
    const f = clean(input.filename.replace(/\.(pdf|docx|txt)$/i, "").replace(/[_-]+/g, " "));
    if (f) return f.slice(0, MAX_TITLE_CHARS);
  }
  if (input.url) {
    try {
      const u = new URL(input.url);
      const path = u.pathname.replace(/\/+$/, "");
      return `${u.hostname.replace(/^www\./, "")}${path && path !== "/" ? path : ""}`.slice(0, MAX_TITLE_CHARS);
    } catch { /* fall through */ }
  }
  const first = clean((input.text ?? "").split("\n").find(l => l.trim()) ?? "");
  if (first) return first.length > 60 ? `${first.slice(0, 57).replace(/\s+\S*$/, "")}…` : first;
  return "Untitled";
}

/** Text as kept: cut to the limit, with whether it was cut. */
export function keepText(text: string): { text: string; cut: boolean } {
  return text.length > MAX_ITEM_CHARS ? { text: text.slice(0, MAX_ITEM_CHARS), cut: true } : { text, cut: false };
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Why another item cannot be added to this part, or null. */
export function addRefusal(existingInPart: number): string | null {
  return existingInPart >= MAX_ITEMS_PER_PART
    ? `This part already holds ${MAX_ITEMS_PER_PART} items. Remove one before adding another.`
    : null;
}

/**
 * What the Auto-draft confirm window should say about the context (spec 4a):
 * a clear warning when Funder context is empty, a quieter note when Client
 * context is empty. Patch 6 shows it; the rule lives here with the box.
 */
export function contextNotes(items: { part: ContextPart }[]): { funder: "missing" | null; client: "missing" | null } {
  return {
    funder: items.some(i => i.part === "funder") ? null : "missing",
    client: items.some(i => i.part === "client") ? null : "missing",
  };
}
