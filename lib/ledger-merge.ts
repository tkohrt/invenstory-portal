// Funder Ledger — the base/overlay merge.
//
// Pure and dependency-free on purpose: this is the function that decides what a
// client actually sees, so it must be unit-testable without a database. The
// server-side reads live in lib/server/ledger-overlay.ts.
import type { LedgerOverlayRow } from "@/lib/types";

export interface LedgerRecord { id: string; [k: string]: unknown }

/** A merged record carries where it came from, so the UI can label it honestly. */
export interface MergedRecord extends LedgerRecord {
  _overlay: null | {
    id: string;
    kind: "correction" | "new";
    reviewed_at: string | null;
    // FG-internal. Present only when the caller passed reveal:true (admin
    // surfaces). source_url and provenance are our sourcing trail, not the
    // client's — if that should change it's a product call, not a default.
    source_url?: string;
    provenance?: string;
  };
}

export interface MergeOptions {
  /** Include FG-internal sourcing fields. Admin surfaces only. */
  reveal?: boolean;
  /** Corrections whose target wasn't in `base`, handed back rather than dropped. */
  onUnmatched?: (row: LedgerOverlayRow) => void;
}

export const OVERLAY_ID_PREFIX = "overlay:";

function stamp(row: LedgerOverlayRow, kind: "correction" | "new", reveal: boolean) {
  return {
    id: row.id, kind, reviewed_at: row.reviewed_at,
    ...(reveal ? { source_url: row.source_url, provenance: row.provenance } : {}),
  };
}

/** Two records are the same real-world thing if they share an identifier. */
function dedupeKey(rec: Record<string, unknown>): string | null {
  const ein = rec.ein ?? rec.EIN;
  if (typeof ein === "string" && ein.trim()) return `ein:${ein.replace(/\D/g, "")}`;
  const opp = rec.opportunity_number ?? rec.opportunityNumber;
  if (typeof opp === "string" && opp.trim()) return `opp:${opp.trim().toLowerCase()}`;
  return null;
}

/**
 * Merge approved overlay rows over base results from the Ledger service.
 *
 * Overlay wins: a row with a base_id overrides that base record's fields; a
 * row without one is appended as a brand-new candidate. The base array is
 * never mutated.
 *
 * Three cases the naive version got wrong, all handled here:
 *  - A correction can target a record the overlay itself added (`overlay:<id>`),
 *    which lives in the additions list, not in `base`.
 *  - A correction whose base record isn't in this slice of results is reported
 *    through onUnmatched instead of vanishing.
 *  - An addition that duplicates a base record by EIN or opportunity number is
 *    folded into it rather than rendered twice.
 */
export function mergeOverlay(
  base: LedgerRecord[], overlay: LedgerOverlayRow[], opts: MergeOptions = {},
): MergedRecord[] {
  const reveal = opts.reveal ?? false;
  const corrections = new Map<string, LedgerOverlayRow>();
  const additions: LedgerOverlayRow[] = [];
  for (const row of overlay) {
    if (row.base_id) corrections.set(row.base_id, row);   // DB unique index guarantees one per base record
    else additions.push(row);
  }

  const used = new Set<string>();

  // Corrections that target an overlay-added record are applied to that
  // addition before it is emitted, so editing an FG-found grant works.
  const patchedAdditions = additions.map(add => {
    const fix = corrections.get(`${OVERLAY_ID_PREFIX}${add.id}`);
    if (!fix) return { add, fields: add.fields, applied: null as LedgerOverlayRow | null };
    used.add(`${OVERLAY_ID_PREFIX}${add.id}`);
    return { add, fields: { ...add.fields, ...fix.fields }, applied: fix };
  });

  // Base records the overlay already covers by identifier, so an addition that
  // is really the same funder/grant folds in instead of double-listing.
  const baseByKey = new Map<string, string>();
  for (const rec of base) {
    const k = dedupeKey(rec);
    if (k && !baseByKey.has(k)) baseByKey.set(k, String(rec.id));
  }
  const foldIn = new Map<string, { fields: Record<string, unknown>; row: LedgerOverlayRow }>();
  const standalone: typeof patchedAdditions = [];
  for (const p of patchedAdditions) {
    const k = dedupeKey({ ...p.fields, ein: p.add.ein, opportunity_number: p.add.opportunity_number });
    const hit = k ? baseByKey.get(k) : undefined;
    if (hit && !corrections.has(hit)) foldIn.set(hit, { fields: p.fields, row: p.applied ?? p.add });
    else standalone.push(p);
  }

  const merged: MergedRecord[] = base.map(rec => {
    const id = String(rec.id);
    const fix = corrections.get(id);
    if (fix) {
      used.add(id);
      return { ...rec, ...fix.fields, id: rec.id, _overlay: stamp(fix, "correction", reveal) };
    }
    const folded = foldIn.get(id);
    if (folded) return { ...rec, ...folded.fields, id: rec.id, _overlay: stamp(folded.row, "correction", reveal) };
    return { ...rec, _overlay: null };
  });

  for (const p of standalone) {
    merged.push({
      ...p.fields,
      id: `${OVERLAY_ID_PREFIX}${p.add.id}`,   // namespaced so it can't collide with a base id
      _overlay: stamp(p.applied ?? p.add, "new", reveal),
    });
  }

  if (opts.onUnmatched) {
    for (const [baseId, row] of corrections) if (!used.has(baseId)) opts.onUnmatched(row);
  }
  return merged;
}
