import "server-only";
// Real session, backed by Supabase Auth. Same PortalSession shape the mock
// exposed in Phase 3 — consumers never changed.
import { cookies } from "next/headers";
import { userClient } from "./supabase";
import { db } from "./db";
import type { AppUser, Role } from "@/lib/types";

export interface PortalSession { user: AppUser; role: Role; tenantId: string }

export async function getSession(): Promise<PortalSession | null> {
  const supabase = await userClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return null;
  // app_user read is RLS-guarded to self-or-tenant; use service db only to
  // resolve identity (auth_id -> app_user), never for content.
  const { data: user } = await db.from("app_user").select("*").eq("auth_id", authUser.id).single();
  if (!user) return null;
  let tenantId = user.tenant_id as string | null;
  if (user.role === "admin") {
    const jar = await cookies();
    tenantId = jar.get("active_tenant")?.value ?? null;
    if (!tenantId) {
      const { data: t } = await db.from("tenant").select("id").order("name").limit(1).single();
      tenantId = t?.id ?? null;
    }
  }
  if (!tenantId) return null;
  return { user: user as AppUser, role: user.role as Role, tenantId };
}
