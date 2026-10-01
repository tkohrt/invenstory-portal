// Download the Answer Library as one Markdown document.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { db } from "@/lib/server/db";
import { answersMarkdown } from "@/lib/server/exports";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await getTenant(session.tenantId);
  const { md, count } = await answersMarkdown(session.tenantId, tenant?.name ?? "Client");
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "export_answers", detail: `${count} answers` });
  const name = `Answer-Library-${(tenant?.name ?? "export").replace(/[^\w]+/g, "-")}.md`;
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
