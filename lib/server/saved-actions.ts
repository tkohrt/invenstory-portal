"use server";
import { getSession } from "./session";
import { db } from "./db";
import { revalidatePath } from "next/cache";
import { getFeatureVisible } from "./data";
import { getJudgments } from "./triage";
import { suppresses } from "@/lib/triage";

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
  detail?: { funder?: string | null; url?: string | null; close_date?: string | null; award_ceiling?: number | null; terms?: string | null; money_kind?: string | null };
}): Promise<{ saved: boolean } | { error: string }> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  // Grants only (review of patch 66). A funder is followed through
  // toggleFollowFunderAction, which reads the funder from this client's own
  // match record; here the snapshot comes from the browser, and a funder row
  // built that way could name anything on the team's shared list.
  if (input.kind !== "grant") return { error: "Follow a funder from its page on Funding." };
  const kind = "grant" as const;
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
      // Patch 62: an accelerator's stated deal, so a saved one never reads as an award.
      terms: typeof d.terms === "string" && d.terms.trim() ? d.terms.trim().slice(0, 240) : null,
      // Patch 66: what kind of money, so the Following list can call an accelerator an accelerator.
      money_kind: d.money_kind === "programs" || d.money_kind === "contracts" || d.money_kind === "grants" ? d.money_kind : null,
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

const FOLLOW_KINDS = ["grant", "funder", "rfp"] as const;
type Kind = (typeof FOLLOW_KINDS)[number];
const kindOf = (k: unknown): Kind | null => (FOLLOW_KINDS as readonly string[]).includes(String(k)) ? k as Kind : null;

/**
 * Follow or unfollow a funder (patch 66). Only a funder this client was
 * actually matched with can be followed, and what is kept is read from that
 * match record, never from the browser. The list is the team's: anyone on the
 * client's account, or For Granted on its behalf, may add or remove.
 */
export async function toggleFollowFunderAction(funderId: string): Promise<{ following: boolean } | { error: string }> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  const id = String(funderId ?? "").slice(0, 200);
  if (!id) return { error: "Nothing to follow." };
  const { data: existing, error: readErr } = await db.from("saved_item")
    .select("target_id").eq("tenant_id", s.tenantId).eq("kind", "funder").eq("target_id", id).maybeSingle();
  if (readErr) { console.error("[saved] follow read failed", readErr); return { error: "Could not check your Following list. Try again." }; }
  if (existing) {
    const { error } = await db.from("saved_item").delete().eq("tenant_id", s.tenantId).eq("kind", "funder").eq("target_id", id);
    if (error) return { error: "Could not unfollow. Try again." };
    revalidatePath("/following");
    return { following: false };
  }
  // A client may follow only what its dossier would show it (review of patch
  // 66): Funders mode on, and not a funder For Granted ruled out. The refusal
  // reads the same as "not matched", so nothing is learned from trying ids.
  if (s.role !== "admin") {
    const NOT_YOURS = { error: "That funder is not on your Funding page." };
    if (!(await getFeatureVisible(s.tenantId, "funder_compass"))) return NOT_YOURS;
    const j = (await getJudgments(s.tenantId).catch(() => new Map())).get(`funder:${id}`);
    if (j && suppresses(j.state)) return NOT_YOURS;
  }
  const { data: f } = await db.from("matched_funder").select("funder_id, name, website")
    .eq("tenant_id", s.tenantId).eq("funder_id", id).maybeSingle();
  const funder = f as { funder_id: string; name: string | null; website: string | null } | null;
  if (!funder) return { error: "That funder is not on your Funding page." };
  const { error } = await db.from("saved_item").insert({
    tenant_id: s.tenantId, kind: "funder", target_id: funder.funder_id, title: (funder.name ?? "").slice(0, 400) || null,
    detail: { url: typeof funder.website === "string" && /^https?:\/\//i.test(funder.website) ? funder.website.slice(0, 500) : null },
    saved_by: s.user.id,
  });
  if (error) { console.error("[saved] follow failed", error); return { error: "Could not follow. Try again." }; }
  revalidatePath("/following");
  return { following: true };
}

/** Turn one followed item's updates on or off (patch 66). The switch is the team's, like the list. */
export async function setFollowUpdatesAction(kind: string, targetId: string, on: boolean): Promise<{ ok: true } | { error: string }> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  const k = kindOf(kind);
  if (!k) return { error: "That is not on your list." };
  const { error } = await db.from("saved_item").update({ updates: !!on })
    .eq("tenant_id", s.tenantId).eq("kind", k).eq("target_id", String(targetId).slice(0, 200));
  if (error) {
    console.error("[saved] updates switch failed (is migration 0099 applied?)", error);
    return { error: s.role === "admin" ? "That did not save. Has migration 0099 been applied?" : "That did not save. Try again in a moment." };
  }
  revalidatePath("/following"); revalidatePath("/funding");
  return { ok: true };
}

/** Take one item off the Following list (patch 66). */
export async function unfollowAction(kind: string, targetId: string): Promise<{ ok: true } | { error: string }> {
  const s = await getSession();
  if (!s) return { error: "Not signed in." };
  const k = kindOf(kind);
  if (!k) return { error: "That is not on your list." };
  const { error } = await db.from("saved_item").delete()
    .eq("tenant_id", s.tenantId).eq("kind", k).eq("target_id", String(targetId).slice(0, 200));
  if (error) { console.error("[saved] unfollow failed", error); return { error: "Could not remove it. Try again." }; }
  revalidatePath("/following"); revalidatePath("/funding");
  return { ok: true };
}
