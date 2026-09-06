// Which funder rows are worth showing by default.
//
// Semantic search matches mission text, and an operating charity's mission text
// reads exactly like a funder's because they describe the same work from
// opposite sides of the cheque. A live find_funders call for Ohio private
// foundations returned twenty results with twelve carrying has_grant_history
// false: organizations with no recorded outgoing grants at all.
//
// Deliberately conservative. Only an explicit false hides a row, and only when
// nothing else vouches for it. Everything the dataset merely fails to mention
// stays visible, because a screen that hides on missing data hides the records
// we know least about, which is backwards.
//
// Pure and free of `server-only` so it is unit testable.
import type { FunderRow } from "@/lib/funder-rows";
import type { EligibilityProfile } from "@/lib/eligibility-fields";
import { funderBlock } from "@/lib/funder-eligibility";

export interface HiddenFunder {
  row: FunderRow;
  /** Why it was set aside, so the count is explainable rather than a mystery. */
  reason: string;
}

export interface ScreenedFunders {
  shown: FunderRow[];
  /** Kept and countable, never deleted: a screen nobody can see through is a
   *  screen nobody can tell is wrong. */
  hidden: HiddenFunder[];
}

/**
 * Would this row be set aside?
 *
 * Exported so the table's inline warning and the screen itself are the same
 * predicate. Two conditions that mean the same thing, written twice, drift: a
 * row could carry "No grants on record" while a badge two columns over says For
 * Granted put it there on purpose.
 *
 * A row is set aside only when the source explicitly records no outgoing
 * grants, AND nothing contradicts that:
 *
 *   from_graph      the who-funds-whom graph put it here, which requires real
 *                   grant edges. That outranks any flag.
 *   evidence_count  named peer grantees are grants, whatever the flag says.
 *   from_overlay    For Granted added this funder deliberately.
 *   verified_at     a person checked this record against the funder's own
 *                   materials. The picker even shows them "no grant history on
 *                   record" before they attach, so a verification is somebody
 *                   having seen that warning and recorded a correction anyway.
 *                   Hiding it afterwards would overrule the human with the
 *                   flag they just overruled.
 */
export function hiddenByScreen(r: FunderRow): boolean {
  if (r.has_grant_history !== false) return false;
  return !(r.from_graph || r.evidence_count > 0 || r.from_overlay || !!r.verified_at);
}

/**
 * Partition the shortlist.
 *
 * Two reasons a funder is set aside, and they are different in kind. One is a
 * data-quality guess: the source says this organization grants to nobody, so it
 * is probably an operating charity. The other is a fact the funder stated:
 * their own guidelines preclude this client. Both are shown as a count with a
 * reason and neither is deleted, but conflating them would hide a real
 * eligibility rule behind a noise filter.
 *
 * The eligibility profile is optional. Without it, only the data-quality screen
 * runs, which is the honest behaviour: no profile means nothing to be
 * ineligible against.
 */
export function screenFunders(rows: FunderRow[], p?: EligibilityProfile | null): ScreenedFunders {
  const shown: FunderRow[] = [];
  const hidden: HiddenFunder[] = [];
  for (const r of rows) {
    const block = p ? funderBlock(r, p) : null;
    if (block) { hidden.push({ row: r, reason: block.reason }); continue; }
    if (hiddenByScreen(r)) { hidden.push({ row: r, reason: "no grants on record" }); continue; }
    shown.push(r);
  }
  return { shown, hidden };
}
