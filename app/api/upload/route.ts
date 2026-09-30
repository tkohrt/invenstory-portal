// Upload with the file in the request body.
//
// Kept for small files and any caller that still posts the file itself, but
// Vercel refuses request bodies over 4.5 MB before this runs (a 413 the portal
// never sees). The upload form uses /api/upload/sign and /api/upload/complete
// instead, which send the file straight to storage.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { fileUploadedDocument, kindFor, storageKeyFor, MAX_UPLOAD_BYTES } from "@/lib/server/upload";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const title = String(form.get("title") ?? "").trim();
  const layer = String(form.get("layer") ?? "");
  const tags = String(form.get("tags") ?? "").split(",").map(t => t.trim()).filter(Boolean);

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "file too large (25 MB max)" }, { status: 400 });
  if (!["I", "II", "III"].includes(layer)) return NextResponse.json({ error: "layer required" }, { status: 400 });
  if (!kindFor(file.name)) return NextResponse.json({ error: `unsupported file type .${(file.name.split(".").pop() ?? "").toLowerCase()}` }, { status: 400 });

  const tenantId = session.tenantId;
  const docId = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await db.storage.from("documents")
    .upload(storageKeyFor(tenantId, docId), buffer, { contentType: file.type || "application/octet-stream" });
  if (upErr) return NextResponse.json({ error: `storage: ${upErr.message}` }, { status: 500 });

  const r = await fileUploadedDocument({
    tenantId, role: session.role, userId: session.user.id, userName: session.user.full_name,
    docId, filename: file.name, contentType: file.type, title, layer, tags,
  });
  return "error" in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json({ id: r.id });
}
