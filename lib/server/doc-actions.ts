"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { userClient } from "./supabase";
import { db } from "./db";

// Edit a document's tags. userClient enforces RLS (caller's tenant only); the
// tag rows are replaced to match the submitted set.
export async function updateDocTagsAction(documentId: string, tags: string[]) {
  const session = await getSession();
  if (!session) throw new Error("unauthorized");
  const supabase = await userClient();
  // Ownership check via RLS: only returns the doc if it's in the caller's tenant.
  const { data: doc } = await supabase.from("document").select("id, tenant_id").eq("id", documentId).single();
  if (!doc) throw new Error("not found");
  const clean = [...new Set(tags.map(t => t.trim()).filter(Boolean))].slice(0, 20);
  // Replace tag set (service client scoped to the verified doc's tenant).
  await db.from("document_tag").delete().eq("document_id", documentId).eq("tenant_id", doc.tenant_id);
  if (clean.length) await db.from("document_tag").insert(clean.map(tag => ({ document_id: documentId, tenant_id: doc.tenant_id, tag })));
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "edit_tags", detail: `${documentId} -> [${clean.join(", ")}]` });
  revalidatePath("/invenstory"); revalidatePath("/search");
}

// Rename a document (RLS-verified: caller's tenant only).
export async function renameDocAction(documentId: string, title: string) {
  const session = await getSession();
  if (!session) throw new Error("unauthorized");
  const clean = title.trim().slice(0, 200);
  if (!clean) throw new Error("title required");
  const supabase = await userClient();
  const { data: doc } = await supabase.from("document").select("id, tenant_id").eq("id", documentId).single();
  if (!doc) throw new Error("not found");
  await db.from("document").update({ title: clean }).eq("id", documentId).eq("tenant_id", doc.tenant_id);
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "rename_doc", detail: `${documentId} -> ${clean}` });
  revalidatePath("/invenstory"); revalidatePath("/search");
}

// Reprocess a document through ingestion (clears stale failures after a fix).
// Returns the reason rather than throwing it. In production Next.js replaces the
// message of an error thrown from a server action with a generic one, so a
// scanned PDF surfaced as "Minified React error #441" instead of saying it has
// no text to read (30 September 2026, Hope Town's 990).
export async function reprocessDocAction(documentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "You are signed out. Sign in and try again." };
  const supabase = await userClient();
  const { data: doc } = await supabase.from("document").select("id, tenant_id").eq("id", documentId).single();
  if (!doc) return { ok: false, error: "That document no longer exists." };
  // A client can process documents again 5 times a day; admins without limit.
  const actor = session.role === "admin" ? "admin" as const : "client" as const;
  const { clientActionsLastDay } = await import("./ai-usage");
  const { decideReprocess } = await import("@/lib/usage-limits");
  const gate = decideReprocess(actor, actor === "admin" ? 0 : await clientActionsLastDay(doc.tenant_id, "reprocess_doc"));
  if (!gate.ok) return { ok: false, error: gate.message };
  const { processDocument } = await import("./ingest");
  let failure: string | null = null;
  try { await processDocument(documentId, { actor, reprocess: true }); }
  catch (e) { failure = e instanceof Error ? e.message : "Reading the document failed."; }
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "reprocess_doc", detail: documentId });
  revalidatePath("/invenstory"); revalidatePath("/search");
  return failure ? { ok: false, error: failure } : { ok: true };
}

// Delete a document entirely: storage object + DB row (cascades chunks,
// embeddings, tags, versions).
export async function deleteDocAction(documentId: string) {
  const session = await getSession();
  if (!session) throw new Error("unauthorized");
  const supabase = await userClient();
  const { data: doc } = await supabase.from("document").select("id, tenant_id, storage_key").eq("id", documentId).single();
  if (!doc) throw new Error("not found");
  // remove all stored versions under this doc's folder
  const folder = doc.storage_key.split("/").slice(0, 2).join("/");
  const { data: objs } = await db.storage.from("documents").list(folder);
  if (objs?.length) await db.storage.from("documents").remove(objs.map(o => `${folder}/${o.name}`));
  // delete the row (cascades chunks/embeddings/tags/versions)
  await db.from("document").delete().eq("id", documentId).eq("tenant_id", doc.tenant_id);
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "delete_doc", detail: documentId });
  revalidatePath("/invenstory"); revalidatePath("/search");
}

// Move a document to a different Inven(s)tory layer (drag-and-drop or drawer
// edit). RLS-verified: caller's tenant only.
export async function changeDocLayerAction(documentId: string, layer: "I" | "II" | "III") {
  const session = await getSession();
  if (!session) throw new Error("unauthorized");
  if (!["I", "II", "III"].includes(layer)) throw new Error("invalid layer");
  const supabase = await userClient();
  const { data: doc } = await supabase.from("document").select("id, tenant_id, layer").eq("id", documentId).single();
  if (!doc) throw new Error("not found");
  if (doc.layer === layer) return;
  await db.from("document").update({ layer, updated_at: new Date().toISOString() }).eq("id", documentId).eq("tenant_id", doc.tenant_id);
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "change_layer", detail: `${documentId}: ${doc.layer} -> ${layer}` });
  revalidatePath("/invenstory"); revalidatePath("/search");
}

/**
 * Finish a document's semantic index: embed only the passages that have no
 * vector yet, for up to about 45 seconds. The drawer calls it again until
 * nothing is left, so a long document finishes in a few presses at most and
 * never re-reads or re-chunks anything.
 */
export async function finishIndexingAction(documentId: string): Promise<{ ok: true; missing: number; total: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "You are signed out. Sign in and try again." };
  const supabase = await userClient();
  const { data: doc } = await supabase.from("document").select("id, tenant_id, status").eq("id", documentId).single();
  if (!doc) return { ok: false, error: "That document no longer exists." };
  if (doc.status !== "ready") return { ok: false, error: "This document has not finished reading yet. Reprocess it first." };
  const { indexMissingEmbeddings, INDEX_PENDING } = await import("./ingest");
  try {
    const { missing, total } = await indexMissingEmbeddings(documentId, doc.tenant_id, Date.now() + 45_000);
    await db.from("document").update({
      error_detail: missing > 0 ? `${INDEX_PENDING}: ${missing} of ${total} passages not yet embedded` : null,
    }).eq("id", documentId).eq("tenant_id", doc.tenant_id);
    revalidatePath("/invenstory"); revalidatePath("/search");
    return { ok: true, missing, total };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Indexing failed. Try again." };
  }
}

/**
 * A web link added from the portal's unified upload panel (P1.5, patch 38).
 * Same shape and same 20-a-day budget as onboarding's addSetupLinkAction
 * (shared audit action "setup_link", so the two paths spend one allowance),
 * but open after setup is complete and to admins working a client's account.
 */
export async function addPortalLinkAction(url: string, layer: "I" | "II"): Promise<{ ok: true; message?: string } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "You are signed out. Sign in and try again." };
  const { cleanWebsite } = await import("@/lib/setup");
  const clean = cleanWebsite(url);
  if (!clean) return { ok: false, error: "That does not look like a web address." };
  const { count } = await db.from("audit_log").select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId).eq("action", "setup_link").gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if ((count ?? 0) >= 20) return { ok: false, error: "That is a lot of links for one day. Upload the pages as files, or add more tomorrow." };
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "setup_link", detail: clean.slice(0, 300) });
  const { addWebDocument } = await import("./setup");
  const r = await addWebDocument({ tenantId: session.tenantId, userId: session.user.id, role: session.role, url: clean, layer });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/invenstory");
  return { ok: true, message: r.title };
}
