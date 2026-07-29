"use client";
// Mock session context. Phase 4 replaces this with Supabase Auth
// (cookie-based sessions + role-table membership). Shape mirrors what
// the real session will expose so consumers don't change.
import { createContext, useContext, useState, type ReactNode } from "react";
import { getUserByEmail, getTenants } from "./data";
import type { AppUser, Role } from "./types";

interface Session {
  user: AppUser | null;
  role: Role | null;
  tenantId: string | null; // active tenant (admins can switch)
  signIn: (email: string, role: Role) => boolean;
  signOut: () => void;
  switchTenant: (tenantId: string) => void;
}
const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const signIn = (email: string, role: Role) => {
    const u = role === "admin" ? getUserByEmail("tyler@forgranted.com") : (getUserByEmail(email) ?? getUserByEmail("lili@fundtheclimb.org"));
    if (!u) return false;
    setUser(u);
    setTenantId(u.tenant_id ?? getTenants()[0].id);
    return true;
  };
  const signOut = () => { setUser(null); setTenantId(null); };
  const switchTenant = (t: string) => setTenantId(t);
  return (
    <Ctx.Provider value={{ user, role: user?.role ?? null, tenantId, signIn, signOut, switchTenant }}>
      {children}
    </Ctx.Provider>
  );
}
export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
