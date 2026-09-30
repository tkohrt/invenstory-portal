// Turning a funder's application into text: PDF, Word, a web page.
//
// Separate from lib/server/ingest.ts on purpose. Ingest files a document into a
// client's Inven(s)tory (chunks, embeddings, readiness); a funder's application
// must never go there, because it is the funder's words and not the client's
// story. This only reads it.
//
// Free of `server-only` so the real extraction libraries can be exercised in
// tests against real PDF and Word files.

/** The most text a funder's application may bring in: roughly 90 dense pages. */
export const MAX_SOURCE_CHARS = 250_000;

/** Collapse the whitespace extraction leaves behind, keeping paragraph breaks. */
export function tidyText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function pdfToText(buf: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const res = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(res.text) ? res.text : [res.text];
  const text = tidyText(pages.map(p => p ?? "").join("\n\n"));
  if (text.length < 20) {
    throw new Error("This PDF has no readable text, which usually means it is a scan. Paste the questions instead.");
  }
  return text;
}

export async function docxToText(buf: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
  const text = tidyText(res.value);
  if (text.length < 20) throw new Error("This Word file has no readable text. Paste the questions instead.");
  return text;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•",
};

/**
 * A web page's readable text.
 *
 * Deliberately simple: scripts, styles, navigation and footers removed, block
 * elements turned into line breaks, entities decoded. Application pages are
 * mostly headings, paragraphs and lists, which this keeps in order. It does not
 * try to be a browser, and a page that needs one (a portal behind a login, a
 * form built in JavaScript) is caught by looksLikeLoginWall and sent to paste.
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ");
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|dd|dt|label|fieldset|legend)>/gi, "\n")
    .replace(/<(h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, " \t ")
    .replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return tidyText(s.split("\n").map(l => l.trim()).join("\n"));
}

/**
 * Whether a fetched page is a sign-in screen rather than an application.
 *
 * Many funder portals (Submittable, Foundant, Fluxx, SmartSimple) put the
 * questions behind a login. What comes back is a short page with a password
 * field. The honest answer is to say so and ask for a paste, not to parse a
 * login form into "questions".
 */
export function looksLikeLoginWall(html: string, text: string): boolean {
  const hasPassword = /<input[^>]+type\s*=\s*["']?password/i.test(html);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (hasPassword && words < 600) return true;
  if (words < 80 && /\b(sign in|log in|login|create an account|register)\b/i.test(text)) return true;
  return false;
}

/**
 * Whether a URL may be fetched from the server.
 *
 * Only http(s), no credentials in the URL, and never a local or private address
 * by name or literal IP. This is an admin-only feature, but a server that
 * fetches whatever it is given is a way into whatever the server can reach.
 * (A public name that resolves to a private address is not caught here; the
 * fetch runs on Vercel, where there is nothing private to reach.)
 */
export function fetchableUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, reason: "That is not a complete web address." }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only web addresses (http or https) can be fetched." };
  if (url.username || url.password) return { ok: false, reason: "Web addresses with a username or password in them cannot be fetched." };
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) {
    return { ok: false, reason: "That address is not a public website." };
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      return { ok: false, reason: "That address is not a public website." };
    }
  }
  if (h.includes(":") && (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:"))) {
    return { ok: false, reason: "That address is not a public website." };
  }
  return { ok: true, url };
}

/** What kind of file an upload is, by name first and content second. */
export function uploadKind(filename: string, head: Uint8Array): "pdf" | "docx" | null {
  const n = filename.toLowerCase();
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  const isZip = head[0] === 0x50 && head[1] === 0x4b;                                           // PK
  if (isPdf) return "pdf";
  if (isZip && n.endsWith(".docx")) return "docx";
  return null;
}
