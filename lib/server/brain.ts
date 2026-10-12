import "server-only";
// The Brain on the server (Auto-Draft patch 3; rules in lib/brain.ts).
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "./db";
import { isBrain } from "@/lib/brain";

/**
 * Whether this tenant is the Brain. Every column is read (not a list), so it
 * answers "no" before 0061 is run rather than failing. Cached per request.
 */
export const tenantIsBrain = cache(async (tenantId: string): Promise<boolean> => {
  const { data } = await db.from("tenant").select("*").eq("id", tenantId).maybeSingle();
  return isBrain(data as { is_brain?: boolean | null } | null);
});

/**
 * A page about a client's funding (eligibility, matches, the plant, drafts,
 * Story Intelligence, Story Cards, the Readiness Audit) is closed in the Brain:
 * it sends For Granted back to the Brain's documents.
 */
export async function closedInBrain(tenantId: string): Promise<void> {
  if (await tenantIsBrain(tenantId)) redirect("/invenstory?brain=closed");
}
