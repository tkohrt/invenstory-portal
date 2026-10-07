// Step two of an upload: the file is in storage, so file it into the Inven(s)tory.
//
// Nothing about the file is trusted from the request. The storage key is rebuilt
// from the session's tenant and the document id, and the object must actually be
// there, at no more than the stated limit, before any row is written.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { fileUploadedDocument, MAX_UPLOAD_BYTES } from "@/lib/server/upload";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({})) as {
    docId?: string; filename?: string; contentType?: string; title?: string; layer?: string; tags?: string; typeTag?: string;
  };
  const docId = typeof b.docId === "string" && /^[0-9a-f-]{36}$/i.test(b.docId) ? b.docId : "";
  if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
  const tenantId = session.tenantId;

  const { data: objs, error } = await db.storage.from("documents").list(`${tenantId}/${docId}`);
  const obj = (objs ?? []).find(o => o.name === "1");
  if (error || !obj) return NextResponse.json({ error: "The file did not reach storage. Try the upload again." }, { status: 400 });
  const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  if (size > MAX_UPLOAD_BYTES) {
    await db.storage.from("documents").remove([`${tenantId}/${docId}/1`]);
    return NextResponse.json({ error: "file too large (25 MB max)" }, { status: 400 });
  }

  const r = await fileUploadedDocument({
    tenantId, role: session.role, userId: session.user.id, userName: session.user.full_name,
    docId, filename: String(b.filename ?? "").slice(0, 300), contentType: String(b.contentType ?? ""),
    title: String(b.title ?? "").trim().slice(0, 300), layer: String(b.layer ?? ""),
    tags: String(b.tags ?? "").split(",").map(t => t.trim()).filter(Boolean),
    typeTag: typeof b.typeTag === "string" && b.typeTag ? b.typeTag.slice(0, 40) : null,
  });
  return "error" in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json({ id: r.id });
}
