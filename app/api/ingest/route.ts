// Reprocess a document (admin or same-tenant client): POST { documentId }
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { processDocument } from "@/lib/server/ingest";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { documentId } = await req.json();
  const { data: doc } = await db.from("document").select("id, tenant_id").eq("id", documentId).single();  // tenant-safe: resolves doc + tenant; route then checks doc.tenant_id === session.tenantId or admin
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (session.role !== "admin" && doc.tenant_id !== session.tenantId)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try { await processDocument(documentId); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 }); }
}
