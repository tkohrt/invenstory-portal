"use server";
// What a person can do from the Document Reader (Phase 1).
//
// EVERY export of a "use server" module is a public endpoint, so none of these
// trusts a tenant id from the page except setReaderFeatureAction, which is For
// Granted's only and checks so. The tenant is the session's, and a card or
// document id from another client matches nothing.
//
// For Granted acts on cards in the reader through the Card Library's own
// actions (lib/server/card-actions.ts, via CardReview). A client acts through
// these, and only while "Act on cards" is on for it (checked here, on the
// server, whatever the page shows): confirm, correct the wording, out of date,
// and "This passage does not support the card". "The card itself is
// inaccurate" stays For Granted's (decision of 17 October 2026).
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { accessFor } from "./reader";
import { writeCardEdit } from "./card-edit";
import { isReaderFeatureKey } from "@/lib/reader-features";

type Result = { ok: true; retired?: boolean } | { ok: false; error: string };

async function actor() {
  const s = await getSession();
  if (!s) return { error: "Please sign in again." } as const;
  const access = await accessFor(s);
  if (!access.cardActions) return { error: "Acting on Story Cards from the reader is not turned on for your account." } as const;
  return { s } as const;
}

async function audit(tenantId: string, userId: string, action: string, detail: string) {
  await db.from("audit_log").insert({ actor_user_id: userId, tenant_id: tenantId, action, detail: detail.slice(0, 300) });
}

async function liveCard(tenantId: string, id: string) {
  const { data } = await db.from("story_card").select("id, kind, statement, status")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!data || data.status === "retired") return null;
  return data as { id: string; kind: string; statement: string; status: string };
}

const fail = (e: unknown, fallback: string): Result => ({ ok: false, error: e instanceof Error ? e.message : fallback });

/** "Yes, this is right." */
export async function readerConfirmCardAction(cardId: string): Promise<Result> {
  const a = await actor();
  if ("error" in a) return { ok: false, error: a.error! };
  const { s } = a;
  if (!await liveCard(s.tenantId, cardId)) return { ok: false, error: "That card is no longer in the library." };
  const { error } = await db.from("story_card").update({
    status: "verified", retired_reason: null, verified_by: s.user.id, verified_by_role: s.role === "admin" ? "admin" : "client",
    verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", cardId);
  if (error) return { ok: false, error: "Could not save that. Try again." };
  await audit(s.tenantId, s.user.id, s.role === "admin" ? "card_verify" : "card_verify_client", `${cardId} (reader)`);
  revalidatePath("/story-cards");
  return { ok: true };
}

/** Correct the wording: a new version, the same figure check as everywhere else. */
export async function readerEditCardAction(cardId: string, statement: string): Promise<Result> {
  const a = await actor();
  if ("error" in a) return { ok: false, error: a.error! };
  const { s } = a;
  if (!await liveCard(s.tenantId, cardId)) return { ok: false, error: "That card is no longer in the library." };
  try {
    const version = await writeCardEdit(s.tenantId, s.user.id, cardId, statement, s.role === "admin" ? "admin" : "client");
    if (version != null) await audit(s.tenantId, s.user.id, s.role === "admin" ? "card_edit" : "card_edit_client", `${cardId} v${version} (reader)`);
  } catch (e) { return fail(e, "Could not save the new wording."); }
  revalidatePath("/story-cards");
  return { ok: true };
}

/** "This is out of date." Kept, with the note; For Granted can bring it back. */
export async function readerOutOfDateCardAction(cardId: string, note: string): Promise<Result> {
  const a = await actor();
  if ("error" in a) return { ok: false, error: a.error! };
  const { s } = a;
  if (!await liveCard(s.tenantId, cardId)) return { ok: false, error: "That card is no longer in the library." };
  const why = (note ?? "").trim().slice(0, 600) || null;
  const client = s.role !== "admin";
  const { error } = await db.from("story_card").update({
    status: "retired", retired_reason: "superseded",
    retired_note: why ? (client ? `${why} (from the client)` : why) : (client ? "Marked out of date by the client." : null),
    possible_duplicate_of: null, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", cardId);
  if (error) return { ok: false, error: "Could not save that. Try again." };
  await audit(s.tenantId, s.user.id, client ? "card_retire_client" : "card_retire", `${cardId} superseded (reader)${why ? `: ${why}` : ""}`);
  revalidatePath("/story-cards");
  return { ok: true };
}

/**
 * "This passage does not support the card" (decision 2, 17 October 2026).
 *
 * Removes this document's source from the card only, and remembers it for
 * this card (card_refusal, source 'passage', 0070) so no merge attaches it to
 * the card again; the passage may still support other cards. The card keeps
 * its other sources and goes back to Needs review. When this was its only
 * source the card is retired ("no longer supported", source_removed): it comes
 * back as suggested only if another document supports it later.
 */
export async function refusePassageAction(cardId: string, documentId: string, note: string): Promise<Result> {
  const a = await actor();
  if ("error" in a) return { ok: false, error: a.error! };
  const { s } = a;
  const card = await liveCard(s.tenantId, cardId);
  if (!card) return { ok: false, error: "That card is no longer in the library." };
  const { data: ev } = await db.from("story_card_evidence").select("id, document_id, quote")
    .eq("tenant_id", s.tenantId).eq("card_id", cardId).eq("document_id", documentId);
  const here = ((ev ?? []) as { id: string; document_id: string; quote: string }[])[0];
  if (!here) return { ok: false, error: "This document is no longer one of the card's sources." };
  const why = (note ?? "").trim().slice(0, 600) || null;

  // Remembered once: pressing again after a failure does not add a second refusal.
  const { data: already } = await db.from("card_refusal").select("id")
    .eq("tenant_id", s.tenantId).eq("source", "passage").eq("source_ref", cardId)
    .eq("document_id", documentId).is("lifted_at", null).limit(1);
  if (!(already ?? []).length) {
    const { error: rErr } = await db.from("card_refusal").insert({
      tenant_id: s.tenantId, source: "passage", source_ref: cardId, document_id: documentId,
      kind: card.kind.slice(0, 60), statement: card.statement.slice(0, 2000), quote: here.quote.slice(0, 2000),
      note: why ? (s.role === "admin" ? why : `${why} (from the client)`) : null, created_by: s.user.id,
    });
    if (rErr) return { ok: false, error: "Could not remember that. Nothing was changed." };
  }
  const { error: dErr } = await db.from("story_card_evidence").delete().eq("tenant_id", s.tenantId).eq("id", here.id);
  if (dErr) return { ok: false, error: "Could not remove the source. Try again; the passage is already remembered." };

  // Counted AFTER the delete, and only sources in documents that are ready (as
  // the reader counts them), so two refusals at once still retire a card left
  // with nothing, and the dialog's warning matches what happens.
  const { data: rest } = await db.from("story_card_evidence").select("id, document:document_id(status)")
    .eq("tenant_id", s.tenantId).eq("card_id", cardId);
  const left = ((rest ?? []) as unknown as { document: { status: string } | null }[])
    .filter(r => r.document?.status === "ready").length;
  const last = left === 0;
  const now = new Date().toISOString();
  const patch = last
    ? { status: "retired", retired_reason: "source_removed", possible_duplicate_of: null, updated_at: now,
        retired_note: why ?? "Its only passage was marked as not supporting it." }
    : { status: "suggested", verified_by: null, verified_at: null, verified_by_role: null, updated_at: now };
  const { error: uErr } = await db.from("story_card").update(patch).eq("tenant_id", s.tenantId).eq("id", cardId);
  if (uErr) return { ok: false, error: "The source was removed, but the card could not be updated. Reload the page." };
  await audit(s.tenantId, s.user.id, "card_passage_refused", `${cardId} ${documentId}${last ? " (retired)" : ""}${why ? `: ${why}` : ""}`);
  revalidatePath("/story-cards");
  revalidatePath("/admin/card-library");
  return { ok: true, retired: last };
}

/** For Granted sets one of a client's reader switches (the client's activity page). */
export async function setReaderFeatureAction(tenantId: string, key: string, on: boolean): Promise<Result> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "Only For Granted can change this." };
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !isReaderFeatureKey(key)) return { ok: false, error: "Unknown switch." };
  const { data: t } = await db.from("tenant").select("id").eq("id", tenantId).maybeSingle();
  if (!t) return { ok: false, error: "That client does not exist." };
  const { error } = await db.from("feature_visibility").upsert({
    tenant_id: tenantId, feature_key: key, visible: !!on, updated_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,feature_key" });
  if (error) return { ok: false, error: "Could not save the switch." };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: "feature_visibility", detail: `${key}=${on ? "visible" : "hidden"}` });
  revalidatePath(`/admin/clients/${tenantId}`);
  return { ok: true };
}
