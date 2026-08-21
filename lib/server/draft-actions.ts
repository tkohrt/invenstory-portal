"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { parseBrackets } from "./drafts";
import { processDocument } from "./ingest";
import { markStaleOnUpload } from "./artifacts";
import type { DraftStatus } from "@/lib/types";

async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

// Admin creates/updates a draft; brackets are (re)parsed from the body.
export async function saveDraftAction(input: {
  id?: string; title: string; funder: string; amountDollars: string; deadline: string; body: string;
}) {
  const s = await requireAdmin();
  const amount_cents = input.amountDollars ? Math.round(parseFloat(input.amountDollars) * 100) : null;
  const row = {
    tenant_id: s.tenantId, title: input.title, funder: input.funder || null,
    amount_cents, deadline: input.deadline || null, body: input.body, created_by: s.user.id,
  };
  let draftId = input.id;
  if (draftId) {
    await db.from("grant_draft").update(row).eq("id", draftId).eq("tenant_id", s.tenantId);
  } else {
    const { data } = await db.from("grant_draft").insert(row).select("id").single();  // tenant-safe: payload row includes tenant_id
    draftId = data?.id;
  }
  if (!draftId) throw new Error("save failed");
  // sync brackets with the body
  const labels = parseBrackets(input.body);
  const { data: existing } = await db.from("draft_bracket").select("id, label").eq("draft_id", draftId).eq("tenant_id", s.tenantId);
  const have = new Map((existing ?? []).map(b => [b.label, b.id]));
  // insert new labels
  const toInsert = labels.filter(l => !have.has(l)).map((label, i) => ({
    draft_id: draftId, tenant_id: s.tenantId, label, sort_order: i,
  }));
  if (toInsert.length) await db.from("draft_bracket").insert(toInsert);  // tenant-safe: payload includes tenant_id
  // remove brackets no longer present AND unanswered
  const gone = (existing ?? []).filter(b => !labels.includes(b.label));
  for (const g of gone) await db.from("draft_bracket").delete().eq("id", g.id).is("answer", null);  // tenant-safe: rows from tenant-scoped query above
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "draft_save", detail: input.title });
  revalidatePath("/drafts");
  return { id: draftId };
}

export async function setDraftStatusAction(draftId: string, status: DraftStatus, outcomeNote?: string) {
  const s = await requireAdmin();
  await db.from("grant_draft").update({ status, outcome_note: outcomeNote ?? null }).eq("id", draftId).eq("tenant_id", s.tenantId);
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "draft_status", detail: `${status}` });
  revalidatePath("/drafts");
}

// Client (or admin) answers a bracket -> the answer files back into the
// Inven(s)tory as a real, ingested Layer II document, and links to the bracket.
export async function answerBracketAction(draftId: string, bracketId: string, answer: string) {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const { data: bracket } = await db.from("draft_bracket").select("*").eq("id", bracketId).eq("tenant_id", s.tenantId).single();
  if (!bracket) throw new Error("bracket not found");
  // Bind the bracket to the claimed draft and scope the draft read to the
  // caller's tenant — never trust a client-supplied draftId (red-team H1).
  if (bracket.draft_id !== draftId) throw new Error("bracket/draft mismatch");
  const { data: draft } = await db.from("grant_draft").select("title").eq("id", draftId).eq("tenant_id", s.tenantId).single();
  if (!draft) throw new Error("draft not found");

  // File the answer into the Inven(s)tory (reuse the ingestion pipeline).
  const docId = crypto.randomUUID();
  const storageKey = `${s.tenantId}/${docId}/1`;
  const content = `Grant application answer — "${bracket.label}" (for ${draft?.title ?? "a draft"}):\n\n${answer}`;
  await db.storage.from("documents").upload(storageKey, Buffer.from(content, "utf8"), { contentType: "text/plain" });
  await db.from("document").insert({
    id: docId, tenant_id: s.tenantId, title: `Answer: ${bracket.label}`, layer: "II",
    storage_key: storageKey, mime_type: "text/plain", doc_kind: "note", status: "pending",
    uploaded_by: s.user.id, source: "client",
  });
  await db.from("document_version").insert({ document_id: docId, tenant_id: s.tenantId, version: 1, storage_key: storageKey, uploaded_by: s.user.id });
  await db.from("document_tag").insert([
    { document_id: docId, tenant_id: s.tenantId, tag: "grant-answer" },
    { document_id: docId, tenant_id: s.tenantId, tag: "captured" },
  ]);
  try { await processDocument(docId); } catch { /* failed status recorded; still linked */ }
  await markStaleOnUpload(s.tenantId); // new material -> SI stale

  await db.from("draft_bracket").update({  // tenant-safe: bracketId verified tenant-scoped above
    answer, answered_by: s.user.id, answered_at: new Date().toISOString(), filed_document_id: docId,
  }).eq("id", bracketId);
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "bracket_answer", detail: bracket.label });
  revalidatePath("/drafts");
}
