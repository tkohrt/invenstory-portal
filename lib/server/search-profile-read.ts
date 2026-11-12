import "server-only";
// Reading the cached Search Profile.
//
// Deliberately NOT in the "use server" module beside the rebuild action. Every
// export of a "use server" file is a public endpoint, and this one takes a
// tenantId and returns verbatim quotes and document titles from that tenant's
// Inven(s)tory through the service-role client, which bypasses row-level
// security. As an action it would have been a cross-tenant read for anyone who
// could guess a uuid. It is a plain server module instead, callable only from
// server code that has already decided who is asking.
import { db } from "./db";
import {
  applyProfileEdits, documentFingerprint, factId,
  type Facet, type ProfileEdit, type ProfileFact, type SearchProfile,
} from "@/lib/search-profile";

export interface StoredProfile extends SearchProfile {
  note: string | null;
  /** True when documents have changed since this was built. */
  stale: boolean;
  /** How many lines a person has corrected, hidden or added. */
  edits: { hidden: number; edited: number; added: number };
}

/**
 * Corrections for one client.
 *
 * Read separately from the profile and merged over it, because the profile row
 * is rebuilt wholesale by every Rebuild. Anything written into it would be
 * erased by the next press of a button.
 */
export async function getProfileEdits(tenantId: string): Promise<ProfileEdit[]> {
  const { data, error } = await db.from("profile_edit")
    .select("fact_id, kind, text, facet, note, updated_at").eq("tenant_id", tenantId);
  if (error) throw new Error(`profile edits read failed: ${error.message}`);
  return ((data ?? []) as {
    fact_id: string; kind: "hide" | "edit" | "add";
    text: string | null; facet: string | null; note: string | null; updated_at: string;
  }[]).map(r => ({
    factId: r.fact_id, kind: r.kind, text: r.text,
    facet: (r.facet ?? null) as Facet | null, note: r.note, editedAt: r.updated_at,
  }));
}

/** The cached profile, and whether the Inven(s)tory has moved on since. */
export async function getSearchProfile(tenantId: string, opts?: { includeRemoved?: boolean }): Promise<StoredProfile | null> {
  const { data, error } = await db.from("search_profile")
    .select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`search profile read failed: ${error.message}`);
  if (!data) return null;

  const { data: docs } = await db.from("document")
    .select("id").eq("tenant_id", tenantId).eq("status", "ready");
  const row = data as {
    facts: ProfileFact[]; document_count: number; layers: string[];
    doc_fingerprint: string | null; note: string | null; generated_at: string;
  };

  // Corrections are applied HERE, in the one function everything reads through,
  // rather than at each call site. Matching and the panel then cannot disagree
  // about what the profile says, and a hidden line reaches no query by
  // construction instead of by remembering to filter it.
  const edits = await getProfileEdits(tenantId).catch(() => [] as ProfileEdit[]);
  const base = (row.facts ?? []) as ProfileFact[];

  // Client removals (patch 35, 0085) apply in the same single place, for the
  // same reason: a removed fact reaches no query by construction. Only the
  // matching-profile page asks to see them (struck through, with an Undo).
  let facts = applyProfileEdits(base, edits);
  const { data: rem } = await db.from("profile_fact_review")
    .select("fact_id").eq("tenant_id", tenantId).eq("state", "removed");
  const removedIds = new Set(((rem ?? []) as { fact_id: string }[]).map(r => r.fact_id));
  if (removedIds.size) {
    facts = opts?.includeRemoved
      ? facts.map(f => f.documentId && removedIds.has(factId(f)) ? { ...f, removed: true } : f)
      : facts.filter(f => !f.documentId || !removedIds.has(factId(f)));
  }

  return {
    facts,
    generatedAt: row.generated_at,
    documentCount: row.document_count,
    layers: (row.layers ?? []) as ("I" | "II" | "III")[],
    note: row.note,
    stale: documentFingerprint((docs ?? []) as { id: string }[]) !== row.doc_fingerprint,
    edits: {
      hidden: edits.filter(e => e.kind === "hide").length,
      edited: edits.filter(e => e.kind === "edit").length,
      added: edits.filter(e => e.kind === "add").length,
    },
  };
}
