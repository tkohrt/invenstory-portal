import "server-only";
// Mock session stored in an httpOnly cookie — same SHAPE as Phase 4's real
// auth session so consumers don't change when Supabase Auth replaces this.
import { cookies } from "next/headers";
import { db } from "./db";
import type { AppUser, Role } from "@/lib/types";

export interface PortalSession {
  user: AppUser;
  role: Role;
  tenantId: string; // active tenant (admins may switch)
}

export async function getSession(): Promise<PortalSession | null> {
  const jar = await cookies();
  const raw = jar.get("portal_session")?.value;
  if (!raw) return null;
  let parsed: { email?: string; activeTenant?: string };
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed.email) return null;
  const { data: user } = await db.from("app_user").select("*").eq("email", parsed.email).single();
  if (!user) return null;
  let tenantId = user.tenant_id as string | null;
  if (user.role === "admin") {
    tenantId = parsed.activeTenant ?? null;
    if (!tenantId) {
      const { data: t } = await db.from("tenant").select("id").order("name").limit(1).single();
      tenantId = t?.id ?? null;
    }
  }
  if (!tenantId) return null;
  return { user: user as AppUser, role: user.role as Role, tenantId };
}
