"use server";
// For Granted's judgments in the card-quality review of the trial analysis.
//
// EVERY export of a "use server" module is a public endpoint, so none of these
// take a tenant id: the tenant comes from the session and every write is
// scoped to it. Admin-only.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";

const PATH = "/admin/analysis";

async function adminSession() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

export interface ReviewInput {
  fingerprint: string;
  documentId: string | null;
  kind: string;
  statement: string;
  quote: string;
  verdict: "supported" | "partly" | "unsupported";
  competitor: boolean;
  duplicate: boolean;
  note?: string | null;
}

/** Record (or change) one card's review. The card itself is stored with it, as judged. */
export async function saveReviewAction(r: ReviewInput) {
  const s = await adminSession();
  if (!["supported", "partly", "unsupported"].includes(r.verdict)) throw new Error("Choose supported, partly or unsupported.");
  if (!r.fingerprint || r.fingerprint.length > 200) throw new Error("That card could not be identified.");
  // The document must be this client's, or the reference is dropped.
  let documentId: string | null = null;
  if (r.documentId) {
    const { data } = await db.from("document").select("id").eq("tenant_id", s.tenantId).eq("id", r.documentId).maybeSingle();
    documentId = (data?.id as string | undefined) ?? null;
  }
  const { error } = await db.from("analysis_review").upsert({
    tenant_id: s.tenantId, fingerprint: r.fingerprint, document_id: documentId,
    kind: r.kind.slice(0, 60), statement: r.statement.slice(0, 2000), quote: r.quote.slice(0, 2000),
    verdict: r.verdict, competitor: !!r.competitor, duplicate: !!r.duplicate,
    note: r.note?.trim() ? r.note.trim().slice(0, 1000) : null,
    reviewed_by: s.user.id, reviewed_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,fingerprint" });
  if (error) throw new Error(`could not save the review: ${error.message}`);
  revalidatePath(PATH);
}

/** Take a review back, so the card counts as unreviewed. */
export async function clearReviewAction(fingerprint: string) {
  const s = await adminSession();
  const { error } = await db.from("analysis_review").delete().eq("tenant_id", s.tenantId).eq("fingerprint", fingerprint);
  if (error) throw new Error(`could not clear the review: ${error.message}`);
  revalidatePath(PATH);
}

/** A flagged possible duplicate: the same claim, or not. Counted against the whole library. */
export async function saveDupDecisionAction(cardFp: string, otherFp: string, same: boolean) {
  const s = await adminSession();
  if (!cardFp || !otherFp || cardFp.length > 200 || otherFp.length > 200) throw new Error("That pair could not be identified.");
  const { error } = await db.from("analysis_dup_review").upsert({
    tenant_id: s.tenantId, card_fp: cardFp, other_fp: otherFp, same: !!same,
    reviewed_by: s.user.id, reviewed_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,card_fp,other_fp" });
  if (error) throw new Error(`could not save the decision: ${error.message}`);
  revalidatePath(PATH);
}

export async function clearDupDecisionAction(cardFp: string, otherFp: string) {
  const s = await adminSession();
  const { error } = await db.from("analysis_dup_review").delete()
    .eq("tenant_id", s.tenantId).eq("card_fp", cardFp).eq("other_fp", otherFp);
  if (error) throw new Error(`could not clear the decision: ${error.message}`);
  revalidatePath(PATH);
}
