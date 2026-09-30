// Step one of an upload: a one-time URL to put the file straight into storage.
//
// The file itself never passes through Vercel, which refuses request bodies over
// 4.5 MB. The storage key is built from the signed-in session's tenant and a new
// document id, so the URL can only write into the caller's own folder, once.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { kindFor, storageKeyFor, MAX_UPLOAD_BYTES } from "@/lib/server/upload";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({})) as { filename?: string; size?: number };
  const filename = typeof b.filename === "string" ? b.filename : "";
  const size = typeof b.size === "number" ? b.size : 0;
  if (!filename || !kindFor(filename)) return NextResponse.json({ error: `unsupported file type .${(filename.split(".").pop() ?? "").toLowerCase()}` }, { status: 400 });
  if (size <= 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "file too large (25 MB max)" }, { status: 400 });

  const docId = crypto.randomUUID();
  const path = storageKeyFor(session.tenantId, docId);
  const { data, error } = await db.storage.from("documents").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: `storage: ${error?.message ?? "no upload URL"}` }, { status: 500 });
  return NextResponse.json({ docId, path: data.path, token: data.token });
}
