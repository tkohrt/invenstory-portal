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

// ---- The analysis's suggestion, confirmed on the row (patch 61) ----
//
// For a client on the analysis every upload is read within moments, and the
// reading says what kind of document it looks like. Until this patch that
// suggestion only showed on the Analyze page and the Inven(s)tory page, so a
// client who chose "Not sure" in setup never saw it there. A suggestion is
// never applied by itself: where a person had the final say, the analysis's
// proven suggestion matched them 28 times in 38 (production, 17 Nov 2026),
// and it was wrong on all three pitch decks, which is a readiness file item.
// So a person confirms, with one click, where they already are (decision 33).

/** What the type select says when nothing is chosen. It no longer implies the portal will set one. */
export const NOT_SURE_LABEL = "Not sure (we’ll suggest one for you to confirm)";

/** The suggestion to offer on a row: only when no person has typed the document and the analysis named a real type. */
export function suggestionFor(typeTag: string | null | undefined, docType: string | null | undefined, known: (key: string) => boolean): string | null {
  if (typeTag) return null;
  if (!docType || docType === "other" || !known(docType)) return null;
  return docType;
}

/** The completion screen's line on how far the analysis has got. Null when there is nothing to say. */
export function analysedLine(done: number, total: number): string | null {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  const d = Math.max(0, Math.min(Math.floor(done), Math.floor(total)));
  const t = Math.floor(total);
  if (d >= t) return t === 1 ? "We’ve analysed your document." : `We’ve analysed all ${t} of your documents.`;
  return `We’ve analysed ${d} of your ${t} documents so far. The rest are being read now and finish on their own.`;
}
