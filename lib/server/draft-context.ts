import "server-only";
// The grant context box on the server (Auto-Draft patch 5; rules in
// lib/draft-context.ts). Access follows the draft: a draft the person can open
// through RLS (today For Granted only) is one whose context they can read and
// change. Every write goes through the service client scoped by tenant, after
// that check, like the rest of the drafter.
import { userClient } from "./supabase";
import { db } from "./db";
import { LOCKED_STATUSES, type DraftStatus } from "@/lib/draft-version";
import type { ContextPart, ContextSourceKind } from "@/lib/draft-context";

export interface ContextItem {
  id: string; part: ContextPart; title: string; kind: ContextSourceKind;
  url: string | null; hasFile: boolean; words: number; chars: number;
  addedBy: string | null; addedAt: string;
}

/**
 * The draft as this person can see it, or why not. Locked drafts (submitted,
 * won, lost) keep their context as it was.
 */
export async function draftForContext(tenantId: string, draftId: string, write: boolean):
  Promise<{ ok: true; draft: { id: string; tenant_id: string; status: string } } | { ok: false; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return { ok: false, error: "That draft could not be found." };
  const s = await userClient();
  const { data } = await s.from("grant_draft").select("id, tenant_id, status").eq("tenant_id", tenantId).eq("id", draftId).maybeSingle();
  const d = data as { id: string; tenant_id: string; status: string } | null;
  if (!d) return { ok: false, error: "That draft could not be found." };
  if (write && LOCKED_STATUSES.has(d.status as DraftStatus)) {
    return { ok: false, error: "This application is locked, so its grant context is kept as it was. Start a new version from it to change it." };
  }
  return { ok: true, draft: d };
}

/** A draft's context items, oldest first in each part. Empty (ready: false) before 0063. */
export async function getDraftContext(tenantId: string, draftId: string): Promise<{ ready: boolean; items: ContextItem[] }> {
  const s = await userClient();
  const { data, error } = await s.from("draft_context")
    .select("id, part, title, body, source_kind, source_url, storage_key, added_by, added_at")
    .eq("tenant_id", tenantId).eq("draft_id", draftId).order("added_at");
  if (error) return { ready: false, items: [] };
  type Row = { id: string; part: ContextPart; title: string; body: string; source_kind: ContextSourceKind; source_url: string | null; storage_key: string | null; added_by: string | null; added_at: string };
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map(r => r.added_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: us } = await db.from("app_user").select("id, full_name").in("id", ids);  // tenant-safe: names of the people who added these items, by id
    for (const u of (us ?? []) as { id: string; full_name: string }[]) names.set(u.id, u.full_name);
  }
  return {
    ready: true,
    items: rows.map(r => ({
      id: r.id, part: r.part, title: r.title, kind: r.source_kind, url: r.source_url, hasFile: !!r.storage_key,
      words: r.body.trim() ? r.body.trim().split(/\s+/).length : 0, chars: r.body.length,
      addedBy: r.added_by ? names.get(r.added_by) ?? null : null, addedAt: r.added_at,
    })),
  };
}
