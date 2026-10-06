import "server-only";
// Filing an uploaded file into a client's Inven(s)tory, once it is in storage.
//
// Shared by the two ways a file arrives:
//   * /api/upload, the original route, which receives the file itself. Vercel
//     refuses any request body over 4.5 MB before the route runs, so this only
//     works for small files.
//   * /api/upload/sign then /api/upload/complete, where the browser puts the file
//     straight into Supabase Storage with a one-time signed URL and only a small
//     JSON request reaches Vercel. This is what the upload form uses, so the
//     25 MB limit it states is the limit it has.
//
// Either way the storage key is built here from the session's tenant, never
// taken from the request, so a file can only ever land in the caller's own folder.
import { db } from "./db";
import { processDocument } from "./ingest";
import { markStaleOnUpload } from "./artifacts";
import { notifyClientUpload } from "./notify";
import { EXT_TO_KIND } from "@/lib/uploads";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const storageKeyFor = (tenantId: string, docId: string) => `${tenantId}/${docId}/1`;

export function kindFor(filename: string): string | null {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  return EXT_TO_KIND[ext] ?? null;
}

export interface FileInput {
  tenantId: string;
  role: "client" | "admin";
  userId: string;
  userName: string;
  docId: string;
  filename: string;
  contentType: string;
  title: string;
  layer: string;
  tags: string[];
}

/** Create the document rows for a file already in storage, then read it. */
export async function fileUploadedDocument(i: FileInput): Promise<{ id: string } | { error: string; status: number }> {
  const docKind = kindFor(i.filename);
  if (!docKind) return { error: `unsupported file type .${(i.filename.split(".").pop() ?? "").toLowerCase()}`, status: 400 };
  if (!["I", "II", "III"].includes(i.layer)) return { error: "layer required", status: 400 };
  const storageKey = storageKeyFor(i.tenantId, i.docId);

  const { error: docErr } = await db.from("document").insert({
    id: i.docId, tenant_id: i.tenantId, title: i.title || i.filename, layer: i.layer,
    original_name: i.filename,
    storage_key: storageKey, mime_type: i.contentType || "application/octet-stream",
    doc_kind: docKind, status: "pending", uploaded_by: i.userId,
    source: i.role === "admin" ? "for_granted" : "client",
  });
  if (docErr) return { error: docErr.message, status: 500 };
  await db.from("document_version").insert({
    document_id: i.docId, tenant_id: i.tenantId, version: 1, storage_key: storageKey, uploaded_by: i.userId,
  });
  if (i.tags.length) await db.from("document_tag").insert(
    i.tags.map(tag => ({ document_id: i.docId, tenant_id: i.tenantId, tag })));

  try { await processDocument(i.docId, { actor: i.role === "admin" ? "admin" : "client" }); } catch { /* status=failed already recorded; card shows it */ }
  // New material invalidates approved Story Intelligence -> stale (offers regenerate).
  await markStaleOnUpload(i.tenantId);
  // Notify the For Granted team when a client (not an admin) uploads.
  if (i.role === "client") {
    const { data: t } = await db.from("tenant").select("name").eq("id", i.tenantId).single();
    await notifyClientUpload({ org: t?.name ?? "a client", uploader: i.userName, title: i.title || i.filename, layer: i.layer });
  }
  return { id: i.docId };
}
