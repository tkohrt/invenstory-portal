import "server-only";
// Reading a public web address into text, for the funder's application
// (/api/drafts/ingest) and for the grant context box (/api/drafts/context).
// One reader, so both get the same link safety (fetchableUrl), the same size
// and time limits, and the same honest failures. Moved here from the ingest
// route on 12 October 2026 (Auto-Draft patch 5); behaviour unchanged.
import {
  pdfToText, docxToText, htmlToText, looksLikeLoginWall, fetchableUrl, uploadKind, tidyText,
} from "@/lib/application-text";

import { lookup } from "node:dns/promises";

const MAX_FETCH_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** A private, loopback or link-local address, which a public page never needs. */
function privateIp(ip: string): boolean {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const h = ip.toLowerCase();
  return h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
}

/**
 * Every hop is checked (3 Nov 2026, review of patch 14): the address as
 * typed, every redirect, and what each name resolves to, so a public page
 * that redirects or resolves to an internal address is refused.
 */
async function checkedHop(raw: string): Promise<URL> {
  const check = fetchableUrl(raw);
  if (!check.ok) throw new Plain(check.reason);
  let addrs: { address: string }[];
  try { addrs = await lookup(check.url.hostname.replace(/^\[|\]$/g, ""), { all: true }); }
  catch { throw new Plain("That website could not be found. Check the address."); }
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Plain("That address is not a public website.");
  return check.url;
}
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
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let at = await checkedHop(raw);
  const check = { url: at };
  let res: Response;
  for (let hop = 0; ; hop++) {
    try {
      res = await fetch(at, {
        redirect: "manual", signal,
        headers: { "user-agent": "ForGrantedPortal/1.0 (grant application reader; +https://forgranted.com)", accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5" },
      });
    } catch {
      throw new Plain(`That page did not respond in time. ${instead}`);
    }
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) break;
    if (hop >= MAX_REDIRECTS) throw new Plain(`That page redirects too many times. ${instead}`);
    at = await checkedHop(new URL(loc, at).toString());
    check.url = at;
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
