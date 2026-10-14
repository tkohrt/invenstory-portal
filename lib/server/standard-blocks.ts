import "server-only";
// Which pieces of a Standard Answer get copied into an application (Auto-Draft
// patch 7, 0065). An approved Standard Answer keeps its pieces as they were
// when approved (answer.approved_blocks), so a working version not yet
// approved again, for example one "Also update the Standard Answer" wrote,
// never reaches a new draft: "until then the old approved answer stays in use"
// (spec section 4b). Answers approved before 0065 have none and are copied from
// the Standard Answers draft's working version, as before.
//
// A plain server module: the caller has already decided who is asking. Every
// read is scoped by tenant.
import { db } from "./db";
import { BLOCK_COLS } from "./workspace";

/** A copyable piece, in section_block's own column names. */
export interface CopyRow {
  kind: string; card_id: string | null; card_version: number | null; text: string | null;
  edited: boolean; break_before: boolean;
}

const asRow = (b: Record<string, unknown>): CopyRow => ({
  kind: String(b.kind), card_id: (b.card_id as string | null) ?? null, card_version: (b.card_version as number | null) ?? null,
  text: (b.text as string | null) ?? null, edited: !!b.edited, break_before: !!b.break_before,
});

/** The snapshot kept on approval: every piece but a proposed bridge, in order. */
export function approvedSnapshot(rows: Record<string, unknown>[]): CopyRow[] {
  return rows.filter(b => !b.proposed).map(asRow);
}

/**
 * The pieces to copy for an approved Standard Answer: its approved snapshot when
 * it has one, else its working version (proposed bridges left out). `answer` is
 * the answer row read with every column, so this works before 0065 too.
 */
export async function standardAnswerPieces(tenantId: string, answer: { draft_section_id?: string | null; approved_blocks?: unknown }): Promise<CopyRow[]> {
  const snap = Array.isArray(answer.approved_blocks) ? (answer.approved_blocks as Record<string, unknown>[]) : null;
  if (snap && snap.length) return snap.filter(b => b && typeof b === "object" && typeof b.kind === "string").map(asRow);
  if (!answer.draft_section_id) return [];
  const { data, error } = await db.from("section_block").select(BLOCK_COLS)
    .eq("tenant_id", tenantId).eq("section_id", answer.draft_section_id).order("sort_order");
  if (error) throw new Error(`Could not read the Standard Answer: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).filter(b => !b.proposed).map(asRow);
}
