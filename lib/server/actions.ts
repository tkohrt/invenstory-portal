"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userClient } from "./supabase";
import { db } from "./db";

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const supabase = await userClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/?error=" + encodeURIComponent("Invalid email or password."));
  redirect("/library");
}

export async function signOutAction() {
  const supabase = await userClient();
  await supabase.auth.signOut();
  (await cookies()).delete("active_tenant");
  redirect("/");
}

export async function switchTenantAction(tenantId: string) {
  // Admin-only: verified against the role table, never trusting the client.
  const supabase = await userClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: me } = await db.from("app_user").select("role").eq("auth_id", user.id).single();
  if (me?.role !== "admin") redirect("/library");
  (await cookies()).set("active_tenant", tenantId, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  // audit the cross-tenant view
  await db.from("audit_log").insert({ actor_user_id: null, tenant_id: tenantId, action: "admin_switch_tenant", detail: `admin ${user.email} viewing tenant ${tenantId}` });
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/?error=" + encodeURIComponent("Enter your email first."));
  const supabase = await userClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://invenstory-portal.vercel.app";
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/update-password` });
  // Always show the same notice — never reveal whether an email is registered.
  redirect("/?notice=" + encodeURIComponent("If that email has an account, a reset link is on its way."));
}

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 12) redirect("/auth/update-password?error=" + encodeURIComponent("Use at least 12 characters."));
  const supabase = await userClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/auth/update-password?error=" + encodeURIComponent(error.message));
  redirect("/library");
}
