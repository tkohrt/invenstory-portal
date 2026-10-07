"use server";
// Giving a document its type (decision 33): confirming the analysis's
// suggestion, or picking another. File items on the readiness checklist (a
// 990, a pitch deck, a budget) are covered only by a document tagged this way.
//
// A client tags its own documents; For Granted tags any document of the
// client it is viewing, and a client cannot overwrite For Granted's tag. A
// "use server" export is a public endpoint, so the document is checked against
// the caller's own tenant through RLS before anything is written.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { userClient } from "./supabase";
import { db } from "./db";
import { refreshIfOnAnalysis } from "./analysis-switch";
import { DOC_TYPE_MAP } from "@/lib/analysis";

/** Set (or clear, with null) one document's type. Returns a reason rather than throwing it, so the page can show it. */
export async function setDocTypeAction(documentId: string, type: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  if (type !== null && !DOC_TYPE_MAP[type]) return { ok: false, error: "Choose a type from the list." };
  const supabase = await userClient();
  const { data: doc } = await supabase.from("document").select("id, tenant_id, type_tag, type_tagged_by").eq("id", documentId).maybeSingle();
  // An admin's RLS sees every client: keep to the client being viewed.
  if (!doc || doc.tenant_id !== s.tenantId) return { ok: false, error: "That document could not be found." };
  if (s.role !== "admin" && doc.type_tag && doc.type_tagged_by && doc.type_tagged_by !== s.user.id) {
    const { data: who } = await db.from("app_user").select("role").eq("id", doc.type_tagged_by).maybeSingle();  // tenant-safe: one user's role by id
    if ((who as { role: string } | null)?.role === "admin") {
      return { ok: false, error: "For Granted set this document's type. Ask For Granted to change it." };
    }
  }
  const { error } = await db.from("document").update({
    type_tag: type, type_tagged_by: type ? s.user.id : null, type_tagged_at: type ? new Date().toISOString() : null,
  }).eq("tenant_id", s.tenantId).eq("id", documentId);
  if (error) return { ok: false, error: "The type could not be saved. Has migration 0056 been run?" };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "doc_type_tag", detail: `${documentId} -> ${type ?? "none"}` });
  // On the analysis, readiness follows at once (free).
  await refreshIfOnAnalysis(s.tenantId, s.user.id);
  for (const p of ["/analysis", "/admin/analysis", "/invenstory", "/funding-eligibility"]) revalidatePath(p);
  return { ok: true };
}
