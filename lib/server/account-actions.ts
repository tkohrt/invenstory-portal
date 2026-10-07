"use server";
import { getSession } from "./session";
import { userClient } from "./supabase";
import { db } from "./db";
import { notifyAccountClosure } from "./notify";

export async function changePasswordAction(current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthorized" };
  if (next.length < 12) return { ok: false, error: "New password must be at least 12 characters." };
  const supabase = await userClient();
  // Re-authenticate with the current password before allowing the change.
  const { error: reauth } = await supabase.auth.signInWithPassword({ email: session.user.email, password: current });
  if (reauth) return { ok: false, error: "Your current password is incorrect." };
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: error.message };
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "change_password", detail: session.user.email });
  return { ok: true };
}

export async function requestAccountClosureAction(reason: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthorized" };
  const { data: t } = await db.from("tenant").select("name").eq("id", session.tenantId).single();
  await notifyAccountClosure({ org: t?.name ?? "a client", requester: session.user.full_name, email: session.user.email, reason });
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "closure_request", detail: reason.slice(0, 200) });
  return { ok: true };
}

/**
 * A small interface choice for the signed-in person, such as whether to warn
 * before a card is removed from an answer. Only known keys, only booleans: this
 * is a public endpoint, and the column is not a place for arbitrary data.
 */
const UI_PREF_KEYS = new Set(["confirm_card_remove", "confirm_weave"]);
export async function setUiPrefAction(key: string, value: boolean) {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  if (!UI_PREF_KEYS.has(key) || typeof value !== "boolean") throw new Error("unknown preference");
  const prefs = { ...((s.user.ui_prefs as Record<string, unknown> | null) ?? {}), [key]: value };
  const { error } = await db.from("app_user").update({ ui_prefs: prefs })  // tenant-safe: the signed-in person's own row, by id from the session
    .eq("id", s.user.id);
  if (error) throw new Error(`Could not save that preference: ${error.message}`);
}
