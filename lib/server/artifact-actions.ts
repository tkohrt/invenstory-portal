"use server";
// Story Intelligence lifecycle actions. Generation may be triggered by a
// client or admin; approval/edit/removal/regeneration are admin-only. All
// mutations verify role server-side and never trust the client.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { generateArtifact } from "./artifacts";

async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

export async function generateSIAction(slug: string) {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  // client or admin may generate for the active tenant
  await generateArtifact(s.tenantId, slug);
  revalidatePath(`/story-intelligence/${slug}`);
}

export async function regenerateSIAction(slug: string) {
  const s = await requireAdmin();
  await generateArtifact(s.tenantId, slug);
  revalidatePath(`/story-intelligence/${slug}`);
}

export async function approveSIAction(slug: string) {
  const s = await requireAdmin();
  const { data: set } = await db.from("artifact_set").select("id")
    .eq("tenant_id", s.tenantId).eq("type_slug", slug).single();
  if (!set) throw new Error("no set");
  await db.from("artifact_set").update({ status: "approved", reviewed_by: s.user.id, generated_at: new Date().toISOString() }).eq("id", set.id);
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "si_approve", detail: slug });
  revalidatePath(`/story-intelligence/${slug}`);
  revalidatePath("/admin/reviews");
}

export async function removeSICardAction(slug: string, cardId: string) {
  const s = await requireAdmin();
  await db.from("artifact_card").delete().eq("id", cardId).eq("tenant_id", s.tenantId);
  revalidatePath(`/story-intelligence/${slug}`);
}

export async function editSICardAction(slug: string, cardId: string, field: string, value: string) {
  const s = await requireAdmin();
  const { data: card } = await db.from("artifact_card").select("payload").eq("id", cardId).eq("tenant_id", s.tenantId).single();
  if (!card) return;
  await db.from("artifact_card").update({ payload: { ...card.payload, [field]: value } }).eq("id", cardId);
  revalidatePath(`/story-intelligence/${slug}`);
}
