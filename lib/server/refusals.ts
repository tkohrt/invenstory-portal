import "server-only";
// Remembered refusals (decisions 19 and 31): reading and writing them.
//
// A plain server module, not "use server": every function takes a tenant id,
// so none of them may be a public endpoint. The admin actions that call these
// (analysis-actions.ts, card-actions.ts) take the tenant from the session.
// The matching itself is pure, in lib/refusal.ts.
import { db } from "./db";
import type { Refusal, RefusalSource } from "@/lib/refusal";

type Row = {
  id: string; source: RefusalSource; source_ref: string; document_id: string | null;
  kind: string; statement: string; quote: string; created_at: string;
  lifted_at: string | null;
};
const COLS = "id, source, source_ref, document_id, kind, statement, quote, created_at, lifted_at";

const toRefusal = (r: Row): Refusal => ({
  id: r.id, source: r.source, sourceRef: r.source_ref, documentId: r.document_id,
  kind: r.kind, statement: r.statement, quote: r.quote, createdAt: r.created_at,
});

/**
 * The refusals in force for a client. Never throws: before migration 0053 the
 * table is missing, and a read that cannot load its refusals must still work
 * (exactly as it did before refusals existed), not take the page down.
 */
export async function activeRefusals(tenantId: string): Promise<Refusal[]> {
  try {
    const { data, error } = await db.from("card_refusal").select(COLS)
      .eq("tenant_id", tenantId).is("lifted_at", null).order("created_at");
    if (error) return [];
    return ((data ?? []) as Row[]).map(toRefusal);
  } catch { return []; }
}

export interface RefusalListing extends Refusal { liftedAt: string | null }

/** Every refusal for a client, lifted ones included, newest first, for the Analysis page. */
export async function listRefusals(tenantId: string): Promise<RefusalListing[]> {
  try {
    const { data, error } = await db.from("card_refusal").select(COLS)
      .eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (error) return [];
    return ((data ?? []) as Row[]).map(r => ({ ...toRefusal(r), liftedAt: r.lifted_at }));
  } catch { return []; }
}

/**
 * Bring one review's refusal in line with its verdict. Not supported remembers
 * every quote the card stood on (again, if it had been lifted: saving Not
 * supported is a fresh judgement); any other verdict, or clearing the review,
 * forgets them.
 */
export async function syncReviewRefusal(tenantId: string, userId: string, review: {
  fingerprint: string; kind: string; statement: string;
  evidence: { documentId: string | null; quote: string }[];
  verdict: "supported" | "partly" | "unsupported" | null;
}): Promise<void> {
  const { error: dErr } = await db.from("card_refusal").delete()
    .eq("tenant_id", tenantId).eq("source", "review").eq("source_ref", review.fingerprint);
  if (dErr) throw new Error(`could not update the remembered refusal: ${dErr.message}`);
  if (review.verdict !== "unsupported") return;
  const seen = new Set<string>();
  const rows = review.evidence
    .filter(e => e.quote?.trim() && !seen.has(e.quote) && seen.add(e.quote))
    .slice(0, 20)
    .map(e => ({
      tenant_id: tenantId, source: "review", source_ref: review.fingerprint, document_id: e.documentId,
      kind: review.kind.slice(0, 60), statement: review.statement.slice(0, 2000), quote: e.quote.slice(0, 2000),
      created_by: userId,
    }));
  if (!rows.length) return;
  const { error } = await db.from("card_refusal").insert(rows);  // tenant-safe: every row built above carries tenant_id
  if (error) throw new Error(`could not remember the refusal: ${error.message}`);
}

/** A card retired as Inaccurate: remember every quote it stood on. */
export async function rememberRetiredCard(tenantId: string, userId: string, cardId: string): Promise<number> {
  const [{ data: card }, { data: ev }] = await Promise.all([
    db.from("story_card").select("kind, statement").eq("tenant_id", tenantId).eq("id", cardId).maybeSingle(),
    db.from("story_card_evidence").select("document_id, quote").eq("tenant_id", tenantId).eq("card_id", cardId),
  ]);
  if (!card) return 0;
  await forgetRetiredCard(tenantId, cardId);
  const rows = ((ev ?? []) as { document_id: string; quote: string }[])
    .filter(e => e.quote?.trim())
    .map(e => ({
      tenant_id: tenantId, source: "library", source_ref: cardId, document_id: e.document_id,
      kind: (card as { kind: string }).kind, statement: (card as { statement: string }).statement.slice(0, 2000),
      quote: e.quote.slice(0, 2000), created_by: userId,
    }));
  if (!rows.length) return 0;
  const { error } = await db.from("card_refusal").insert(rows);  // tenant-safe: every row built above carries tenant_id
  if (error) throw new Error(`could not remember the refusal: ${error.message}`);
  return rows.length;
}

/** A card brought back: forget what its retirement remembered. */
export async function forgetRetiredCard(tenantId: string, cardId: string): Promise<void> {
  const { error } = await db.from("card_refusal").delete()
    .eq("tenant_id", tenantId).eq("source", "library").eq("source_ref", cardId);
  if (error) throw new Error(`could not forget the refusal: ${error.message}`);
}

/** Let a refused quote through again, or refuse it again. Recorded, never deleted. */
export async function setRefusalLifted(tenantId: string, userId: string, id: string, lifted: boolean): Promise<void> {
  const { error } = await db.from("card_refusal").update(lifted
    ? { lifted_at: new Date().toISOString(), lifted_by: userId }
    : { lifted_at: null, lifted_by: null })
    .eq("tenant_id", tenantId).eq("id", id);
  if (error) throw new Error(`could not change the refusal: ${error.message}`);
}
