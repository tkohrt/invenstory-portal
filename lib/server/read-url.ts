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
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";

const MAX_FETCH_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** A private, loopback, link-local or reserved address, which a public page never needs. */
function privateIp(ip: string): boolean {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
      // Reserved ranges the first pass missed (red-team M1, 9 Nov 2026):
      // benchmarking 198.18/15, IETF protocol 192.0.0/24, TEST-NET-1 192.0.2/24.
      || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && (c === 0 || c === 2))
      || a >= 224;
  }
  const h = ip.toLowerCase();
  return h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
}

/** A checked hop: the URL plus the exact address the check approved. */
interface Hop { url: URL; address: string; family: number }

/**
 * Every hop is checked (3 Nov 2026, review of patch 14): the address as
 * typed, every redirect, and what each name resolves to, so a public page
 * that redirects or resolves to an internal address is refused. Since the
 * red-team review (M1, 9 Nov 2026) the approved address is also the address
 * the request CONNECTS to (pinnedGet below), so a DNS answer that changes
 * between the check and the fetch (DNS rebinding) buys nothing; and only the
 * default web ports are allowed.
 */
async function checkedHop(raw: string): Promise<Hop> {
  const check = fetchableUrl(raw);
  if (!check.ok) throw new Plain(check.reason);
  if (check.url.port !== "" && check.url.port !== "80" && check.url.port !== "443") {
    throw new Plain("That address is not a public website.");
  }
  let addrs: { address: string; family: number }[];
  try { addrs = await lookup(check.url.hostname.replace(/^\[|\]$/g, ""), { all: true }); }
  catch { throw new Plain("That website could not be found. Check the address."); }
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Plain("That address is not a public website.");
  return { url: check.url, address: addrs[0].address, family: addrs[0].family };
}

class TooLarge extends Error {}

/**
 * One GET, connected to the exact address checkedHop approved (the `lookup`
 * option pins the socket; TLS still verifies against the hostname). Redirects
 * are not followed here; readUrl re-checks each hop. Compression is declined
 * (accept-encoding: identity) because this path decodes the raw bytes itself.
 */
function pinnedGet(hop: Hop, signal: AbortSignal): Promise<{ status: number; location: string | null; contentType: string; body: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const mod = hop.url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = mod(hop.url, {
      method: "GET",
      signal,
      lookup: (_host, _opts, cb) => (cb as (e: null, a: string, f: number) => void)(null, hop.address, hop.family),
      headers: {
        "user-agent": "ForGrantedPortal/1.0 (grant application reader; +https://forgranted.com)",
        accept: "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5",
        "accept-encoding": "identity",
      },
    }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_FETCH_BYTES) { req.destroy(); reject(new TooLarge()); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        location: res.statusCode && res.statusCode >= 300 && res.statusCode < 400 ? (res.headers.location ?? null) : null,
        contentType: (res.headers["content-type"] ?? "").toString(),
        body: new Uint8Array(Buffer.concat(chunks)),
      }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
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
  const check = { url: at.url };
  let res: Awaited<ReturnType<typeof pinnedGet>>;
  for (let hop = 0; ; hop++) {
    try {
      res = await pinnedGet(at, signal);
    } catch (e) {
      if (e instanceof TooLarge) throw new Plain(`That file is too large to read from a link. ${instead}`);
      throw new Plain(`That page did not respond in time. ${instead}`);
    }
    if (!res.location) break;
    if (hop >= MAX_REDIRECTS) throw new Plain(`That page redirects too many times. ${instead}`);
    at = await checkedHop(new URL(res.location, at.url).toString());
    check.url = at.url;
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Plain(res.status === 401 || res.status === 403
      ? `That page needs a sign-in. Open it yourself and ${instead.charAt(0).toLowerCase()}${instead.slice(1)}`
      : `That page answered with an error (${res.status}). ${instead}`);
  }
  const buf = res.body;
  const type = res.contentType.toLowerCase();
  const base = (check.url.pathname.split("/").pop() || "page").slice(0, 120);
  if (type.includes("pdf") || uploadKind(check.url.pathname, buf) === "pdf") {
    return { text: await pdfToText(buf), url: check.url.href,
      original: { bytes: buf, mime: "application/pdf", name: /\.pdf$/i.test(base) ? base : `${base}.pdf` } };
  }
  if (type.includes("officedocument.wordprocessingml") || uploadKind(check.url.pathname, buf) === "docx") {
    return { text: await docxToText(buf), url: check.url.href,
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
  return { text, url: check.url.href };
}
