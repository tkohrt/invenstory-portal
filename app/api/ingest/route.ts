// Reprocess a document (admin or same-tenant client): POST { documentId }
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { processDocument } from "@/lib/server/ingest";
import { clientActionsLastDay } from "@/lib/server/ai-usage";
import { decideReprocess } from "@/lib/usage-limits";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { documentId } = await req.json();
  const { data: doc } = await db.from("document").select("id, tenant_id").eq("id", documentId).single();  // tenant-safe: resolves doc + tenant; route then checks doc.tenant_id === session.tenantId or admin
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (session.role !== "admin" && doc.tenant_id !== session.tenantId)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // The same limit as the drawer's "Process again": 5 a day per client, none for admins.
  const actor = session.role === "admin" ? "admin" as const : "client" as const;
  const gate = decideReprocess(actor, actor === "admin" ? 0 : await clientActionsLastDay(doc.tenant_id, "reprocess_doc"));
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 429 });
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "reprocess_doc", detail: documentId });
  try { await processDocument(documentId, { actor, reprocess: true }); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 }); }
}
