import "server-only";
// The monthly AI allowance: what a client has used and may still use.
// The rules are pure, in lib/allowance.ts; this only reads the numbers.
//
// A plain server module, not "use server": these take a tenant id, so none of
// them may be a public endpoint. Callers have already decided who is asking.
import { db } from "./db";
import { getTenant } from "./data";
import { notifyAllowance } from "./notify";
import {
  ALLOWANCE, IN_FLIGHT_MINUTES, decideAllowance, levelOf, usdFromCents, lineMicros, ceilingMicros, MICROS_PER_CENT,
  type AllowanceDecision, type AllowanceState, type StepKind,
} from "@/lib/allowance";
import { monthKey, monthStart, type Actor } from "@/lib/usage-limits";

/** Client-caused spend since `since`, in millionths of a dollar. */
async function clientSpend(tenantId: string, since: Date): Promise<number> {
  // One sum in the database (migration 0054). Before it exists, add the rows up here.
  const { data, error } = await db.rpc("client_ai_spend_micros", { p_tenant: tenantId, p_since: since.toISOString() });
  if (!error && data !== null && data !== undefined) return Number(data) || 0;
  const { data: rows } = await db.from("ai_usage").select("cost_micros")
    .eq("tenant_id", tenantId).eq("actor", "client").gte("created_at", since.toISOString()).limit(50_000);
  return ((rows ?? []) as { cost_micros: number }[]).reduce((n, r) => n + Number(r.cost_micros), 0);
}

/** The client's monthly allowance and ceiling in cents: For Granted's settings, or the defaults. */
export async function allowanceSettings(tenantId: string): Promise<{ monthlyCents: number; ceilingCents: number | null }> {
  const { data, error } = await db.from("ai_allowance").select("monthly_cents, ceiling_cents").eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return { monthlyCents: ALLOWANCE.defaultCents, ceilingCents: null };  // before migration 0054, or never changed
  const r = data as { monthly_cents: number; ceiling_cents: number | null };
  return { monthlyCents: r.monthly_cents, ceilingCents: r.ceiling_cents ?? null };
}

/** Extra granted for this month, in cents. */
async function extraCents(tenantId: string, now: Date): Promise<number> {
  const { data, error } = await db.from("usage_grant").select("extra")
    .eq("tenant_id", tenantId).eq("kind", "ai_month").eq("period", monthKey(now));
  if (error) return 0;
  return ((data ?? []) as { extra: number }[]).reduce((n, g) => n + g.extra, 0);
}

export async function allowanceState(tenantId: string, now = new Date()): Promise<AllowanceState> {
  const [spentMicros, settings, extra] = await Promise.all([
    clientSpend(tenantId, monthStart(now)), allowanceSettings(tenantId), extraCents(tenantId, now),
  ]);
  return { spentMicros, monthlyCents: settings.monthlyCents, ceilingCents: settings.ceilingCents, extraCents: extra };
}

/**
 * May this person start a step for this client now? Admins are never limited
 * and cost no reads. Crossing the allowance or the ceiling alerts For Granted,
 * once each a month. If the numbers cannot be read at all, the step is
 * allowed: the allowance guards against runaway spend, and a database hiccup
 * should not lock a client out of their own Inven(s)tory.
 */
export async function checkAllowance(
  actor: Actor, tenantId: string, step: { kind: StepKind; inFlight?: boolean } = { kind: "interactive" },
): Promise<AllowanceDecision> {
  if (actor === "admin") return { ok: true, unlimited: true };
  try {
    const now = new Date();
    const state = await allowanceState(tenantId, now);
    const level = levelOf(state);
    if (level === "over" || level === "ceiling") await alertOnce(tenantId, level, state, now);
    return decideAllowance(actor, state, step);
  } catch (e) {
    console.error("[allowance] could not be read; allowing", e instanceof Error ? e.message : e);
    return { ok: true, level: "fine", warning: null };
  }
}

/**
 * Tell For Granted (Slack and info@forgranted.com) the first time this month a
 * client passes its allowance, and the first time it reaches its ceiling. The
 * audit log is the record that it was sent. Best-effort: never stops the step.
 */
async function alertOnce(tenantId: string, level: "over" | "ceiling", state: AllowanceState, now: Date): Promise<void> {
  try {
    const detail = `${monthKey(now)}:${level}`;
    const { data: sent } = await db.from("audit_log").select("id")
      .eq("tenant_id", tenantId).eq("action", "allowance_alert").eq("detail", detail).limit(1);
    if (sent?.length) return;
    await db.from("audit_log").insert({ tenant_id: tenantId, action: "allowance_alert", detail });
    const tenant = await getTenant(tenantId);
    const cents = (m: number) => usdFromCents(Math.round(m / MICROS_PER_CENT));
    await notifyAllowance({
      org: tenant?.name ?? "A client", level,
      spent: cents(state.spentMicros), line: cents(lineMicros(state)), ceiling: cents(ceilingMicros(state)),
    });
  } catch (e) {
    console.error("[allowance] alert not sent", e instanceof Error ? e.message : e);
  }
}

/** Is this chat conversation under way: a question in it within IN_FLIGHT_MINUTES? */
export async function conversationInFlight(tenantId: string, sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false;
  const since = new Date(Date.now() - IN_FLIGHT_MINUTES * 60_000).toISOString();
  const { data } = await db.from("chat_message").select("id")
    .eq("tenant_id", tenantId).eq("session_id", sessionId).eq("role", "user").gte("created_at", since).limit(1);
  return !!data?.length;
}

/** Is a request for more already waiting? */
export async function pendingAllowanceRequest(tenantId: string): Promise<boolean> {
  const { data } = await db.from("usage_request").select("id")
    .eq("tenant_id", tenantId).eq("kind", "ai_month").eq("status", "pending").limit(1);
  return !!data?.length;
}
