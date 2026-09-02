// Filtering the review queue on the two axes that change what a reviewer does.
//
// Kind (funder / grant) changes which fields they read. Type (correction / new
// record) changes what they are deciding: a correction is a comparison against
// what already exists, a new record is a judgment that the thing is real and
// not already present under another name. Those are different mental tasks, and
// the second is the sharper distinction — which is why provenance, useful as it
// is, stays a label inside the list rather than a filter.
//
// Pure and free of `server-only` so it is unit testable.
import { OVERLAY_ID_PREFIX } from "@/lib/ledger-merge";
import type { OverlayQueueRow } from "@/lib/types";

export type KindFilter = "all" | "funder" | "grant";
export type TypeFilter = "all" | "correction" | "new";

/**
 * A row is a correction when it names a base record to override, and a new
 * record when it does not. A base_id of `overlay:<id>` still counts as a
 * correction: it targets a record For Granted itself added, and the reviewer's
 * task is still a comparison.
 */
export function rowType(row: Pick<OverlayQueueRow, "base_id">): "correction" | "new" {
  return row.base_id ? "correction" : "new";
}

export function isOverlayTargeted(row: Pick<OverlayQueueRow, "base_id">): boolean {
  return !!row.base_id && row.base_id.startsWith(OVERLAY_ID_PREFIX);
}

export function filterQueue(
  rows: OverlayQueueRow[], kind: KindFilter, type: TypeFilter,
): OverlayQueueRow[] {
  return rows.filter(r =>
    (kind === "all" || r.kind === kind) &&
    (type === "all" || rowType(r) === type));
}

export interface QueueCounts {
  /** The "Everything" tab on the KIND axis: every kind, current type filter. */
  anyKind: number;
  /** The "Both" tab on the TYPE axis: both types, current kind filter. */
  anyType: number;
  funder: number; grant: number;
  correction: number; new: number;
}

/**
 * Counts for the tab labels.
 *
 * Each axis is counted WITHIN the other axis's current selection, so the
 * numbers describe what clicking would actually show. A "Grants 3" tab that
 * yields one row because a type filter is also on is worse than no number.
 */
export function queueCounts(
  rows: OverlayQueueRow[], kind: KindFilter, type: TypeFilter,
): QueueCounts {
  const byType = filterQueue(rows, "all", type);
  const byKind = filterQueue(rows, kind, "all");
  return {
    // Each axis's "no filter" tab is counted within the OTHER axis's current
    // selection, exactly like its siblings. Counting the raw queue here was a
    // tab promising four rows and rendering two.
    anyKind: byType.length,
    anyType: byKind.length,
    funder: byType.filter(r => r.kind === "funder").length,
    grant: byType.filter(r => r.kind === "grant").length,
    correction: byKind.filter(r => rowType(r) === "correction").length,
    new: byKind.filter(r => rowType(r) === "new").length,
  };
}
