"use server";
import { getSession } from "./session";
import { db } from "./db";

/**
 * The save-for-later star (patch 26). One action toggles: saved rows are
 * removed, unsaved rows are inserted with a small display snapshot so the
 * bucket still renders after the source row is swept.
 *
 * Both roles may save: a client bookmarks for themselves, and For Granted can
 * seed a client's bucket while preparing their page. Everything is scoped to
 * the session's tenant; the detail snapshot is rebuilt from named fields, so
 * nothing a caller sends is stored verbatim beyond them.
 */
export async function toggleSavedAction(input: {
  kind: "grant" | "funder";
  target_id: string;
  title?: string | null;
  detail?: { funder?: string | null; url?: string | null; close_date?: string | null; award_ceiling?: number | null };
}): Promise<{ saved: boolean } | { error: string }> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  const kind = input.kind === "funder" ? "funder" : "grant";
  const targetId = String(input.target_id ?? "").slice(0, 200);
  if (!targetId) return { error: "Nothing to save." };

  // tenant-safe: every query below filters by the session's tenant_id.
  const { data: existing, error: readErr } = await db.from("saved_item")
    .select("target_id").eq("tenant_id", s.tenantId).eq("kind", kind).eq("target_id", targetId).maybeSingle();
  if (readErr) { console.error("[saved] toggle read failed", readErr); return { error: "Could not check the saved list. Try again." }; }

  if (existing) {
    const { error } = await db.from("saved_item")
      .delete().eq("tenant_id", s.tenantId).eq("kind", kind).eq("target_id", targetId);
    if (error) { console.error("[saved] delete failed", error); return { error: "Could not remove it. Try again." }; }
    return { saved: false };
  }

  const d = input.detail ?? {};
  const { error } = await db.from("saved_item").insert({
    tenant_id: s.tenantId, kind, target_id: targetId,
    title: input.title?.slice(0, 400) ?? null,
    detail: {
      funder: d.funder?.slice(0, 200) ?? null,
      url: typeof d.url === "string" && /^https?:\/\//i.test(d.url) ? d.url.slice(0, 500) : null,
      close_date: d.close_date?.slice(0, 40) ?? null,
      award_ceiling: typeof d.award_ceiling === "number" && isFinite(d.award_ceiling) ? d.award_ceiling : null,
    },
    saved_by: s.user.id,
  });
  if (error) {
    // The table arrives with migration 0081; before it runs, the star should
    // say so rather than pretend.
    console.error("[saved] insert failed", error);
    return { error: "Could not save it. Try again." };
  }
  return { saved: true };
}
