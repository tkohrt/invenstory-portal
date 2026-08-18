"use server";
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { processDocument } from "./ingest";
import { CHECKLIST } from "@/lib/checklist";

// Client (or admin) types content about a checklist topic; it is filed into the
// Inven(s)tory as a tagged note at the item's layer and indexed like any upload.
export async function addInvenstoryNoteAction(itemKey: string, text: string) {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const item = CHECKLIST.find(i => i.key === itemKey);
  if (!item) throw new Error("unknown checklist item");
  const clean = (text ?? "").trim();
  if (clean.length < 10) throw new Error("Please write a bit more.");

  const docId = crypto.randomUUID();
  const storageKey = `${s.tenantId}/${docId}/1`;
  const content = `${item.label} — written by the organization:\n\n${clean}`;
  await db.storage.from("documents").upload(storageKey, Buffer.from(content, "utf8"), { contentType: "text/plain" });
  await db.from("document").insert({
    id: docId, tenant_id: s.tenantId, title: `Note: ${item.label}`, layer: item.layer,
    storage_key: storageKey, mime_type: "text/plain", doc_kind: "note", status: "pending",
    uploaded_by: s.user.id, source: s.role === "admin" ? "for_granted" : "client",
  });
  await db.from("document_version").insert({ document_id: docId, tenant_id: s.tenantId, version: 1, storage_key: storageKey, uploaded_by: s.user.id });
  await db.from("document_tag").insert([
    { document_id: docId, tenant_id: s.tenantId, tag: item.key },
    { document_id: docId, tenant_id: s.tenantId, tag: "written-note" },
  ]);
  try { await processDocument(docId); } catch { /* status recorded; still filed */ }
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "invenstory_note", detail: item.key });
  revalidatePath("/funding-eligibility"); revalidatePath("/invenstory");
  return { ok: true };
}
