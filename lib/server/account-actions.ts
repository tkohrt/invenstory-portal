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
