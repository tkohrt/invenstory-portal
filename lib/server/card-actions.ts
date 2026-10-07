"use server";
// For Granted's judgments on a client's Card Library.
//
// Admin-only, and not as a placeholder: Decision 1 of the Story Card Drafter
// spec keeps the library For Granted's working view in version 1.
//
// EVERY export of a "use server" module is a public endpoint, so none of these
// take a tenant id. The tenant comes from the session, and every write is
// scoped to it: a card id from another client simply matches nothing.
//
// Nothing here deletes a card. Retiring keeps it, with its evidence and
// versions, because a submitted application may have used it (Phase 6) and must
// always be able to say what it used.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { remergeLibrary } from "./card-extract";
import { rememberRetiredCard, forgetRetiredCard } from "./refusals";
import { refreshIfOnAnalysis } from "./analysis-switch";
import { writeCardEdit } from "./card-edit";
import { getLibraryCard, type LibraryCard } from "./card-library";

const PATH = "/admin/card-library";

async function adminSession() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

async function audit(tenantId: string, userId: string, action: string, detail: string) {
  await db.from("audit_log").insert({ actor_user_id: userId, tenant_id: tenantId, action, detail: detail.slice(0, 300) });
}

async function loadCard(tenantId: string, id: string) {
  const { data, error } = await db.from("story_card")
    .select("id, statement, status, retired_reason, version, kind")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new Error(`card read failed: ${error.message}`);
  if (!data) throw new Error("That card is not in this client's library.");
  return data as { id: string; statement: string; status: string; retired_reason: string | null; version: number; kind: string };
}

/** A person confirms the card is true and current. The only way a card becomes verified. */
export async function verifyCardAction(id: string) {
  const s = await adminSession();
  const card = await loadCard(s.tenantId, id);
  if (card.status === "retired") throw new Error("Reinstate a retired card before verifying it.");
  const { error } = await db.from("story_card").update({
    status: "verified", retired_reason: null, verified_by: s.user.id, verified_by_role: "admin",
    verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not verify: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_verify", id);
  revalidatePath(PATH);
}

/** Undo a verification: back to suggested. */
export async function unverifyCardAction(id: string) {
  const s = await adminSession();
  await loadCard(s.tenantId, id);
  const { error } = await db.from("story_card").update({
    status: "suggested", verified_by: null, verified_at: null, verified_by_role: null, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not update: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_unverify", id);
  revalidatePath(PATH);
}

/**
 * Rewrite a card's statement.
 *
 * A new version, never an overwrite, and marked human so no rebuild replaces it.
 * Refused if the new wording uses a figure that none of the card's quotes
 * contain: the same rule the extraction obeys. A person may know the newer
 * number; the place to put it is the Inven(s)tory, where it gains a source.
 */
export async function editCardAction(id: string, statement: string) {
  const s = await adminSession();
  // Editing counts as verifying, so even an unchanged save leaves the card verified.
  const version = await writeCardEdit(s.tenantId, s.user.id, id, statement, "admin");
  await audit(s.tenantId, s.user.id, version == null ? "card_verify" : "card_edit", version == null ? `${id} (saved unchanged)` : `${id} v${version}`);
  revalidatePath(PATH);
}

/**
 * One card with its sources, for reviewing it where it is about to be used.
 * The Storyboard calls this when an unverified card is dropped into an answer.
 */
export async function getReviewCardAction(id: string): Promise<LibraryCard | null> {
  const s = await adminSession();
  return getLibraryCard(s.tenantId, id);
}

/**
 * Take a card out of use. Kept, with its history, and reversible.
 *
 * The note says why, in the reviewer's words. Optional, but worth asking for:
 * why a card was taken out is itself something the library learns from.
 */
export async function retireCardAction(id: string, reason: "inaccurate" | "superseded", note?: string | null) {
  const s = await adminSession();
  if (reason !== "inaccurate" && reason !== "superseded") throw new Error("unknown reason");
  await loadCard(s.tenantId, id);
  const why = (note ?? "").trim().slice(0, 600) || null;
  const { error } = await db.from("story_card").update({
    status: "retired", retired_reason: reason, retired_note: why, possible_duplicate_of: null, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not retire: ${error.message}`);
  // Inaccurate is remembered: its quotes are refused on every later read, so a
  // re-read that words the claim differently cannot bring it back (decision 31).
  if (reason === "inaccurate") {
    await rememberRetiredCard(s.tenantId, s.user.id, id);
    await refreshIfOnAnalysis(s.tenantId, s.user.id);  // its quotes now count for nothing in readiness or the profile either
  }
  await audit(s.tenantId, s.user.id, "card_retire", `${id} ${reason}${why ? `: ${why}` : ""}`);
  revalidatePath(PATH);
}

/** Bring a retired card back as suggested. A merged card is un-merged by this too. */
export async function reinstateCardAction(id: string) {
  const s = await adminSession();
  await loadCard(s.tenantId, id);
  const { error } = await db.from("story_card").update({
    status: "suggested", retired_reason: null, retired_note: null, merged_into: null, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not reinstate: ${error.message}`);
  await forgetRetiredCard(s.tenantId, id);  // before the merge, so its quotes count again
  await audit(s.tenantId, s.user.id, "card_reinstate", id);
  // Gives it back the evidence it forwarded. On the analysis, readiness and the profile follow too.
  if (!(await refreshIfOnAnalysis(s.tenantId, s.user.id))) await remergeLibrary(s.tenantId);
  revalidatePath(PATH);
}

/**
 * Merge one card into another.
 *
 * The source is retired as 'merged' and points at the target. Its evidence moves
 * to the target at the re-merge below, and every later rebuild forwards it the
 * same way, so a merge is permanent until someone reinstates the source.
 */
export async function mergeCardAction(sourceId: string, targetId: string) {
  const s = await adminSession();
  if (sourceId === targetId) throw new Error("A card cannot be merged into itself.");
  await loadCard(s.tenantId, sourceId);
  const target = await loadCard(s.tenantId, targetId);
  if (target.status === "retired") throw new Error("Merge into a live card, not a retired one.");
  const { error } = await db.from("story_card").update({
    status: "retired", retired_reason: "merged", merged_into: targetId,
    possible_duplicate_of: null, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", sourceId);
  if (error) throw new Error(`could not merge: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_merge", `${sourceId} -> ${targetId}`);
  await remergeLibrary(s.tenantId);
  revalidatePath(PATH);
}

/** The flagged pair are different claims. Never flag this card again. */
export async function dismissDuplicateAction(id: string) {
  const s = await adminSession();
  await loadCard(s.tenantId, id);
  const { error } = await db.from("story_card").update({
    possible_duplicate_of: null, duplicate_dismissed: true, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not dismiss: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_dup_dismiss", id);
  revalidatePath(PATH);
}

/**
 * Decide a sensitive card. Until this is done it cannot be placed in an answer.
 *
 *   consent        the person has agreed to this use. The note says who agreed,
 *                  when and how, because that is what anyone will ask later.
 *   deidentified   the card has been reworded so the person cannot be
 *                  recognised. Only after a person has edited the statement:
 *                  the reader's wording is what was flagged.
 *   not_sensitive  the flag is wrong. The note says why.
 */
export async function clearSensitiveAction(id: string, how: "consent" | "deidentified" | "not_sensitive", note: string) {
  const s = await adminSession();
  if (!["consent", "deidentified", "not_sensitive"].includes(how)) throw new Error("unknown decision");
  const why = note.trim().slice(0, 800);
  if (how !== "deidentified" && why.length < 8) {
    throw new Error(how === "consent"
      ? "Say who consented, when and how, so the record answers the question later."
      : "Say briefly why this card is not sensitive.");
  }
  const { data: card } = await db.from("story_card").select("id, sensitive, statement_origin")
    .eq("tenant_id", s.tenantId).eq("id", id).maybeSingle();
  if (!card) throw new Error("That card is not in this client's library.");
  if (how === "deidentified" && card.statement_origin !== "human") {
    throw new Error("Edit the card first to remove what identifies the person, then mark it de-identified.");
  }
  const { error } = await db.from("story_card").update({
    sensitive_cleared: how, sensitive_note: why || null, sensitive_cleared_by: s.user.id,
    sensitive_cleared_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not record the decision: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_sensitive_clear", `${id} ${how}${why ? `: ${why}` : ""}`);
  revalidatePath(PATH);
}

/** Undo a sensitivity decision: the card cannot be placed again until it is decided anew. */
export async function reopenSensitiveAction(id: string) {
  const s = await adminSession();
  await loadCard(s.tenantId, id);
  const { error } = await db.from("story_card").update({
    sensitive_cleared: null, sensitive_note: null, sensitive_cleared_by: null, sensitive_cleared_at: null,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not reopen: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_sensitive_reopen", id);
  revalidatePath(PATH);
}
