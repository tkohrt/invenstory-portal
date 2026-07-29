"use server";
// Server actions for the mock-session era. Phase 4 replaces the bodies with
// Supabase Auth (signInWithPassword, signOut) — signatures stay.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";

const COOKIE = "portal_session";
const opts = { httpOnly: true, sameSite: "lax" as const, secure: true, path: "/" };

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "client");
  const lookup = role === "admin" ? "tyler@forgranted.com" : email;
  const { data: user } = await db.from("app_user").select("email, role").eq("email", lookup).single();
  if (!user) redirect("/?error=unknown");
  const jar = await cookies();
  jar.set(COOKIE, JSON.stringify({ email: user.email }), opts);
  redirect("/library");
}

export async function signOutAction() {
  (await cookies()).delete(COOKIE);
  redirect("/");
}

export async function switchTenantAction(tenantId: string) {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) redirect("/");
  const parsed = JSON.parse(raw);
  jar.set(COOKIE, JSON.stringify({ ...parsed, activeTenant: tenantId }), opts);
}
