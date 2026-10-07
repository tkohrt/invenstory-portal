"use server";
// For Granted's judgments in the card-quality review of the trial analysis.
//
// EVERY export of a "use server" module is a public endpoint, so none of these
// take a tenant id: the tenant comes from the session and every write is
// scoped to it. Admin-only.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { syncReviewRefusal, setRefusalLifted } from "./refusals";
import { refreshIfOnAnalysis } from "./analysis-switch";

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
  /** Every piece of the card's evidence, so Not supported remembers each quote it stood on. */
  evidence?: { documentId: string | null; quote: string }[];
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
  // Not supported is remembered for this client and refused on every later
  // read (decision 19); any other verdict forgets it.
  const evidence = (r.evidence?.length ? r.evidence : [{ documentId: r.documentId, quote: r.quote }]).slice(0, 20);
  const asked = [...new Set(evidence.map(e => e.documentId).filter((x): x is string => !!x))];
  const own = new Set<string>();
  if (asked.length) {
    const { data } = await db.from("document").select("id").eq("tenant_id", s.tenantId).in("id", asked);
    for (const d of (data ?? []) as { id: string }[]) own.add(d.id);
  }
  const changed = await syncReviewRefusal(s.tenantId, s.user.id, {
    fingerprint: r.fingerprint, kind: r.kind, statement: r.statement, verdict: r.verdict,
    evidence: evidence.map(e => ({ documentId: e.documentId && own.has(e.documentId) ? e.documentId : null, quote: String(e.quote ?? "") })),
  });
  // On the analysis, a refusal reaches the client's library, readiness and profile at once (free).
  if (changed) await refreshIfOnAnalysis(s.tenantId, s.user.id);
  revalidatePath(PATH);
}

/** Take a review back, so the card counts as unreviewed. */
export async function clearReviewAction(fingerprint: string) {
  const s = await adminSession();
  const { error } = await db.from("analysis_review").delete().eq("tenant_id", s.tenantId).eq("fingerprint", fingerprint);
  if (error) throw new Error(`could not clear the review: ${error.message}`);
  if (await syncReviewRefusal(s.tenantId, s.user.id, { fingerprint, kind: "", statement: "", evidence: [], verdict: null })) {
    await refreshIfOnAnalysis(s.tenantId, s.user.id);
  }
  revalidatePath(PATH);
}

/**
 * Let a remembered refusal's quote through again (lifted = true), or refuse it
 * again. The refusal stays on record either way.
 */
export async function liftRefusalAction(id: string, lifted: boolean) {
  const s = await adminSession();
  if (!id || id.length > 64) throw new Error("That refusal could not be identified.");
  await setRefusalLifted(s.tenantId, s.user.id, id, !!lifted);
  await refreshIfOnAnalysis(s.tenantId, s.user.id);
  revalidatePath(PATH);
  revalidatePath("/story-cards");
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

const VERDICTS = new Set(["new_correct", "old_correct", "both_acceptable", "neither"]);

/**
 * A person's judgement of one disagreement between the current read and the new
 * one. Records the two states it was given for, so a re-read that changes
 * either side brings the item back for another look.
 */
export async function saveVerdictAction(input: {
  area: "readiness" | "eligibility"; itemKey: string; verdict: string;
  oldState: string; newState: string; note?: string | null;
}) {
  const s = await adminSession();
  if (input.area !== "readiness" && input.area !== "eligibility") throw new Error("Unknown comparison.");
  if (!VERDICTS.has(input.verdict)) throw new Error("Choose one of the four judgements.");
  if (!input.itemKey || input.itemKey.length > 80) throw new Error("That item could not be identified.");
  const { error } = await db.from("analysis_verdict").upsert({
    tenant_id: s.tenantId, area: input.area, item_key: input.itemKey, verdict: input.verdict,
    old_state: input.oldState.slice(0, 500), new_state: input.newState.slice(0, 500),
    note: input.note?.trim() ? input.note.trim().slice(0, 1000) : null,
    reviewed_by: s.user.id, reviewed_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,area,item_key" });
  if (error) throw new Error(`could not save the judgement: ${error.message}`);
  revalidatePath(PATH);
}

export async function clearVerdictAction(area: "readiness" | "eligibility", itemKey: string) {
  const s = await adminSession();
  const { error } = await db.from("analysis_verdict").delete()
    .eq("tenant_id", s.tenantId).eq("area", area).eq("item_key", itemKey);
  if (error) throw new Error(`could not clear the judgement: ${error.message}`);
  revalidatePath(PATH);
}
