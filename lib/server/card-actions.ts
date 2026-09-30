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
import { MIN_STATEMENT_WORDS, MAX_STATEMENT_WORDS, untracedFigures } from "@/lib/story-card";

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
    status: "verified", retired_reason: null, verified_by: s.user.id,
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
    status: "suggested", verified_by: null, verified_at: null, updated_at: new Date().toISOString(),
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
  const card = await loadCard(s.tenantId, id);
  const text = statement.trim().replace(/\s+/g, " ");
  const n = text.split(" ").filter(Boolean).length;
  if (n < MIN_STATEMENT_WORDS) throw new Error(`A card needs at least ${MIN_STATEMENT_WORDS} words to stand on its own.`);
  if (n > MAX_STATEMENT_WORDS) throw new Error(`A card is one claim; keep it under ${MAX_STATEMENT_WORDS} words, or split it.`);
  if (text === card.statement) return;

  const { data: ev } = await db.from("story_card_evidence").select("quote")
    .eq("tenant_id", s.tenantId).eq("card_id", id);
  const quotes = ((ev ?? []) as { quote: string }[]).map(e => e.quote).join("\n");
  const untraced = untracedFigures(text, quotes);
  if (untraced.length) {
    throw new Error(`${untraced.join(", ")} ${untraced.length === 1 ? "is" : "are"} not in any of this card's quotes. `
      + "Add the source to the Inven(s)tory first, so the figure has evidence behind it.");
  }

  const version = card.version + 1;
  const { error: vErr } = await db.from("story_card_version").insert({
    card_id: id, tenant_id: s.tenantId, version, statement: text, origin: "human", created_by: s.user.id,
  });
  if (vErr) throw new Error(`could not save the new version: ${vErr.message}`);
  const { error } = await db.from("story_card").update({
    statement: text, statement_origin: "human", version, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not update the card: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_edit", `${id} v${version}`);
  revalidatePath(PATH);
}

/** Take a card out of use. Kept, with its history, and reversible. */
export async function retireCardAction(id: string, reason: "inaccurate" | "superseded") {
  const s = await adminSession();
  if (reason !== "inaccurate" && reason !== "superseded") throw new Error("unknown reason");
  await loadCard(s.tenantId, id);
  const { error } = await db.from("story_card").update({
    status: "retired", retired_reason: reason, possible_duplicate_of: null, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not retire: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_retire", `${id} ${reason}`);
  revalidatePath(PATH);
}

/** Bring a retired card back as suggested. A merged card is un-merged by this too. */
export async function reinstateCardAction(id: string) {
  const s = await adminSession();
  await loadCard(s.tenantId, id);
  const { error } = await db.from("story_card").update({
    status: "suggested", retired_reason: null, merged_into: null, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`could not reinstate: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_reinstate", id);
  await remergeLibrary(s.tenantId);   // gives it back the evidence it forwarded
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
