import "server-only";
// For Granted's view of AI usage across every client (Admin, AI usage).
//
// Spend comes from the meter (ai_usage), which starts recording with migration
// 0051; earlier calls were never measured. Chat questions are counted from the
// chat log, client logins only, so they are complete from the start.
import { db } from "./db";
import { LIMITS, monthKey, monthStart } from "@/lib/usage-limits";

export interface ClientUsageRow {
  tenantId: string; name: string;
  chatMonth: number; chatLimit: number; extra: number;
  costClient: number; costAdmin: number; costSystem: number;  // dollars this month
  pending: { id: string; kind: string; at: string; by: string }[];
}
export interface UsageOverview {
  period: string;
  clients: ClientUsageRow[];
  byFeature: { feature: string; calls: number; cost: number; inputTokens: number; outputTokens: number }[];
  total: number;
  meterSince: string | null;
}

export async function getUsageOverview(now = new Date()): Promise<UsageOverview> {
  const since = monthStart(now).toISOString();
  const period = monthKey(now);
  const [{ data: tenants }, { data: users }, { data: msgs }, { data: usage }, { data: grants }, { data: reqs }, { data: first }] = await Promise.all([
    db.from("tenant").select("id, name").order("name"),
    db.from("app_user").select("id, tenant_id, role, full_name"),  // tenant-safe: admin overview across every client
    db.from("chat_message").select("tenant_id, author_user_id").eq("role", "user").gte("created_at", since),  // tenant-safe: admin overview across every client
    db.from("ai_usage").select("tenant_id, actor, feature, input_tokens, output_tokens, cost_micros").gte("created_at", since),  // tenant-safe: admin overview across every client
    db.from("usage_grant").select("tenant_id, extra").eq("kind", "chat_month").eq("period", period),  // tenant-safe: admin overview across every client
    db.from("usage_request").select("id, tenant_id, kind, created_at, user_id").eq("status", "pending").order("created_at"),  // tenant-safe: admin overview across every client
    db.from("ai_usage").select("created_at").order("created_at").limit(1),  // tenant-safe: admin overview, earliest meter row
  ]);
  type U = { id: string; tenant_id: string | null; role: string; full_name: string };
  const userList = (users ?? []) as U[];
  const clientIds = new Set(userList.filter(u => u.role === "client").map(u => u.id));
  const nameOf = new Map(userList.map(u => [u.id, u.full_name]));
  type A = { tenant_id: string | null; actor: string; feature: string; input_tokens: number; output_tokens: number; cost_micros: number };
  const rows = (usage ?? []) as A[];

  const clients: ClientUsageRow[] = ((tenants ?? []) as { id: string; name: string }[]).map(t => {
    const extra = ((grants ?? []) as { tenant_id: string; extra: number }[]).filter(g => g.tenant_id === t.id).reduce((n, g) => n + g.extra, 0);
    const mine = rows.filter(r => r.tenant_id === t.id);
    const sum = (actor: string) => mine.filter(r => r.actor === actor).reduce((n, r) => n + r.cost_micros, 0) / 1_000_000;
    return {
      tenantId: t.id, name: t.name,
      chatMonth: ((msgs ?? []) as { tenant_id: string; author_user_id: string | null }[])
        .filter(m => m.tenant_id === t.id && m.author_user_id && clientIds.has(m.author_user_id)).length,
      chatLimit: LIMITS.chatPerMonthPerClient + extra, extra,
      costClient: sum("client"), costAdmin: sum("admin"), costSystem: sum("system"),
      pending: ((reqs ?? []) as { id: string; tenant_id: string; kind: string; created_at: string; user_id: string | null }[])
        .filter(r => r.tenant_id === t.id)
        .map(r => ({ id: r.id, kind: r.kind, at: r.created_at, by: (r.user_id && nameOf.get(r.user_id)) || "A client user" })),
    };
  });

  const byFeature = new Map<string, { feature: string; calls: number; cost: number; inputTokens: number; outputTokens: number }>();
  for (const r of rows) {
    const f = byFeature.get(r.feature) ?? { feature: r.feature, calls: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
    f.calls += 1; f.cost += r.cost_micros / 1_000_000; f.inputTokens += r.input_tokens; f.outputTokens += r.output_tokens;
    byFeature.set(r.feature, f);
  }
  return {
    period, clients,
    byFeature: [...byFeature.values()].sort((a, b) => b.cost - a.cost),
    total: rows.reduce((n, r) => n + r.cost_micros, 0) / 1_000_000,
    meterSince: ((first ?? []) as { created_at: string }[])[0]?.created_at ?? null,
  };
}
