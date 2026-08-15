/**
 * Cross-tenant isolation test harness.
 *
 * These tests prove the product's core guarantee: a logged-in client (tenant)
 * can NEVER read or modify another tenant's data. They exercise the REAL
 * boundary — Postgres Row-Level Security — by authenticating as actual users
 * and attempting cross-tenant access through the anon (RLS-enforced) client.
 *
 * SAFETY: never run against production. Requires a dedicated test/staging
 * Supabase project. The guard below hard-fails if the target looks like prod.
 *
 * Required env (see tests/README.md):
 *   TEST_SUPABASE_URL                test project URL
 *   TEST_SUPABASE_ANON_KEY           anon key (RLS applies)
 *   TEST_SUPABASE_SERVICE_ROLE_KEY   service-role key (setup/teardown only)
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.TEST_SUPABASE_URL ?? "";
const ANON = process.env.TEST_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";

// --- production guard -------------------------------------------------------
const PROD_REFS = ["dafofmvbbggrmyfnjspg"]; // known production project ref(s)
if (!URL || !ANON || !SERVICE) {
  throw new Error("Set TEST_SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY (a test project, not prod).");
}
if (PROD_REFS.some(ref => URL.includes(ref))) {
  throw new Error("REFUSING TO RUN: TEST_SUPABASE_URL points at a production project.");
}

export const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });

export interface TestTenant {
  tenantId: string;
  email: string;
  password: string;
  authId: string;
  appUserId: string;
  docId: string;
  chatSessionId: string;
  chatMessageId: string;
  draftId: string;
  answerId?: string;
  client: SupabaseClient; // authenticated, RLS-enforced (anon key + user JWT)
}

async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

/** Provision one isolated tenant with a user and one row per tenant-scoped table. */
export async function provisionTenant(label: string): Promise<TestTenant> {
  const db = admin();
  const email = `iso-${label}-${Date.now()}@example.test`;
  const password = `Test-${Math.random().toString(36).slice(2)}-Aa1!`;

  const { data: tenant, error: te } = await db.from("tenant").insert({ name: `ISO ${label}` }).select("id").single();
  if (te) throw te;
  const tenantId = tenant.id;

  const { data: authUser, error: ae } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (ae) throw ae;
  const authId = authUser.user.id;

  const { data: appUser, error: ue } = await db.from("app_user")
    .insert({ tenant_id: tenantId, email, full_name: `ISO ${label}`, role: "client", auth_id: authId })
    .select("id").single();
  if (ue) throw ue;

  const { data: doc, error: de } = await db.from("document")
    .insert({ tenant_id: tenantId, title: `${label} secret doc`, layer: "I", storage_key: `iso/${tenantId}/f`, doc_kind: "note", status: "ready" })
    .select("id").single();
  if (de) throw de;
  await db.from("document_chunk").insert({ document_id: doc.id, tenant_id: tenantId, text: `${label} confidential chunk` });
  await db.from("document_tag").insert({ document_id: doc.id, tenant_id: tenantId, tag: `${label}-tag` });

  const { data: session } = await db.from("chat_session").insert({ tenant_id: tenantId, user_id: appUser.id, title: `${label} chat` }).select("id").single();
  const { data: msg } = await db.from("chat_message").insert({ session_id: session!.id, tenant_id: tenantId, role: "user", content: `${label} private question` }).select("id").single();

  const { data: draft } = await db.from("grant_draft").insert({ tenant_id: tenantId, title: `${label} draft`, created_by: appUser.id }).select("id").single();
  await db.from("plant_state").insert({ tenant_id: tenantId, species: "pothos" });

  const client = await signedInClient(email, password);
  return {
    tenantId, email, password, authId, appUserId: appUser.id,
    docId: doc.id, chatSessionId: session!.id, chatMessageId: msg!.id, draftId: draft!.id, client,
  };
}

export async function teardown(...tenants: TestTenant[]) {
  const db = admin();
  for (const t of tenants) {
    // tenant delete cascades most rows; remove the auth user explicitly.
    await db.from("tenant").delete().eq("id", t.tenantId);
    await db.auth.admin.deleteUser(t.authId).catch(() => {});
  }
}
