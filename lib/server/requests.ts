import "server-only";
import { db } from "./db";
import type { ClientRequest } from "@/lib/requests-shared";

export { KIND_LABEL } from "@/lib/requests-shared";
export type { ClientRequest } from "@/lib/requests-shared";

/**
 * The Requests inbox (patch 37): the system of record behind the Slack pings
 * and emails. recordRequest is called by notify.ts BEFORE any channel fires,
 * so a missed Slack message never means a lost request.
 */

export async function recordRequest(r: {
  tenantId?: string | null; kind: string; detail: string;
  createdBy?: string | null; status?: "open" | "seen"; sourceKey?: string | null;
}): Promise<void> {
  // tenant-safe: an insert with an explicit tenant_id (or deliberately none,
  // for website leads); reads are admin-gated by the inbox.
  const { error } = await db.from("client_request").insert({
    tenant_id: r.tenantId ?? null, kind: r.kind.slice(0, 40),
    detail: r.detail.replace(/\s+/g, " ").trim().slice(0, 800),
    source_key: r.sourceKey?.slice(0, 120) ?? null,
    created_by: r.createdBy ?? null, status: r.status ?? "open",
  });
  // Best-effort by design, like the channels it fronts: before migration 0086
  // runs, or on a hiccup, the Slack/email path still carries the news.
  if (error) console.error("[requests] record failed", error);
}

/** Auto-resolution: close open rows whose source went away (e.g. unflagged). */
export async function resolveBySource(tenantId: string, sourceKey: string, resolution: string): Promise<void> {
  const { error } = await db.from("client_request")
    .update({ status: "done", handled_at: new Date().toISOString(), resolution })
    .eq("tenant_id", tenantId).eq("source_key", sourceKey).eq("status", "open");
  if (error) console.error("[requests] source resolve failed", error);
}

export async function getRequests(): Promise<{ open: ClientRequest[]; recent: ClientRequest[] }> {
  // tenant-safe: cross-tenant on purpose; the inbox is admin-only (RLS and the
  // page both enforce it) and exists to see every client's requests at once.
  const [openRes, recentRes, tenantsRes, usersRes] = await Promise.all([
    db.from("client_request").select("*").in("status", ["open", "seen"]).order("created_at", { ascending: false }).limit(200),
    db.from("client_request").select("*").in("status", ["done", "dismissed"]).order("handled_at", { ascending: false }).limit(25),
    db.from("tenant").select("id, name"),
    db.from("app_user").select("id, full_name, email").eq("role", "admin"),  // tenant-safe: admins only, for handled-by names
  ]);
  const tn = new Map(((tenantsRes.data ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name]));
  const un = new Map(((usersRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[])
    .map(u => [u.id, u.full_name ?? u.email ?? "For Granted"]));
  const fill = (r: Record<string, unknown>): ClientRequest => ({
    ...(r as unknown as ClientRequest),
    tenant_name: r.tenant_id ? (tn.get(r.tenant_id as string) ?? "Unknown client") : null,
    handled_by_name: r.handled_by ? (un.get(r.handled_by as string) ?? "For Granted") : null,
  });
  return {
    open: ((openRes.data ?? []) as Record<string, unknown>[]).map(fill),
    recent: ((recentRes.data ?? []) as Record<string, unknown>[]).map(fill),
  };
}

export async function openRequestCount(): Promise<number> {
  // tenant-safe: an admin badge count across tenants, number only.
  const { count, error } = await db.from("client_request")
    .select("id", { count: "exact", head: true }).eq("status", "open");
  if (error) return 0;
  return count ?? 0;
}
