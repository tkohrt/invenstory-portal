// Fixing a document after it has arrived, from the setup list (patch 60,
// 17 Nov 2026). The second half of the upload review: patch 59 lets a person
// catch a wrong file or a missing type BEFORE anything is sent; this lets
// them fix it afterwards, on the document's own row.
//
// These are the pure rules. The server (removeSetupDocAction) is the gate;
// the screen uses the same rules so it never offers what would be refused.

/** Who put a document in the Inven(s)tory: the client's own people, or For Granted. */
export type DocSource = "client" | "for_granted";

export interface RemoveVerdict { ok: boolean; why?: string }

/**
 * May the person doing setup remove this document?
 *
 * Only what their own organization added: For Granted's research and anything
 * For Granted loaded for them is not theirs to delete from a setup screen.
 * And not while it is mid-read, so a reader never writes into a document that
 * has just gone.
 */
export function canRemoveInSetup(doc: { source: string | null | undefined; status: string }): RemoveVerdict {
  if (doc.source !== "client") return { ok: false, why: "For Granted added this document. Ask For Granted if it should be removed." };
  if (doc.status === "processing") return { ok: false, why: "This document is being read right now. Try again in a moment." };
  return { ok: true };
}

/** The question on the row before anything is deleted. Removal cannot be undone, so it says so. */
export const removeQuestion = (title: string): string =>
  `Remove “${title}”? This deletes it from your Inven(s)tory and cannot be undone.`;

/** A document id as the database makes them; anything else never reaches a query. */
export const looksLikeDocId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
