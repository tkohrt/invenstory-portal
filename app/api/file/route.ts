// Serve a document file via a short-lived signed URL. Uses userClient so RLS
// guarantees the caller can only get URLs for their own tenant's documents
// (no IDOR). Download disposition so an uploaded HTML/SVG can never render as
// a page in any origin (upload-hygiene hardening).
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { userClient } from "@/lib/server/supabase";
import { downloadFilename } from "@/lib/server/filename";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const documentId = req.nextUrl.searchParams.get("documentId");
  if (!documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

  const supabase = await userClient();
  // RLS: this returns a row only if the doc belongs to the caller's tenant.
  const { data: doc } = await supabase.from("document").select("storage_key, title, mime_type, doc_kind, original_name").eq("id", documentId).single();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const filename = downloadFilename(doc);
  const { data: signed, error } = await supabase.storage.from("documents")
    .createSignedUrl(doc.storage_key, 120, { download: filename }); // 2-min expiry, force download
  if (error || !signed) return NextResponse.json({ error: "could not sign" }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl });
}
