import "server-only";
import { db } from "./db";

/**
 * Save for later (patch 26): the star bucket. Unlike eligible_grant this is
 * not a run snapshot. Sweeps never touch it, so a saved grant still renders
 * after the run that produced it is gone, which is the entire point: "put the
 * grants into a bucket that can be surfaced when those applications are open
 * again" (Shane, 7 Nov walkthrough).
 */
export interface SavedItem {
  kind: "grant" | "funder" | "rfp";
  target_id: string;
  title: string | null;
  /** Display snapshot at save time. Never authoritative; a live row wins. */
  detail: { funder?: string | null; url?: string | null; close_date?: string | null; award_ceiling?: number | null; terms?: string | null; money_kind?: string | null };
  saved_at: string;
  /** Whether this item may raise notices (patch 66, 0099). Shared by the client's team. */
  updates: boolean;
  /** The reopen stamp (patch 28, 0083): set when a run finds this saved grant
      open again after its saved close date passed; cleared when it closes. */
  reopened_at: string | null;
  reopened_detail: { grant_id?: string | null; title?: string | null; close_date?: string | null; url?: string | null; award_ceiling?: number | null };
}

export async function getSavedItems(tenantId: string): Promise<SavedItem[]> {
  const read = (cols: string) => db.from("saved_item").select(cols).eq("tenant_id", tenantId).order("saved_at", { ascending: false });
  let { data, error } = await read("kind, target_id, title, detail, saved_at, reopened_at, reopened_detail, updates");
  // Before migration 0099 there is no `updates` column: read without it, so a
  // deploy ahead of the migration never empties anyone's saved list.
  if (error && /updates/i.test(error.message)) ({ data, error } = await read("kind, target_id, title, detail, saved_at, reopened_at, reopened_detail"));
  // A failed read renders as an empty bucket rather than a broken page: the
  // star still works, and the next load shows what it wrote.
  if (error) { console.error("[saved] read failed", error); return []; }
  return ((data ?? []) as unknown as (Omit<SavedItem, "updates"> & { updates?: boolean | null })[]).map(r => ({ ...r, updates: r.updates !== false }));
}
