import "server-only";
// The figure audit on the server (Polish; rules in lib/polish.ts).
//
// The finish line's backstop: Mark completed and Mark submitted
// (version-actions.ts) and approving a Standard Answer (workspace-actions.ts)
// are refused while any number in the answer has no source and no person has
// cleared it. The page runs the same check first and lists the numbers in
// Polish; this holds whatever the page does. Service role, every query scoped
// to the session's tenant.
import { db } from "./db";
import { figureAudit, openFlags, describeFigureFlags, type FigureClearance, type FigureFlag } from "@/lib/polish";

type Row = { id: string; section_id: string; kind: string; card_id: string | null; card_version: number | null; text: string | null; edited: boolean; proposed: boolean; sort_order: number };

/** Clearances for these questions. A missing table (0059 not run yet) reads as none. */
export async function clearancesFor(tenantId: string, sectionIds: string[]): Promise<(FigureClearance & { sectionId: string })[]> {
  if (!sectionIds.length) return [];
  const { data, error } = await db.from("figure_clearance").select("section_id, block_id, figure, reason, cleared_by, cleared_role, cleared_at")
    .eq("tenant_id", tenantId).in("section_id", sectionIds);
  if (error) return [];
  return ((data ?? []) as { section_id: string; block_id: string; figure: string; reason: string | null; cleared_by: string | null; cleared_role: string; cleared_at: string }[])
    .map(r => ({ sectionId: r.section_id, blockId: r.block_id, figure: r.figure, reason: r.reason, by: r.cleared_by, role: r.cleared_role, at: r.cleared_at }));
}

/** Every number in these answers with no source, by question. */
export async function figureFlagsFor(tenantId: string, sectionIds: string[]): Promise<Map<string, FigureFlag[]>> {
  const out = new Map<string, FigureFlag[]>();
  if (!sectionIds.length) return out;
  const { data: rowsRaw, error } = await db.from("section_block")
    .select("id, section_id, kind, card_id, card_version, text, edited, proposed, sort_order")
    .eq("tenant_id", tenantId).in("section_id", sectionIds).order("sort_order");
  if (error) throw new Error(`Could not read the answers: ${error.message}`);
  const rows = (rowsRaw ?? []) as Row[];
  const cardIds = [...new Set(rows.filter(r => r.kind === "card" && r.card_id).map(r => r.card_id as string))];

  // A card block's words, as it reads in the draft: the edit, or the version placed.
  const wording = new Map<string, string>();
  const quotes = new Map<string, string[]>();
  if (cardIds.length) {
    const [{ data: vs }, { data: ev }] = await Promise.all([
      db.from("story_card_version").select("card_id, version, statement").eq("tenant_id", tenantId).in("card_id", cardIds),
      db.from("story_card_evidence").select("card_id, quote, document:document_id(status)").eq("tenant_id", tenantId).in("card_id", cardIds),
    ]);
    for (const v of (vs ?? []) as { card_id: string; version: number; statement: string }[]) wording.set(`${v.card_id}:${v.version}`, v.statement);
    for (const e of (ev ?? []) as unknown as { card_id: string; quote: string; document: { status: string } | null }[]) {
      if (e.document?.status !== "ready") continue;
      quotes.set(e.card_id, [...(quotes.get(e.card_id) ?? []), e.quote]);
    }
  }
  const clear = await clearancesFor(tenantId, sectionIds);
  for (const sid of sectionIds) {
    const blocks = rows.filter(r => r.section_id === sid).map(r => ({
      id: r.id, kind: r.kind, cardId: r.card_id, proposed: !!r.proposed,
      text: r.kind === "card" && !r.edited ? wording.get(`${r.card_id}:${r.card_version}`) ?? r.text ?? "" : r.text ?? "",
    }));
    out.set(sid, figureAudit(blocks, id => quotes.get(id) ?? [], clear.filter(c => c.sectionId === sid)));
  }
  return out;
}

/** The refusal sentence for these answers, or null when every number has a source or was cleared. */
export async function figureRefusal(tenantId: string, sectionIds: string[], what: string): Promise<string | null> {
  const flags = await figureFlagsFor(tenantId, sectionIds);
  const n = [...flags.values()].reduce((k, f) => k + openFlags(f).length, 0);
  return n ? describeFigureFlags(n, what) : null;
}
