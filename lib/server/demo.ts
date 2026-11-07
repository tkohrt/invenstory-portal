import "server-only";
// The Demo Client's reset (7 November 2026). Rules and table list in
// lib/demo.ts; called from signInAction on every client sign-in to a tenant
// named in DEMO_TENANT_IDS. Full wipe: storage files, every content table,
// the tours and reminders, and the setup row (deleting it sends the next
// sign-in into company setup from a blank start, as a client made after
// 0077 that has not begun). Logins, settings and the audit log are kept.

import { db } from "./db";
import { isDemoTenant, DEMO_WIPE_TABLES, stripFirstRunPrefs } from "@/lib/demo";

/** Every file under {tenantId}/ in the private documents bucket. */
async function storageKeys(tenantId: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const { data, error } = await db.storage.from("documents").list(prefix, { limit: 1000 });
    if (error || !data) return;
    for (const e of data) {
      const path = `${prefix}/${e.name}`;
      // A folder has no id; a file does.
      if (e.id) out.push(path);
      else await walk(path, depth + 1);
    }
  };
  await walk(tenantId, 1);
  return out;
}

/**
 * Wipe the demo tenant back to day one. Refuses any tenant not named in
 * DEMO_TENANT_IDS, however it is called. Best-effort throughout: a partial
 * reset must never stop the sign-in, so failures are logged, not thrown.
 */
export async function resetDemoTenant(tenantId: string): Promise<void> {
  if (!isDemoTenant(tenantId)) return;

  // 1. Storage: every uploaded file.
  try {
    const keys = await storageKeys(tenantId);
    for (let i = 0; i < keys.length; i += 100) {
      await db.storage.from("documents").remove(keys.slice(i, i + 100));
    }
  } catch (e) {
    console.error("[demo] storage wipe failed", e instanceof Error ? e.message : e);
  }

  // 2. Content tables, referencing tables first. A second pass catches any
  // delete that failed because its referencing rows went in the first pass.
  const failed: string[] = [];
  const wipe = async (tables: readonly string[], into: string[] | null) => {
    for (const table of tables) {
      // tenant-safe: every delete is scoped to the demo tenant's id, which isDemoTenant has just verified against DEMO_TENANT_IDS
      const { error } = await db.from(table).delete().eq("tenant_id", tenantId);
      if (error) {
        if (into) into.push(table);
        else console.error(`[demo] wipe of ${table} failed`, error.message);
      }
    }
  };
  await wipe(DEMO_WIPE_TABLES, failed);
  if (failed.length) await wipe(failed, null);

  // 3. Tours and "don't ask again" boxes, for every demo login.
  const { data: users } = await db.from("app_user").select("id, ui_prefs").eq("tenant_id", tenantId);
  for (const u of (users ?? []) as { id: string; ui_prefs: Record<string, unknown> | null }[]) {
    const prefs = stripFirstRunPrefs(u.ui_prefs);
    if (JSON.stringify(prefs) === JSON.stringify(u.ui_prefs ?? null)) continue;
    await db.from("app_user").update({ ui_prefs: prefs }).eq("tenant_id", tenantId).eq("id", u.id);
  }

  // 4. Say so, so the admin page's history explains the empty account.
  await db.from("audit_log").insert({ tenant_id: tenantId, action: "demo_reset", detail: "demo tenant wiped on sign-in" });
}
