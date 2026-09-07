"use server";
// For Granted's corrections to a client's Search Profile.
//
// Admin-only, and that is not a placeholder. These write For Granted's judgment
// over an extraction, and the extraction itself is never shown to a client. A
// client seeing "we removed the claim that you have mentored hundreds of
// companies" would be reading our working notes.
//
// EVERY export of a "use server" module is a public endpoint, so none of these
// take a tenant id. The tenant comes from the session, which is the only source
// that cannot be supplied by a caller.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { FACETS, type Facet } from "@/lib/search-profile";

const MAX_TEXT = 300;
const MAX_NOTE = 500;

async function adminSession() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

/** Reject anything that is not one of the eight, rather than storing it. */
function asFacet(v: unknown): Facet | null {
  return FACETS.includes(v as Facet) ? (v as Facet) : null;
}

/**
 * Take a line out of the profile.
 *
 * Hidden, not deleted, and the difference matters: the base fact stays in
 * search_profile with its quote, so the removal is reversible and so a rebuild
 * that re-extracts the same line finds it already judged.
 */
export async function hideFactAction(factId: string, note?: string) {
  const s = await adminSession();
  if (!factId) throw new Error("no fact given");
  const { error } = await db.from("profile_edit").upsert({
    tenant_id: s.tenantId, fact_id: factId, kind: "hide",
    text: null, facet: null, note: note?.slice(0, MAX_NOTE) ?? null,
    edited_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,fact_id" });
  if (error) throw new Error(`Could not remove that line: ${error.message}`);
  revalidatePath("/funder-matches");
}

/** Rewrite the clause, keeping the quote it was drawn from. */
export async function editFactAction(factId: string, text: string, facet?: string, note?: string) {
  const s = await adminSession();
  const clean = (text ?? "").trim();
  if (!factId) throw new Error("no fact given");
  if (!clean) throw new Error("An empty line is a removal, not an edit.");

  // Rewording a line FOR GRANTED ADDED must not turn it into a correction of a
  // base fact that does not exist, which would make it disappear on save.
  const { data: existing } = await db.from("profile_edit")
    .select("kind").eq("tenant_id", s.tenantId).eq("fact_id", factId).maybeSingle();
  const kind = (existing as { kind?: string } | null)?.kind === "add" ? "add" : "edit";

  const { error } = await db.from("profile_edit").upsert({
    tenant_id: s.tenantId, fact_id: factId, kind,
    text: clean.slice(0, MAX_TEXT), facet: asFacet(facet),
    note: note?.slice(0, MAX_NOTE) ?? null,
    edited_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,fact_id" });
  if (error) throw new Error(`Could not save that edit: ${error.message}`);
  revalidatePath("/funder-matches");
}

/**
 * Add a line no document states usably.
 *
 * It carries no quote, and the panel says so. Everything else in this structure
 * follows "no quote, no fact"; this is a person's word, and dressing it as
 * extraction would undermine the rule for the lines that do have one.
 */
export async function addFactAction(facet: string, text: string, note?: string) {
  const s = await adminSession();
  const f = asFacet(facet);
  const clean = (text ?? "").trim();
  if (!f) throw new Error("Choose which facet this belongs to.");
  if (!clean) throw new Error("Write the line before adding it.");
  // Prefixed and random, so it can never collide with a hash of a real fact
  // and so an added line is identifiable without reading the table.
  const factId = `add-${crypto.randomUUID()}`;
  const { error } = await db.from("profile_edit").insert({
    tenant_id: s.tenantId, fact_id: factId, kind: "add",
    text: clean.slice(0, MAX_TEXT), facet: f, note: note?.slice(0, MAX_NOTE) ?? null,
    edited_by: s.user.id,
  });
  if (error) throw new Error(`Could not add that line: ${error.message}`);
  revalidatePath("/funder-matches");
}

/** Undo any correction, putting the extracted line back as it was. */
export async function restoreFactAction(factId: string) {
  const s = await adminSession();
  if (!factId) throw new Error("no fact given");
  const { error } = await db.from("profile_edit")
    .delete().eq("tenant_id", s.tenantId).eq("fact_id", factId);
  if (error) throw new Error(`Could not restore that line: ${error.message}`);
  revalidatePath("/funder-matches");
}
