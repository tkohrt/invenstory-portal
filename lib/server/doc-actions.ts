"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { userClient } from "./supabase";
import { db } from "./db";

// Edit a document's tags. userClient enforces RLS (caller's tenant only); the
// tag rows are replaced to match the submitted set.
export async function updateDocTagsAction(documentId: string, tags: string[]) {
  const session = await getSession();
  if (!session) throw new Error("unauthorized");
  const supabase = await userClient();
  // Ownership check via RLS: only returns the doc if it's in the caller's tenant.
  const { data: doc } = await supabase.from("document").select("id, tenant_id").eq("id", documentId).single();
  if (!doc) throw new Error("not found");
  const clean = [...new Set(tags.map(t => t.trim()).filter(Boolean))].slice(0, 20);
  // Replace tag set (service client scoped to the verified doc's tenant).
  await db.from("document_tag").delete().eq("document_id", documentId).eq("tenant_id", doc.tenant_id);
  if (clean.length) await db.from("document_tag").insert(clean.map(tag => ({ document_id: documentId, tenant_id: doc.tenant_id, tag })));
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: doc.tenant_id, action: "edit_tags", detail: `${documentId} -> [${clean.join(", ")}]` });
  revalidatePath("/library"); revalidatePath("/search");
}
