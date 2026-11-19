"use server";
// Curated list sweeps (P2.5, patch 39): the admin's load/sweep/membership
// verbs, and the client's one verb — asking For Granted to start a draft,
// which lands in the Requests inbox (patch 37) rather than anyone's memory.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { createCuratedList, sweepCuratedList, sweepSignalEntries, visibleEntry } from "./curated";
import { curatedCard } from "@/lib/curated";
import { notifyClientRequest } from "./notify";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function admin() {
  const s = await getSession();
  if (!s) return null;
  if (s.role !== "admin") return null;
  return s;
}

export async function createCuratedListAction(a: { name: string; sourceUrl: string; contextNote: string; pasted: string }): Promise<Result<{ listId: string; entries: number }>> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  if (!a.name.trim()) return { ok: false, error: "Give the list a name." };
  if (a.pasted.trim().length < 20) return { ok: false, error: "Paste the list itself (titles, funders, links, deadlines)." };
  const r = await createCuratedList({
    name: a.name.trim(), sourceUrl: a.sourceUrl.trim() || null,
    contextNote: a.contextNote.trim() || null, pasted: a.pasted, userId: s.user.id,
  });
  if (r.ok) revalidatePath("/admin/reviews");
  return r;
}

export async function sweepCuratedListAction(listId: string): Promise<Result<{ entries: number; tenants: number; matches: number; skipped: number; notSought: number }>> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  const r = await sweepCuratedList(listId);
  if (r.ok) revalidatePath("/admin/reviews");
  return r;
}

export async function setCommunityMemberAction(tenantId: string, member: boolean): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  const { error } = await db.from("tenant").update({ community_member: member }).eq("id", tenantId);
  if (error) return { ok: false, error: "That did not save. Has migration 0087 been applied?" };
  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: tenantId, action: "community_member",
    detail: member ? "joined the community sweep list" : "left the community sweep list",
  });
  revalidatePath("/admin/reviews");
  return { ok: true };
}

/** A matched client asks For Granted to start a draft for a curated entry. */
export async function requestCuratedDraftAction(overlayId: string, title: string): Promise<Result> {
  const s = await getSession();
  if (!s) return { ok: false, error: "You are signed out. Sign in and try again." };
  if (s.role !== "client") return { ok: false, error: "The as-client preview cannot send requests." };
  // Only an entry this tenant was actually matched with, and may see, can be
  // asked about (patch 67: a match on an entry still waiting unseen is on
  // file, and must not be reachable by its id).
  const entry = await visibleEntry(s.tenantId, String(overlayId));
  if (!entry) return { ok: false, error: "That opportunity is not on your list." };
  const { data: t } = await db.from("tenant").select("name").eq("id", s.tenantId).maybeSingle();
  // The title is read from the entry, not taken from the browser.
  const name = (typeof entry.fields?.title === "string" && entry.fields.title.trim() ? entry.fields.title : title).slice(0, 200);
  await notifyClientRequest({
    org: (t as { name: string } | null)?.name ?? "A client", requester: s.user.full_name,
    what: `asked For Granted to start a draft for the curated opportunity "${name}".${entry.reviewed ? "" : " It has not been reviewed yet: it is at the top of the Ground Truth queue."}`,
    tenantId: s.tenantId,
    inbox: { kind: "draft_request", sourceKey: `draft:${overlayId}` },
  });
  return { ok: true };
}

/**
 * Add a curated entry to the client's Following list, or take it off (patch
 * 67). Anyone on the client's team, or For Granted on its behalf. What is
 * kept is read from the entry itself, never from the browser. An entry nobody
 * at For Granted has reviewed can be followed too: the list shows it with the
 * same label, and following it moves it to the top of the review queue.
 */
export async function toggleCuratedFollowAction(overlayId: string): Promise<{ ok: true; following: boolean } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "You are signed out. Sign in and try again." };
  const id = String(overlayId ?? "").slice(0, 200);
  if (!id) return { ok: false, error: "Nothing to follow." };
  const { data: existing, error: readErr } = await db.from("saved_item")
    .select("target_id").eq("tenant_id", s.tenantId).eq("kind", "grant").eq("target_id", id).maybeSingle();
  if (readErr) return { ok: false, error: "Could not check your Following list. Try again." };
  if (existing) {
    const { error } = await db.from("saved_item").delete().eq("tenant_id", s.tenantId).eq("kind", "grant").eq("target_id", id);
    if (error) return { ok: false, error: "Could not remove it. Try again." };
    revalidatePath("/following"); revalidatePath("/funding");
    return { ok: true, following: false };
  }
  const entry = await visibleEntry(s.tenantId, id);
  if (!entry) return { ok: false, error: "That opportunity is not on your list." };
  const c = curatedCard(entry.fields);
  const { error } = await db.from("saved_item").insert({
    tenant_id: s.tenantId, kind: "grant", target_id: id, title: (c.title ?? "").slice(0, 400) || null,
    detail: {
      funder: c.agency?.slice(0, 200) ?? null,
      url: typeof c.website === "string" && /^https?:\/\//i.test(c.website) ? c.website.slice(0, 500) : null,
      close_date: c.close_date?.slice(0, 40) ?? null,
      award_ceiling: typeof c.max_award === "number" && isFinite(c.max_award) ? c.max_award : null,
      terms: c.investment_terms?.trim().slice(0, 240) || null,
      money_kind: c.money_kind === "programs" || c.money_kind === "contracts" || c.money_kind === "grants" ? c.money_kind : null,
    },
    saved_by: s.user.id,
  });
  if (error) { console.error("[curated] follow failed", error); return { ok: false, error: "Could not add it. Try again." }; }
  revalidatePath("/following"); revalidatePath("/funding");
  return { ok: true, following: true };
}

/** Screen community members against what the signals sources produced, now (patch 67). The run does this itself twice a week. */
export async function matchSignalsNowAction(): Promise<Result<{ message: string }>> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  const r = await sweepSignalEntries(Date.now() + 45_000);
  if (!r.ok) return r;
  revalidatePath("/admin/reviews");
  const n = (c: number, one: string, many: string) => `${c} ${c === 1 ? one : many}`;
  return { ok: true, message: !r.entries ? "There are no open opportunities from the sources to screen."
    : !r.tenants ? `${n(r.entries, "open opportunity", "open opportunities")} from the sources, and no community members to screen them for. Tick members under Curated lists on the Ground Truth tab.`
    : `Screened ${n(r.tenants, "community member", "community members")} against ${n(r.entries, "open opportunity", "open opportunities")}: ${n(r.matches, "new match", "new matches")}.${r.unfinished ? " It ran out of time; press again to finish." : ""}` };
}
