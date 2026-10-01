// Download every Story Card, with its sources, as a spreadsheet. The client's
// own (RLS, 0043) or, for an admin, the client being viewed.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { db } from "@/lib/server/db";
import { cardsCsv } from "@/lib/server/exports";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [tenant, { csv, count }] = await Promise.all([getTenant(session.tenantId), cardsCsv(session.tenantId)]);
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "export_cards", detail: `${count} cards` });
  const name = `Story-Cards-${(tenant?.name ?? "export").replace(/[^\w]+/g, "-")}.csv`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
