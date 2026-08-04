"use server";
// Admin-only client provisioning ("Add client"). Creates the tenant, the auth
// user + linked app_user, and the Story Intelligence artifact sets — the same
// steps done by hand for the seed clients, now self-service for Tyler/Shane.
import { getSession } from "./session";
import { db } from "./db";

function tempPassword() {
  const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 12; i++) s += c[Math.floor(Math.random() * c.length)];
  return s + "A9!";
}

export interface NewClientResult { ok: boolean; email?: string; tempPassword?: string; error?: string }

export async function createClientAction(input: {
  orgName: string; orgType: "nonprofit" | "startup"; contactName: string; email: string; website?: string;
}): Promise<NewClientResult> {
  const session = await getSession();
  if (!session || session.role !== "admin") return { ok: false, error: "admin required" };

  const orgName = input.orgName.trim();
  const email = input.email.trim().toLowerCase();
  const contactName = input.contactName.trim() || email;
  if (!orgName) return { ok: false, error: "Organization name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!["nonprofit", "startup"].includes(input.orgType)) return { ok: false, error: "Choose an organization type." };

  // guard against duplicates
  const { data: dupUser } = await db.from("app_user").select("id").eq("email", email).maybeSingle();
  if (dupUser) return { ok: false, error: "A user with that email already exists." };
  const { data: dupTenant } = await db.from("tenant").select("id").eq("name", orgName).maybeSingle();
  if (dupTenant) return { ok: false, error: "A client with that name already exists." };

  // 1. auth user
  const pw = tempPassword();
  const { data: au, error: e1 } = await db.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (e1 || !au?.user) return { ok: false, error: e1?.message ?? "Could not create login." };

  // 2. tenant
  const { data: tenant, error: e2 } = await db.from("tenant")
    .insert({ name: orgName, org_type: input.orgType, website: input.website?.trim() || null })
    .select("id").single();
  if (e2 || !tenant) { await db.auth.admin.deleteUser(au.user.id); return { ok: false, error: e2?.message ?? "Could not create client." }; }

  // 3. app_user (client)
  const { error: e3 } = await db.from("app_user").insert({
    tenant_id: tenant.id, email, full_name: contactName, role: "client", auth_id: au.user.id,
  });
  if (e3) return { ok: false, error: e3.message };

  // 4. Story Intelligence sets so the tabs render
  const { data: types } = await db.from("artifact_type").select("slug");
  for (const t of (types ?? [])) await db.from("artifact_set").insert({ tenant_id: tenant.id, type_slug: t.slug, status: "none" });

  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: tenant.id, action: "create_client", detail: `${orgName} (${input.orgType}) / ${email}` });
  return { ok: true, email, tempPassword: pw };
}
