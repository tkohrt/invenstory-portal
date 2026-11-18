"use server";
// For Granted's controls for one client's RFP Engine (patch 58): the profile
// the scan reads, and triage of results. Running a scan is an API route
// (/api/admin/rfp-run) because a run can take minutes.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { cleanRfpProfile } from "@/lib/rfp-profile";
import { rfpSnapshot } from "@/lib/following";

type Result = { ok: true } | { ok: false; error: string };
const UUID = /^[0-9a-f-]{36}$/i;

export async function saveRfpProfileAction(tenantId: string, input: { capabilities: string; naics: string; keywords: string }): Promise<Result> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "Only For Granted can change this." };
  if (!UUID.test(tenantId)) return { ok: false, error: "That client could not be found." };
  const p = cleanRfpProfile(input);
  const { error } = await db.from("rfp_profile").upsert({
    tenant_id: tenantId, capabilities: p.capabilities, naics: p.naics, keywords: p.keywords,
    updated_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: "The RFP profile could not be saved. Has migration 0096 been applied?" };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: "rfp_profile_save", detail: `${p.naics.length} codes, ${p.keywords.length} keywords` });
  revalidatePath(`/admin/clients/${tenantId}`); revalidatePath(`/admin/clients/${tenantId}/rfp`);
  return { ok: true };
}

const ADMIN_TRIAGE = ["pinned", "under_review", "rejected"] as const;
export async function triageRfpAction(tenantId: string, noticeId: string, state: (typeof ADMIN_TRIAGE)[number] | null): Promise<Result> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "Only For Granted can change this." };
  if (!UUID.test(tenantId) || !UUID.test(noticeId)) return { ok: false, error: "That result could not be found." };
  if (state !== null && !ADMIN_TRIAGE.includes(state)) return { ok: false, error: "Unknown triage state." };
  const { error } = await db.from("rfp_eligible").update({ admin_triage: state }).eq("tenant_id", tenantId).eq("notice_id", noticeId);
  if (error) return { ok: false, error: "Could not save that." };
  revalidatePath(`/admin/clients/${tenantId}/rfp`);
  return { ok: true };
}

/**
 * Put one RFP Engine result on a client's Following list, or take it off
 * (patch 66). For Granted only, and deliberate: RFP results have no client
 * page yet, so this is how a client comes to see one, chosen by a person.
 * What the client sees is a snapshot of the notice (title, agency, due date,
 * link); none of the scoring, gates or rationale travels with it.
 */
export async function toggleRfpFollowAction(tenantId: string, noticeId: string): Promise<{ ok: true; following: boolean } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "Only For Granted can change this." };
  if (!UUID.test(tenantId) || !UUID.test(noticeId)) return { ok: false, error: "That result could not be found." };
  const { data: existing } = await db.from("saved_item").select("target_id")
    .eq("tenant_id", tenantId).eq("kind", "rfp").eq("target_id", noticeId).maybeSingle();
  if (existing) {
    const { error } = await db.from("saved_item").delete().eq("tenant_id", tenantId).eq("kind", "rfp").eq("target_id", noticeId);
    if (error) return { ok: false, error: "Could not take it off the list. Try again." };
  } else {
    // Only a result this client's scan actually produced.
    const { data } = await db.from("rfp_eligible").select("notice_id, rfp_notice(title, agency, due_at, description_url)")
      .eq("tenant_id", tenantId).eq("notice_id", noticeId).maybeSingle();
    const row = data as unknown as { notice_id: string; rfp_notice: { title: string | null; agency: string | null; due_at: string | null; description_url: string | null } | null } | null;
    if (!row) return { ok: false, error: "That result is not on this client's scan." };
    const snap = rfpSnapshot(row.rfp_notice);
    const { error } = await db.from("saved_item").insert({
      tenant_id: tenantId, kind: "rfp", target_id: noticeId, title: snap.title, detail: snap.detail, saved_by: s.user.id,
    });
    if (error) return { ok: false, error: "Could not add it. Has migration 0099 been applied?" };
  }
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: existing ? "rfp_unfollow" : "rfp_follow", detail: noticeId });
  revalidatePath(`/admin/clients/${tenantId}/rfp`); revalidatePath("/following");
  return { ok: true, following: !existing };
}
