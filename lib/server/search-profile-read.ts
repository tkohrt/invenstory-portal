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
import { documentFingerprint, type ProfileFact, type SearchProfile } from "@/lib/search-profile";

export interface StoredProfile extends SearchProfile {
  note: string | null;
  /** True when documents have changed since this was built. */
  stale: boolean;
}

/** The cached profile, and whether the Inven(s)tory has moved on since. */
export async function getSearchProfile(tenantId: string): Promise<StoredProfile | null> {
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

  return {
    facts: (row.facts ?? []) as ProfileFact[],
    generatedAt: row.generated_at,
    documentCount: row.document_count,
    layers: (row.layers ?? []) as ("I" | "II" | "III")[],
    note: row.note,
    stale: documentFingerprint((docs ?? []) as { id: string }[]) !== row.doc_fingerprint,
  };
}
