"use server";
// Curated list sweeps (P2.5, patch 39): the admin's load/sweep/membership
// verbs, and the client's one verb — asking For Granted to start a draft,
// which lands in the Requests inbox (patch 37) rather than anyone's memory.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { createCuratedList, sweepCuratedList } from "./curated";
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

export async function sweepCuratedListAction(listId: string): Promise<Result<{ entries: number; tenants: number; matches: number; skipped: number }>> {
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
  // Only an entry this tenant was actually matched with can be asked about.
  const { data } = await db.from("curated_match").select("id").eq("tenant_id", s.tenantId).eq("overlay_id", overlayId).maybeSingle();
  if (!data) return { ok: false, error: "That opportunity is not on your list." };
  const { data: t } = await db.from("tenant").select("name").eq("id", s.tenantId).maybeSingle();
  await notifyClientRequest({
    org: (t as { name: string } | null)?.name ?? "A client", requester: s.user.full_name,
    what: `asked For Granted to start a draft for the curated opportunity "${title.slice(0, 200)}".`,
    tenantId: s.tenantId,
    inbox: { kind: "draft_request", sourceKey: `draft:${overlayId}` },
  });
  return { ok: true };
}
