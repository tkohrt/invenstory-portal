"use server";
// Reading and writing funder contacts.
//
// Admin-only at every entry point. These never reach a client surface: a client
// emailing a program officer cold, without the framing For Granted would give
// it, spends a relationship that cannot be bought back.
//
// Unlike ledger_overlay, contacts do NOT go through the review queue. That gate
// exists because an approved overlay row changes what every client sees in
// matching. A contact changes nothing a client sees, so review would add
// friction with no safety in return. Who added it and when is recorded instead.
import { getSession } from "./session";
import { db } from "./db";
import { normalizeEin } from "@/lib/ein";
import { buildContact, sortContacts, type ContactInput, type ContactRecord } from "@/lib/funder-contact";

async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

/** Every contact we hold for a set of funders, keyed by normalized EIN. */
export async function getContactsForEins(eins: string[]): Promise<Record<string, ContactRecord[]>> {
  await requireAdmin();
  const keys = [...new Set(eins.map(normalizeEin).filter(Boolean))];
  if (!keys.length) return {};

  // tenant-safe: funder_contact carries no tenant_id. It is For Granted IP
  // shared across engagements (see 0026_funder_contact.sql), admin-only by RLS,
  // and every caller here is gated by requireAdmin above.
  const { data, error } = await db.from("funder_contact")
    .select("*").in("ein", keys);
  if (error) throw new Error(`contact read failed: ${error.message}`);

  const out: Record<string, ContactRecord[]> = {};
  for (const r of (data ?? []) as ContactRecord[]) (out[r.ein] ??= []).push(r);
  for (const k of Object.keys(out)) out[k] = sortContacts(out[k]);
  return out;
}

/** One funder's contacts, for the panel beside the verification form. */
export async function getFunderContactsAction(ein: string): Promise<ContactRecord[]> {
  await requireAdmin();
  const key = normalizeEin(ein);
  if (!key) return [];
  // tenant-safe: funder_contact carries no tenant_id (see 0026); admin-gated.
  const { data, error } = await db.from("funder_contact").select("*").eq("ein", key);
  if (error) throw new Error(`contact read failed: ${error.message}`);
  return sortContacts((data ?? []) as ContactRecord[]);
}

export async function addFunderContactAction(input: ContactInput) {
  const s = await requireAdmin();
  const row = buildContact(input, normalizeEin);

  // Re-recording the same person updates them rather than stacking a duplicate
  // every time somebody re-checks a team page. The write also refreshes
  // last_verified_at, because the act of entering it IS the verification.
  // tenant-safe: funder_contact carries no tenant_id (see 0026); admin-gated.
  const { error } = await db.from("funder_contact")
    .upsert({ ...row, added_by: s.user.id, last_verified_at: new Date().toISOString() },
            { onConflict: "ein,name" });
  if (error) throw new Error(`Could not save that contact: ${error.message}`);
}

/**
 * Confirm a contact is still current, or record that they have gone.
 *
 * Departure is recorded, never deleted. That somebody left is a fact worth
 * keeping: it stops the next person re-entering them from a stale team page,
 * and it preserves the evidence that anyone checked at all.
 */
export async function updateContactStatusAction(id: string, status: "active" | "departed" | "unknown") {
  await requireAdmin();
  if (!["active", "departed", "unknown"].includes(status)) throw new Error("Unknown status.");
  // tenant-safe: funder_contact carries no tenant_id (see 0026); admin-gated.
  const { error } = await db.from("funder_contact")
    .update({ status, last_verified_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`Could not update that contact: ${error.message}`);
}
