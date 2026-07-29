import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { processDocument } from "@/lib/server/ingest";
import { markStaleOnUpload } from "@/lib/server/artifacts";

export const maxDuration = 60;

const KIND_BY_EXT: Record<string, string> = {
  pdf: "pdf", docx: "docx", doc: "docx", txt: "note", md: "note", html: "web",
  xlsx: "xlsx", xls: "xlsx", mp3: "audio", m4a: "audio", wav: "audio",
};
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const title = String(form.get("title") ?? "").trim();
  const layer = String(form.get("layer") ?? "");
  const tags = String(form.get("tags") ?? "").split(",").map(t => t.trim()).filter(Boolean);

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (25 MB max)" }, { status: 400 });
  if (!["I", "II", "III"].includes(layer)) return NextResponse.json({ error: "layer required" }, { status: 400 });
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const docKind = KIND_BY_EXT[ext];
  if (!docKind) return NextResponse.json({ error: `unsupported file type .${ext}` }, { status: 400 });

  const tenantId = session.tenantId;
  const docId = crypto.randomUUID();
  const storageKey = `${tenantId}/${docId}/1`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await db.storage.from("documents")
    .upload(storageKey, buffer, { contentType: file.type || "application/octet-stream" });
  if (upErr) return NextResponse.json({ error: `storage: ${upErr.message}` }, { status: 500 });

  const { error: docErr } = await db.from("document").insert({
    id: docId, tenant_id: tenantId, title: title || file.name, layer,
    storage_key: storageKey, mime_type: file.type || "application/octet-stream",
    doc_kind: docKind, status: "pending", uploaded_by: session.user.id,
    source: session.role === "admin" ? "for_granted" : "client",
  });
  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });
  await db.from("document_version").insert({
    document_id: docId, tenant_id: tenantId, version: 1, storage_key: storageKey, uploaded_by: session.user.id,
  });
  if (tags.length) await db.from("document_tag").insert(
    tags.map(tag => ({ document_id: docId, tenant_id: tenantId, tag })));

  try { await processDocument(docId); } catch { /* status=failed already recorded; card shows it */ }
  // New material invalidates approved Story Intelligence -> stale (offers regenerate).
  await markStaleOnUpload(tenantId);
  return NextResponse.json({ id: docId });
}
