import "server-only";
import { db } from "./db";

/** One fact's review state on the matching-profile page (patch 34). */
export interface FactReview { state: "confirmed" | "flagged" | "removed"; note: string | null; at: string }

export async function getFactReviews(tenantId: string): Promise<Map<string, FactReview>> {
  const { data, error } = await db.from("profile_fact_review")
    .select("fact_id, state, note, at")
    .eq("tenant_id", tenantId);
  // Empty reviews beat a broken page; stamps are a convenience, never content.
  if (error) { console.error("[profile-review] read failed", error); return new Map(); }
  return new Map(((data ?? []) as { fact_id: string; state: "confirmed" | "flagged" | "removed"; note: string | null; at: string }[])
    .map(r => [r.fact_id, { state: r.state, note: r.note, at: r.at }]));
}
