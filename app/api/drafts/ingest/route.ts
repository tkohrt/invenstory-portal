// Bring a funder's application into the portal as a card-mode draft.
//
// Four ways in, in order of reliability (spec section 6): pasted text, an
// uploaded PDF or Word file, a web address, and a Funder Matches row, which
// pre-fills the funder and deadline and still needs the questions from one of
// the other three.
//
// The funder's text is stored on the draft (grant_draft.source_text) and is
// NOT filed into the Inven(s)tory: it is the funder's material, not the
// client's story, and card extraction must never mistake it for evidence.
//
// Admin-only, like the rest of the drafter (Decision 1).
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import {
  pdfToText, docxToText, htmlToText, looksLikeLoginWall, fetchableUrl, uploadKind, tidyText, MAX_SOURCE_CHARS,
} from "@/lib/application-text";

export const maxDuration = 60;

/** Vercel refuses request bodies over 4.5 MB before this code runs. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_FETCH_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

class Plain extends Error {}

/** The original file, kept with the draft so For Granted can open it later (patch 2, 6 October 2026). */
interface Original { bytes: Uint8Array; mime: string; name: string }

async function fromUrl(raw: string): Promise<{ text: string; url: string; kind: "url"; original?: Original }> {
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
    throw new Plain("That page did not respond in time. Paste the questions instead.");
  }
  if (!res.ok) {
    throw new Plain(res.status === 401 || res.status === 403
      ? "That page needs a sign-in. Open it yourself and paste the questions instead."
      : `That page answered with an error (${res.status}). Paste the questions instead.`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_FETCH_BYTES) throw new Plain("That file is too large to read from a link. Paste the questions instead.");
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const base = (check.url.pathname.split("/").pop() || "application").slice(0, 120);
  if (type.includes("pdf") || uploadKind(check.url.pathname, buf) === "pdf") {
    return { text: await pdfToText(buf), url: res.url || check.url.href, kind: "url",
      original: { bytes: buf, mime: "application/pdf", name: /\.pdf$/i.test(base) ? base : `${base}.pdf` } };
  }
  if (type.includes("officedocument.wordprocessingml") || uploadKind(check.url.pathname, buf) === "docx") {
    return { text: await docxToText(buf), url: res.url || check.url.href, kind: "url",
      original: { bytes: buf, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: /\.docx$/i.test(base) ? base : `${base}.docx` } };
  }
  const body = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const text = type.includes("html") || /<html|<body|<p[\s>]/i.test(body.slice(0, 5000)) ? htmlToText(body) : tidyText(body);
  if (looksLikeLoginWall(body, text)) {
    throw new Plain("That page is a sign-in screen, so the questions are behind a login. Open it yourself and paste the questions instead.");
  }
  if (text.split(/\s+/).length < 40) {
    throw new Plain("That page has almost no readable text (it may be built in JavaScript). Paste the questions instead.");
  }
  return { text, url: res.url || check.url.href, kind: "url" };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "admin required" }, { status: 403 });
  const tenantId = session.tenantId;

  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ error: "That upload could not be read. Files over 4 MB are refused; paste the questions instead." }, { status: 400 });
  }
  const field = (k: string) => { const v = form.get(k); return typeof v === "string" ? v.trim() : ""; };

  try {
    const source = field("source");
    let text = "", kind: "paste" | "pdf" | "docx" | "url", url: string | null = null, filename: string | null = null;
    let original: Original | null = null;

    if (source === "paste") {
      text = tidyText(field("text"));
      kind = "paste";
    } else if (source === "file") {
      const f = form.get("file");
      if (!(f instanceof File) || f.size === 0) throw new Plain("Choose a PDF or Word file.");
      if (f.size > MAX_UPLOAD_BYTES) throw new Plain("That file is over 4 MB. Paste the questions instead.");
      const buf = new Uint8Array(await f.arrayBuffer());
      const k = uploadKind(f.name, buf);
      if (!k) throw new Plain("Only PDF and Word (.docx) files can be read. For anything else, paste the questions.");
      text = k === "pdf" ? await pdfToText(buf) : await docxToText(buf);
      kind = k; filename = f.name.slice(0, 200);
      original = { bytes: buf, mime: k === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: filename };
    } else if (source === "url") {
      const r = await fromUrl(field("url"));
      text = r.text; kind = "url"; url = r.url; original = r.original ?? null;
    } else {
      throw new Plain("Choose where the application comes from.");
    }

    if (text.length < 40) throw new Plain("There is not enough text there to hold an application's questions.");
    if (text.length > MAX_SOURCE_CHARS) text = text.slice(0, MAX_SOURCE_CHARS);

    // From Funder Matches: re-read the row server-side rather than trusting the
    // form, so a draft can only point at this client's own match.
    let opportunity_ref: Record<string, string> | null = null;
    const grantId = field("grantId"), funderId = field("funderId");
    if (grantId) {
      const { data } = await db.from("eligible_grant").select("grant_id").eq("tenant_id", tenantId).eq("grant_id", grantId).maybeSingle();
      if (data) opportunity_ref = { grant_id: grantId };
    } else if (funderId) {
      const { data } = await db.from("matched_funder").select("funder_id").eq("tenant_id", tenantId).eq("funder_id", funderId).maybeSingle();
      if (data) opportunity_ref = { funder_id: funderId };
    }

    const amount = field("amountDollars").replace(/[$,\s]/g, "");
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(field("deadline")) ? field("deadline") : null;
    const title = field("title") || (filename ? filename.replace(/\.(pdf|docx)$/i, "") : "") || "Untitled application";

    const { data, error } = await db.from("grant_draft").insert({
      tenant_id: tenantId, title: title.slice(0, 200), funder: field("funder").slice(0, 200) || null,
      amount_cents: amount && Number.isFinite(Number(amount)) ? Math.round(Number(amount) * 100) : null,
      deadline, body: "", created_by: session.user.id,
      mode: "cards", source_kind: kind, source_url: url ?? (field("sourceUrl") || null),
      source_text: text, source_filename: filename, opportunity_ref,
    }).select("id").single();
    if (error || !data) throw new Error(`Could not create the draft: ${error?.message ?? "no row returned"}`);

    const draftId = (data as { id: string }).id;
    // Keep the original file. Best-effort: the draft stands on its text either way.
    if (original) {
      try {
        const safe = original.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "application";
        const key = `${tenantId}/applications/${draftId}/${safe}`;
        const { error: upErr } = await db.storage.from("documents").upload(key, original.bytes, { contentType: original.mime, upsert: true });
        if (upErr) throw upErr;
        await db.from("grant_draft").update({ source_storage_key: key, source_mime: original.mime }).eq("tenant_id", tenantId).eq("id", draftId);
      } catch (e) {
        console.error("[drafts/ingest] original file not kept", e instanceof Error ? e.message : e);
      }
    }

    await db.from("audit_log").insert({
      actor_user_id: session.user.id, tenant_id: tenantId, action: "draft_from_application",
      detail: `${title.slice(0, 120)} (${kind}, ${text.length} chars)`,
    });
    return NextResponse.json({ id: draftId, chars: text.length });
  } catch (e) {
    if (e instanceof Plain) return NextResponse.json({ error: e.message }, { status: 400 });
    // Extraction errors from pdfToText/docxToText are written for people already.
    const msg = e instanceof Error ? e.message : "Could not bring that application in.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
