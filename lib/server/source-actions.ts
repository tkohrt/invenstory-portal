"use server";
// Switching a source Automatic, On or Off for a client, and For Granted's lock
// (patch 11 of the 1 November 2026 build). A public endpoint: it checks its
// caller and works only on the caller's own client.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { selfSearchOn } from "./client-view";
import { getSourceSettings } from "./sources";
import { isSourceId, isSourceMode, SOURCE_BY_ID, MODE_LABEL } from "@/lib/sources";

type Result = { ok: true } | { ok: false; error: string };

export async function setSourceAction(input: { source: string; mode: string; locked?: boolean }): Promise<Result> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  if (!isSourceId(input.source) || !isSourceMode(input.mode)) return { ok: false, error: "That could not be saved." };
  const def = SOURCE_BY_ID[input.source];
  if (def.fixed) return { ok: false, error: `${def.name} is always searched.` };
  const isAdmin = s.role === "admin";
  const current = (await getSourceSettings(s.tenantId))[input.source];
  if (!isAdmin) {
    if (!(await selfSearchOn(s.tenantId))) return { ok: false, error: "Your For Granted team chooses the sources for now." };
    if (current?.locked) return { ok: false, error: "For Granted has set this source. Ask your For Granted team to change it." };
  }
  // Only For Granted locks; a client's change keeps no lock.
  const locked = isAdmin ? !!input.locked : false;
  const row = {
    tenant_id: s.tenantId, source: input.source, mode: input.mode, locked,
    set_by: s.user.id, set_by_role: isAdmin ? "admin" : "client", updated_at: new Date().toISOString(),
  };
  // A client's write is guarded on the row still being unlocked, so a lock
  // For Granted sets between the check above and this write is never undone.
  const res = !isAdmin
    ? input.mode === "auto"
      ? await db.from("match_source_setting").delete().eq("tenant_id", s.tenantId).eq("source", input.source).eq("locked", false).select("source")
      : current
        ? await db.from("match_source_setting").update(row).eq("tenant_id", s.tenantId).eq("source", input.source).eq("locked", false).select("source")
        // tenant-safe: row.tenant_id is the session's own tenant (set above)
        : await db.from("match_source_setting").insert(row).select("source")
    : input.mode === "auto" && !locked
    // Automatic is the absence of a choice: nothing stored, so the profile decides.
    ? await db.from("match_source_setting").delete().eq("tenant_id", s.tenantId).eq("source", input.source)
    // tenant-safe: row.tenant_id is the session's own tenant (set above)
    : await db.from("match_source_setting").upsert(row, { onConflict: "tenant_id,source" });
  // A guarded write that touched nothing found the row locked meanwhile.
  if (!isAdmin && !res.error && current && Array.isArray(res.data) && res.data.length === 0) {
    revalidatePath("/funder-matches");
    return { ok: false, error: "For Granted has just set this source. Ask your For Granted team to change it." };
  }
  if (res.error) {
    console.error("[sources] save refused", res.error.message);
    return { ok: false, error: "That could not be saved. Please try again." };
  }
  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: s.tenantId, action: "match_source",
    detail: `${input.source}=${MODE_LABEL[input.mode]}${locked ? " (locked)" : ""}`,
  });
  revalidatePath("/funder-matches");
  return { ok: true };
}
