"use server";
// A client's judgments on its own Story Cards.
//
// EVERY export of a "use server" module is a public endpoint, so none takes a
// tenant id: the tenant is the session's, and a card id from another client
// matches nothing. A client may act only while Story Cards is turned on for it;
// an admin viewing the client may always act, as For Granted.
//
// What a client may do is deliberately narrower than For Granted's Card
// Library: confirm a card, correct its wording (same rules, same figure check),
// or mark it out of date with a note. Merging, reinstating and sensitivity
// decisions stay with For Granted.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { getFeatureVisible } from "./data";
import { writeCardEdit } from "./card-edit";

const PATH = "/story-cards";

async function reviewer() {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  if (s.role !== "admin" && !(await getFeatureVisible(s.tenantId, "card_review"))) {
    throw new Error("Story Cards is not turned on for your account.");
  }
  return s;
}

async function live(tenantId: string, id: string) {
  const { data, error } = await db.from("story_card").select("id, status")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw new Error(`card read failed: ${error.message}`);
  if (!data || data.status === "retired") throw new Error("That card is no longer in your library.");
  return data;
}

async function audit(tenantId: string, userId: string, action: string, detail: string) {
  await db.from("audit_log").insert({ actor_user_id: userId, tenant_id: tenantId, action, detail: detail.slice(0, 300) });
}

/** "Yes, this is right." */
export async function confirmMyCardAction(id: string) {
  const s = await reviewer();
  await live(s.tenantId, id);
  const { error } = await db.from("story_card").update({
    status: "verified", verified_by: s.user.id, verified_by_role: s.role === "admin" ? "admin" : "client",
    verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`Could not save that: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_verify_client", id);
  revalidatePath(PATH);
}

/** Correct the wording. A new version; For Granted sees it was edited. */
export async function editMyCardAction(id: string, statement: string) {
  const s = await reviewer();
  await live(s.tenantId, id);
  const version = await writeCardEdit(s.tenantId, s.user.id, id, statement, s.role === "admin" ? "admin" : "client");
  if (version != null) await audit(s.tenantId, s.user.id, "card_edit_client", `${id} v${version}`);
  revalidatePath(PATH);
}

/** "This is out of date." Kept, with the note, and For Granted can bring it back. */
export async function outOfDateMyCardAction(id: string, note: string) {
  const s = await reviewer();
  await live(s.tenantId, id);
  const why = note.trim().slice(0, 600) || null;
  const { error } = await db.from("story_card").update({
    status: "retired", retired_reason: "superseded", retired_note: why ? `${why} (from the client)` : "Marked out of date by the client.",
    possible_duplicate_of: null, updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id);
  if (error) throw new Error(`Could not save that: ${error.message}`);
  await audit(s.tenantId, s.user.id, "card_retire_client", `${id}${why ? `: ${why}` : ""}`);
  revalidatePath(PATH);
}
