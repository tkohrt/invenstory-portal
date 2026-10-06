// Open the funder's original application file a draft was made from (client
// activity, patch 2). For Granted only: a short-lived signed link that downloads
// the file, for any client's draft, so the activity page needs no client switch.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "For Granted only." }, { status: 403 });
  const draftId = req.nextUrl.searchParams.get("draftId") ?? "";
  const tenantId = req.nextUrl.searchParams.get("tenantId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(draftId) || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    return NextResponse.json({ error: "Which draft?" }, { status: 400 });
  }
  const { data } = await db.from("grant_draft").select("source_storage_key, source_filename")
    .eq("tenant_id", tenantId).eq("id", draftId).maybeSingle();
  const row = data as { source_storage_key: string | null; source_filename: string | null } | null;
  if (!row?.source_storage_key) return NextResponse.json({ error: "No file was kept for this draft." }, { status: 404 });
  const name = row.source_filename || row.source_storage_key.split("/").pop() || "application";
  const { data: signed, error } = await db.storage.from("documents").createSignedUrl(row.source_storage_key, 120, { download: name });
  if (error || !signed) return NextResponse.json({ error: "The file could not be opened." }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl });
}
