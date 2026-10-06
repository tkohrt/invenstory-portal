"use server";
// Asking for more, and For Granted's answer (the client AI limits, 6 October 2026).
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { getTenant } from "./data";
import { db } from "./db";
import { notifyUsageRequest } from "./notify";
import { monthKey } from "@/lib/usage-limits";

/** A client at a limit asks For Granted for more. One open request per client and kind. */
export async function requestMoreUsageAction(kind: "chat_month") {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  if (s.role === "admin") return { ok: true };  // admins are never limited
  if (kind !== "chat_month") throw new Error("Unknown request.");
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
    .eq("tenant_id", tenantId).eq("status", "pending");
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: "usage_grant", detail: `chat_month+${n}` });
  revalidatePath("/admin/clients", "layout");
}

export async function dismissUsageRequestAction(tenantId: string, id: string) {
  const s = await admin();
  const { error } = await db.from("usage_request").update({ status: "dismissed", decided_by: s.user.id, decided_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", id).eq("status", "pending");
  if (error) throw new Error(`Could not save that: ${error.message}`);
  revalidatePath("/admin/clients", "layout");
}
