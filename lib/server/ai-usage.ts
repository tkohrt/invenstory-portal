import "server-only";
// The AI usage meter and the counts behind the client limits.
//
// Every model call goes through chatComplete (lib/server/llm.ts), which reports
// its tokens here. Who the call was for comes from a context set at the entry
// point (withAiUsage), carried through every await by AsyncLocalStorage, so the
// fourteen places that call the model do not each pass it along. A call with
// no context is still recorded, as "system" with no client, rather than lost.
//
// Recording is best-effort: a failed insert is logged and never breaks the
// call it measures.
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./db";
import { costMicros } from "@/lib/ai-pricing";
import { monthKey, monthStart, type Actor } from "@/lib/usage-limits";

export interface UsageCtx {
  tenantId: string | null;
  userId?: string | null;
  actor: Actor | "system";
  feature: string;
}

const als = new AsyncLocalStorage<UsageCtx>();

/** Run `fn` with every model call inside it attributed to `ctx`. An outer context wins. */
export function withAiUsage<T>(ctx: UsageCtx, fn: () => Promise<T>): Promise<T> {
  const outer = als.getStore();
  return outer ? fn() : als.run(ctx, fn);
}

/** The role of a job's starter, for attributing a server-carried run. */
export async function actorForJob(tenantId: string, jobId: string): Promise<{ actor: Actor | "system"; userId: string | null }> {
  try {
    const { data: job } = await db.from("job").select("started_by").eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
    const userId = (job as { started_by: string | null } | null)?.started_by ?? null;
    if (!userId) return { actor: "system", userId: null };
    const { data: u } = await db.from("app_user").select("role").eq("id", userId).maybeSingle();  // tenant-safe: looks up one user's role by id
    const role = (u as { role: string } | null)?.role;
    return { actor: role === "admin" ? "admin" : role === "client" ? "client" : "system", userId };
  } catch { return { actor: "system", userId: null }; }
}

/** Called by chatComplete after every answered call. */
export async function recordAiUsage(model: string, inputTokens: number, outputTokens: number): Promise<void> {
  const ctx = als.getStore();
  try {
    const { error } = await db.from("ai_usage").insert({  // tenant-safe: insert carries the call's own tenant_id (or none)
      tenant_id: ctx?.tenantId ?? null, user_id: ctx?.userId ?? null,
      actor: ctx?.actor ?? "system", feature: ctx?.feature ?? "unattributed",
      model, input_tokens: inputTokens, output_tokens: outputTokens,
      cost_micros: costMicros(model, inputTokens, outputTokens),
    });
    if (error) console.error("[ai-usage] not recorded:", error.message);
  } catch (e) {
    console.error("[ai-usage] not recorded:", e instanceof Error ? e.message : e);
  }
}

/** Every client login of this tenant. Admins have no tenant, so they are never in it. */
async function clientUserIds(tenantId: string): Promise<string[]> {
  const { data } = await db.from("app_user").select("id").eq("tenant_id", tenantId).eq("role", "client");
  return ((data ?? []) as { id: string }[]).map(u => u.id);
}

/** The counts the chat limits need. Only client questions count. */
export async function chatCounts(tenantId: string, userId: string, now = new Date()) {
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const ids = await clientUserIds(tenantId);
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [minute, day, month, extra] = await Promise.all([
    count(db.from("chat_message").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("author_user_id", userId).eq("role", "user").gte("created_at", minuteAgo)),
    count(db.from("chat_message").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("author_user_id", userId).eq("role", "user").gte("created_at", dayAgo)),
    ids.length ? count(db.from("chat_message").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("role", "user").in("author_user_id", ids).gte("created_at", monthStart(now).toISOString())) : Promise.resolve(0),
    monthExtra(tenantId, now),
  ]);
  return { minute, day, month, monthExtra: extra };
}

/** Extra questions For Granted granted this client for this month. */
export async function monthExtra(tenantId: string, now = new Date()): Promise<number> {
  const { data, error } = await db.from("usage_grant").select("extra")
    .eq("tenant_id", tenantId).eq("kind", "chat_month").eq("period", monthKey(now));
  if (error) return 0;  // before migration 0051: no grants yet
  return ((data ?? []) as { extra: number }[]).reduce((n, g) => n + g.extra, 0);
}

/** How many times this client's own logins did something in the last 24 hours, from the audit log. */
export async function clientActionsLastDay(tenantId: string, action: string): Promise<number> {
  const ids = await clientUserIds(tenantId);
  if (!ids.length) return 0;
  const { count } = await db.from("audit_log").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("action", action).in("actor_user_id", ids)
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  return count ?? 0;
}

/** Readiness reads of this client's own uploads in the last 24 hours. */
export async function uploadReadsLastDay(tenantId: string): Promise<number> {
  const { count } = await db.from("audit_log").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("action", "upload_ai_read")
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  return count ?? 0;
}
