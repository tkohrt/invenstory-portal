import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { userClient } from "@/lib/server/supabase";
import { db } from "@/lib/server/db";

// Search runs through userClient -> the search_inventory RPC executes as the
// signed-in user, so RLS scopes results to their tenant automatically.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const tag = req.nextUrl.searchParams.get("tag");
  const layer = req.nextUrl.searchParams.get("layer");
  if (!q) return NextResponse.json({ results: [] });

  const supabase = await userClient();
  const { data, error } = await supabase.rpc("search_inventory", { p_query: q });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let results = (data ?? []) as {
    document_id: string; tenant_id: string; title: string; layer: string;
    doc_kind: string; created_at: string; passage: string; page_number: number | null; rank: number;
  }[];

  // Admin views a selected tenant; RLS lets admins see all, so scope explicitly.
  if (session.role === "admin") results = results.filter(r => r.tenant_id === session.tenantId);
  if (layer && ["I", "II", "III"].includes(layer)) results = results.filter(r => r.layer === layer);

  // Tag filter: intersect with the tenant's tag rows (RLS-scoped read).
  if (tag) {
    const { data: tagged } = await supabase.from("document_tag").select("document_id").eq("tag", tag);
    const ids = new Set((tagged ?? []).map(t => t.document_id));
    results = results.filter(r => ids.has(r.document_id));
  }

  results.sort((a, b) => b.rank - a.rank);
  // audit search (service client; no client write policy on audit_log)
  await db.from("audit_log").insert({
    actor_user_id: session.user.id, tenant_id: session.tenantId,
    action: "search", detail: `q="${q.slice(0, 80)}" hits=${results.length}`,
  });
  return NextResponse.json({ results });
}
