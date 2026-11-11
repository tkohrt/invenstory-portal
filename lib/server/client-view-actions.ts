"use server";
// A client marks a match "Worth a look" or "Not for us"; For Granted switches
// self-service searching on or off (patch 7 of the 1 November 2026 build).
// Every export is a public endpoint: each checks its caller and works only on
// the caller's own client (or, for the switch, only for For Granted).
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { cleanView, isClientViewKind, SELF_SEARCH_KEY } from "@/lib/client-view";

type Result = { ok: true } | { ok: false; error: string };

export async function setClientViewAction(input: { kind: string; targetId: string; state: string; reason?: string | null; note?: string | null }): Promise<Result> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  const v = cleanView(input);
  if (!v) return { ok: false, error: "That could not be saved." };
  const { error } = await db.from("client_match_view").upsert({
    tenant_id: s.tenantId, kind: v.kind, target_id: v.targetId, state: v.state, reason: v.reason, note: v.note,
    decided_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,kind,target_id" });
  if (error) { console.error("[client-view] save refused", error.message); return { ok: false, error: "That could not be saved. Please try again." }; }
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "client_match_view", detail: `${v.kind}:${v.state}` });
  revalidatePath("/funder-matches"); revalidatePath("/funding"); revalidatePath("/funder-matches/report");
  return { ok: true };
}

export async function clearClientViewAction(kind: string, targetId: string): Promise<Result> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  if (!isClientViewKind(kind) || typeof targetId !== "string" || !targetId) return { ok: false, error: "That could not be undone." };
  const { error } = await db.from("client_match_view").delete()
    .eq("tenant_id", s.tenantId).eq("kind", kind).eq("target_id", targetId);
  if (error) return { ok: false, error: "That could not be undone. Please try again." };
  revalidatePath("/funder-matches"); revalidatePath("/funding"); revalidatePath("/funder-matches/report");
  return { ok: true };
}

/** For Granted only: let this client run matching and the web search itself. */
export async function setSelfSearchAction(on: boolean): Promise<Result> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "Only For Granted can change this." };
  const { error } = await db.from("feature_visibility").upsert({
    tenant_id: s.tenantId, feature_key: SELF_SEARCH_KEY, visible: !!on, updated_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,feature_key" });
  if (error) return { ok: false, error: "Could not save the switch." };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "feature_visibility", detail: `${SELF_SEARCH_KEY}=${on ? "visible" : "hidden"}` });
  revalidatePath("/funder-matches"); revalidatePath("/funding");
  return { ok: true };
}
