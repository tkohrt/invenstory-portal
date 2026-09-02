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

/** Local id for a funder card with no EIN. Never equal to any real base_id. */
const UNIDENTIFIED_PREFIX = "unidentified:";

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
/**
 * Field keys that are For Granted's working notes, not facts about the record.
 *
 * `reveal:false` was stripping source_url and provenance from the _overlay
 * stamp, but `fields` is spread wholesale onto the record, and `notes` lives
 * there — the form asks for "who you spoke to, what changed, why it matters".
 * That is internal by construction and must never ride onto a client-visible
 * card.
 */
const INTERNAL_FIELDS = ["notes", "review_note"] as const;

function publicFields(fields: Record<string, unknown>, reveal: boolean): Record<string, unknown> {
  if (reveal) return fields;
  const out = { ...fields };
  for (const k of INTERNAL_FIELDS) delete out[k];
  return out;
}

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
      return { ...rec, ...publicFields(fix.fields, reveal), id: rec.id, _overlay: stamp(fix, "correction", reveal) };
    }
    const folded = foldIn.get(id);
    if (folded) return { ...rec, ...publicFields(folded.fields, reveal), id: rec.id, _overlay: stamp(folded.row, "correction", reveal) };
    return { ...rec, _overlay: null };
  });

  for (const p of standalone) {
    merged.push({
      ...publicFields(p.fields, reveal),
      id: `${OVERLAY_ID_PREFIX}${p.add.id}`,   // namespaced so it can't collide with a base id
      _overlay: stamp(p.applied ?? p.add, "new", reveal),
    });
  }

  if (opts.onUnmatched) {
    for (const [baseId, row] of corrections) if (!used.has(baseId)) opts.onUnmatched(row);
  }
  return merged;
}

/**
 * Merge approved funder corrections over a list of funder cards.
 *
 * mergeOverlay matches corrections by the record's `id`, and a funder's
 * identity is its EIN — that is what FunderPicker writes into base_id. A card
 * with no EIN cannot be corrected and passes through untouched rather than
 * being dropped.
 *
 * reveal stays false: this output reaches client views, and FG sourcing
 * (source_url, provenance) is internal.
 */
export function applyFunderOverlay<T extends { ein?: string }>(
  funders: T[], overlay: LedgerOverlayRow[], opts: { additions?: boolean } = {},
): T[] {
  // Only an empty overlay is a no-op. An empty funder list still matters when
  // additions are wanted: an approved NEW funder should appear even on a run
  // where the base search came back with nothing.
  if (!overlay.length) return funders;

  // A funder's identity is its EIN — that is what FunderPicker writes into
  // base_id. Cards without one cannot be corrected, and must NOT all be handed
  // the same empty id: mergeOverlay's whole contract is that an id names one
  // record, and a shared "" would let one correction or fold-in splice itself
  // onto every anonymous trust in the list. They get a unique local id that no
  // base_id can ever equal, so they pass through untouched.
  const withIds = funders.map((f, i) => ({
    ...f, id: f.ein?.trim() || `${UNIDENTIFIED_PREFIX}${i}`,
  }));

  // Additions are opt-in. Appending FG-discovered funders to the graph-evidence
  // list would inflate "N funders already backing organizations like yours"
  // with funders the graph says nothing about — a false claim about the one
  // thing that signal exists to assert.
  const rows = opts.additions === false ? overlay.filter(r => r.base_id) : overlay;

  return mergeOverlay(withIds, rows) as unknown as T[];
}
