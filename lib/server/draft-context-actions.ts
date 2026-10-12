"use server";
// Changing the grant context box once a draft exists (Auto-Draft patch 5):
// rename an item, remove it, read its text, open its original file. Adding an
// item is a route (/api/drafts/context), because it takes uploads. Each action
// returns a reason rather than throwing it, so the page can show it.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { draftForContext, getDraftContext, type ContextItem } from "./draft-context";
import { MAX_TITLE_CHARS } from "@/lib/draft-context";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function itemFor(id: string, write: boolean): Promise<Result<{ tenantId: string; userId: string; row: { id: string; draft_id: string; title: string; body: string; storage_key: string | null; file_type: string | null } }>> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "That item could not be found." };
  const { data } = await db.from("draft_context").select("id, draft_id, title, body, storage_key, file_type")
    .eq("tenant_id", s.tenantId).eq("id", id).maybeSingle();
  const row = data as { id: string; draft_id: string; title: string; body: string; storage_key: string | null; file_type: string | null } | null;
  if (!row) return { ok: false, error: "That item could not be found." };
  // Access follows the draft: one this person can open (and, to change, one not locked).
  const d = await draftForContext(s.tenantId, row.draft_id, write);
  if (!d.ok) return d;
  return { ok: true, tenantId: s.tenantId, userId: s.user.id, row };
}

export async function listDraftContextAction(draftId: string): Promise<Result<{ ready: boolean; items: ContextItem[] }>> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  const d = await draftForContext(s.tenantId, draftId, false);
  if (!d.ok) return d;
  return { ok: true, ...(await getDraftContext(s.tenantId, draftId)) };
}

export async function renameDraftContextAction(id: string, title: string): Promise<Result> {
  const r = await itemFor(id, true);
  if (!r.ok) return r;
  const t = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  if (!t) return { ok: false, error: "Give it a name." };
  const { error } = await db.from("draft_context").update({ title: t }).eq("tenant_id", r.tenantId).eq("id", id);
  if (error) return { ok: false, error: "The name could not be saved." };
  revalidatePath(`/drafts/${r.row.draft_id}`);
  return { ok: true };
}

export async function removeDraftContextAction(id: string): Promise<Result> {
  const r = await itemFor(id, true);
  if (!r.ok) return r;
  const { error } = await db.from("draft_context").delete().eq("tenant_id", r.tenantId).eq("id", id);
  if (error) return { ok: false, error: "That item could not be removed." };
  // The original file goes with it. Best-effort: the item is gone either way.
  if (r.row.storage_key?.startsWith(`${r.tenantId}/`)) {
    await db.storage.from("documents").remove([r.row.storage_key]).catch(() => undefined);
  }
  await db.from("audit_log").insert({ actor_user_id: r.userId, tenant_id: r.tenantId, action: "draft_context_removed", detail: `${r.row.draft_id}: ${r.row.title.slice(0, 120)}` });
  revalidatePath(`/drafts/${r.row.draft_id}`);
  return { ok: true };
}

/** The text an item was read into, to check it. */
export async function readDraftContextAction(id: string): Promise<Result<{ title: string; text: string }>> {
  const r = await itemFor(id, false);
  if (!r.ok) return r;
  return { ok: true, title: r.row.title, text: r.row.body };
}

/** A short-lived link to the original file, when one was kept. */
export async function openDraftContextFileAction(id: string): Promise<Result<{ url: string }>> {
  const r = await itemFor(id, false);
  if (!r.ok) return r;
  if (!r.row.storage_key || !r.row.storage_key.startsWith(`${r.tenantId}/`)) return { ok: false, error: "No original file was kept for this item." };
  const { data, error } = await db.storage.from("documents").createSignedUrl(r.row.storage_key, 120);
  if (error || !data?.signedUrl) return { ok: false, error: "The original file could not be opened." };
  return { ok: true, url: data.signedUrl };
}
