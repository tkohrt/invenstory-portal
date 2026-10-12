// Add one item to a draft's grant context box (Auto-Draft patch 5, spec 4a).
//
// Typed or pasted text, a PDF, a Word file, a .txt file, or a web address,
// read into text with the same readers and the same link safety the funder's
// application uses. The original file is kept beside it in storage, under the
// client's folder. Nothing is filed into the Inven(s)tory, and no AI runs.
//
// Access follows the draft: a draft the person can open through RLS, not
// locked (draftForContext). A route rather than a server action because it
// takes uploads.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { draftForContext } from "@/lib/server/draft-context";
import { Plain, readUrl, type Original } from "@/lib/server/read-url";
import { pdfToText, docxToText, tidyText } from "@/lib/application-text";
import {
  addRefusal, contextFileKind, contextTitle, keepText, parsePart, MAX_CONTEXT_UPLOAD_BYTES, MIN_ITEM_CHARS,
  type ContextSourceKind,
} from "@/lib/draft-context";

export const maxDuration = 60;

const MIME: Record<"pdf" | "docx" | "txt", string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const tenantId = session.tenantId;

  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ error: "That upload could not be read. Files over 4 MB are refused; paste the text instead." }, { status: 400 });
  }
  const field = (k: string) => { const v = form.get(k); return typeof v === "string" ? v.trim() : ""; };

  try {
    const d = await draftForContext(tenantId, field("draftId"), true);
    if (!d.ok) throw new Plain(d.error);
    const draftId = d.draft.id;
    const part = parsePart(field("part"));
    if (!part) throw new Plain("Choose Funder context or Client context.");
    const { count } = await db.from("draft_context").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("draft_id", draftId).eq("part", part);
    const full = addRefusal(count ?? 0);
    if (full) throw new Plain(full);

    const source = field("source");
    let text = "", kind: ContextSourceKind, url: string | null = null, filename: string | null = null;
    let original: Original | null = null;
    if (source === "text") {
      text = tidyText(field("text"));
      kind = "text";
    } else if (source === "file") {
      const f = form.get("file");
      if (!(f instanceof File) || f.size === 0) throw new Plain("Choose a PDF, Word (.docx) or .txt file.");
      if (f.size > MAX_CONTEXT_UPLOAD_BYTES) throw new Plain("That file is over 4 MB. Paste the text instead.");
      const buf = new Uint8Array(await f.arrayBuffer());
      const k = contextFileKind(f.name, buf);
      if (!k) throw new Plain("Only PDF, Word (.docx) and .txt files can be read. For anything else, paste the text.");
      text = k === "pdf" ? await pdfToText(buf) : k === "docx" ? await docxToText(buf) : tidyText(new TextDecoder("utf-8", { fatal: false }).decode(buf));
      kind = k; filename = f.name.slice(0, 200);
      original = { bytes: buf, mime: MIME[k], name: filename };
    } else if (source === "url") {
      const r = await readUrl(field("url"), "Paste the text instead.");
      text = r.text; kind = "url"; url = r.url; original = r.original ?? null;
    } else {
      throw new Plain("Choose typed text, a file or a web address.");
    }
    if (text.length < MIN_ITEM_CHARS) throw new Plain("There is no text there to keep.");
    const kept = keepText(text);
    const title = contextTitle({ title: field("title"), filename, url, text: kept.text });

    const { data, error } = await db.from("draft_context").insert({
      tenant_id: tenantId, draft_id: draftId, part, title, body: kept.text, source_kind: kind, source_url: url,
      added_by: session.user.id,
    }).select("id").single();
    if (error || !data) throw new Error(error?.message.includes("draft_context") ? "The grant context box needs migration 0063." : "That item could not be saved.");
    const id = (data as { id: string }).id;

    // Keep the original file. Best-effort: the item stands on its text either way.
    if (original) {
      try {
        const safe = original.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "context";
        const key = `${tenantId}/drafts/${draftId}/context/${id}-${safe}`;
        const { error: upErr } = await db.storage.from("documents").upload(key, original.bytes, { contentType: original.mime, upsert: true });
        if (upErr) throw upErr;
        await db.from("draft_context").update({ storage_key: key, file_type: original.mime }).eq("tenant_id", tenantId).eq("id", id);
      } catch (e) {
        console.error("[drafts/context] original file not kept", e instanceof Error ? e.message : e);
      }
    }
    await db.from("audit_log").insert({
      actor_user_id: session.user.id, tenant_id: tenantId, action: "draft_context_added",
      detail: `${draftId}: ${part}, ${kind}, ${kept.text.length} chars${kept.cut ? " (cut)" : ""}`,
    });
    return NextResponse.json({ id, title, cut: kept.cut });
  } catch (e) {
    if (e instanceof Plain) return NextResponse.json({ error: e.message }, { status: 400 });
    // Extraction errors from pdfToText/docxToText are written for people already.
    const msg = e instanceof Error ? e.message.replace("Paste the questions instead.", "Paste the text instead.") : "Could not add that.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
