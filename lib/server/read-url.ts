import "server-only";
// Reading a public web address into text, for the funder's application
// (/api/drafts/ingest) and for the grant context box (/api/drafts/context).
// One reader, so both get the same link safety (fetchableUrl), the same size
// and time limits, and the same honest failures. Moved here from the ingest
// route on 12 October 2026 (Auto-Draft patch 5); behaviour unchanged.
import {
  pdfToText, docxToText, htmlToText, looksLikeLoginWall, fetchableUrl, uploadKind, tidyText,
} from "@/lib/application-text";

const MAX_FETCH_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

/** A failure written for the person, to show as it is. */
export class Plain extends Error {}

/** The original file, kept beside what was read so it can be opened later. */
export interface Original { bytes: Uint8Array; mime: string; name: string }

/**
 * Fetch a web address and read it. `instead` finishes each failure with what
 * to do instead, e.g. "Paste the questions instead."
 */
export async function readUrl(raw: string, instead: string): Promise<{ text: string; url: string; original?: Original }> {
  const check = fetchableUrl(raw);
  if (!check.ok) throw new Plain(check.reason);
  let res: Response;
  try {
    res = await fetch(check.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "ForGrantedPortal/1.0 (grant application reader; +https://forgranted.com)", accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5" },
    });
  } catch {
    throw new Plain(`That page did not respond in time. ${instead}`);
  }
  if (!res.ok) {
    throw new Plain(res.status === 401 || res.status === 403
      ? `That page needs a sign-in. Open it yourself and ${instead.charAt(0).toLowerCase()}${instead.slice(1)}`
      : `That page answered with an error (${res.status}). ${instead}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_FETCH_BYTES) throw new Plain(`That file is too large to read from a link. ${instead}`);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const base = (check.url.pathname.split("/").pop() || "page").slice(0, 120);
  if (type.includes("pdf") || uploadKind(check.url.pathname, buf) === "pdf") {
    return { text: await pdfToText(buf), url: res.url || check.url.href,
      original: { bytes: buf, mime: "application/pdf", name: /\.pdf$/i.test(base) ? base : `${base}.pdf` } };
  }
  if (type.includes("officedocument.wordprocessingml") || uploadKind(check.url.pathname, buf) === "docx") {
    return { text: await docxToText(buf), url: res.url || check.url.href,
      original: { bytes: buf, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: /\.docx$/i.test(base) ? base : `${base}.docx` } };
  }
  const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const text = type.includes("html") || /<html|<body|<p[\s>]/i.test(body.slice(0, 5000)) ? htmlToText(body) : tidyText(body);
  if (looksLikeLoginWall(body, text)) {
    throw new Plain(`That page is a sign-in screen, so what it holds is behind a login. Open it yourself and ${instead.charAt(0).toLowerCase()}${instead.slice(1)}`);
  }
  if (text.split(/\s+/).length < 40) {
    throw new Plain(`That page has almost no readable text (it may be built in JavaScript). ${instead}`);
  }
  return { text, url: res.url || check.url.href };
}
