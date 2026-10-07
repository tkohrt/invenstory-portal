"use server";
// Asking for more, and For Granted's answer (the client AI limits, 6 October 2026).
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { getTenant } from "./data";
import { db } from "./db";
import { notifyUsageRequest } from "./notify";
import { monthKey } from "@/lib/usage-limits";
import { centsFromDollars, usdFromCents } from "@/lib/allowance";

type RequestKind = "chat_month" | "ai_month";

/** A client at a limit asks For Granted for more. One open request per client and kind. */
export async function requestMoreUsageAction(kind: RequestKind) {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  if (s.role === "admin") return { ok: true };  // admins are never limited
  if (kind !== "chat_month" && kind !== "ai_month") throw new Error("Unknown request.");
  const { data: open } = await db.from("usage_request").select("id")
    .eq("tenant_id", s.tenantId).eq("kind", kind).eq("status", "pending").limit(1);
  if (open?.length) return { ok: true, already: true };
  const { error } = await db.from("usage_request").insert({ tenant_id: s.tenantId, user_id: s.user.id, kind });
  if (error) throw new Error(`Could not send the request: ${error.message}`);
  const tenant = await getTenant(s.tenantId);
  await notifyUsageRequest({ org: tenant?.name ?? "A client", requester: s.user.full_name ?? "A client user", kind });
  revalidatePath("/admin/clients", "layout");
  return { ok: true, already: false };
}

async function admin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("For Granted only.");
  return s;
}

/** Give a client more chat questions for this month, answering any open request from them. */
export async function grantChatAction(tenantId: string, extra: number, note?: string | null) {
  const s = await admin();
  const n = Math.round(Number(extra));
  if (!Number.isFinite(n) || n < 1 || n > 10_000) throw new Error("Choose a number of questions between 1 and 10,000.");
  const { error } = await db.from("usage_grant").insert({
    tenant_id: tenantId, kind: "chat_month", period: monthKey(new Date()), extra: n,
    note: note?.trim() ? note.trim().slice(0, 500) : null, granted_by: s.user.id,
  });
  if (error) throw new Error(`Could not save the grant: ${error.message}`);
  await db.from("usage_request").update({ status: "granted", decided_by: s.user.id, decided_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("kind", "chat_month").eq("status", "pending");
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: "usage_grant", detail: `chat_month+${n}` });
  revalidatePath("/admin/clients", "layout");
}

/**
 * Give a client more AI allowance for this month (Phase D), answering any open
 * request for it. `dollars` as typed: "10", "$12.50".
 */
export async function grantAllowanceAction(tenantId: string, dollars: string | number, note?: string | null) {
  const s = await admin();
  const cents = centsFromDollars(dollars);
  if (cents === null) throw new Error("Enter an amount between $0.01 and $10,000.");
  const { error } = await db.from("usage_grant").insert({
    tenant_id: tenantId, kind: "ai_month", period: monthKey(new Date()), extra: cents,
    note: note?.trim() ? note.trim().slice(0, 500) : null, granted_by: s.user.id,
  });
  if (error) throw new Error(`Could not save the grant: ${error.message}`);
  await db.from("usage_request").update({ status: "granted", decided_by: s.user.id, decided_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("kind", "ai_month").eq("status", "pending");
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: "usage_grant", detail: `ai_month+${usdFromCents(cents)}` });
  revalidatePath("/admin/clients", "layout");
}

/**
 * Change a client's monthly AI allowance and hard ceiling, from this month on.
 * The allowance is the soft line (past it nothing stops; For Granted is
 * alerted). A blank ceiling means 2x the allowance. Zero for both means every
 * interactive step needs a grant.
 */
export async function setAllowanceAction(tenantId: string, dollars: string | number, ceilingDollars?: string | number | null, note?: string | null) {
  const s = await admin();
  const cents = centsFromDollars(dollars, { allowZero: true });
  if (cents === null) throw new Error("Enter an allowance between $0 and $10,000.");
  let ceiling: number | null = null;
  if (ceilingDollars !== undefined && ceilingDollars !== null && String(ceilingDollars).trim() !== "") {
    ceiling = centsFromDollars(ceilingDollars, { allowZero: true });
    if (ceiling === null) throw new Error("Enter a hard limit between $0 and $10,000, or leave it blank for twice the allowance.");
    if (ceiling < cents) throw new Error("The hard limit can't be below the allowance.");
  }
  const { error } = await db.from("ai_allowance").upsert({
    tenant_id: tenantId, monthly_cents: cents, ceiling_cents: ceiling, note: note?.trim() ? note.trim().slice(0, 500) : null,
    updated_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });
  if (error) throw new Error(`Could not save the allowance: ${error.message}`);
  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: tenantId, action: "allowance_set",
    detail: `${usdFromCents(cents)}, limit ${ceiling === null ? "2x" : usdFromCents(ceiling)}`,
  });
  revalidatePath("/admin/clients", "layout");
}

export async function dismissUsageRequestAction(tenantId: string, id: string) {
  const s = await admin();
  const { error } = await db.from("usage_request").update({ status: "dismissed", decided_by: s.user.id, decided_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", id).eq("status", "pending");
  if (error) throw new Error(`Could not save that: ${error.message}`);
  revalidatePath("/admin/clients", "layout");
}
