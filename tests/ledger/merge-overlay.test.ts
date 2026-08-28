/**
 * mergeOverlay decides what a client actually sees when the frozen Ledger base
 * disagrees with For Granted's verified corrections. No database needed.
 */
import { describe, expect, test } from "vitest";
import { mergeOverlay, OVERLAY_ID_PREFIX } from "@/lib/ledger-merge";
import type { LedgerOverlayRow } from "@/lib/types";

const row = (o: Partial<LedgerOverlayRow>): LedgerOverlayRow => ({
  id: "r1", kind: "grant", base_id: null, ein: null, opportunity_number: null,
  title: null, fields: {}, source_url: "https://example.org/x",
  provenance: "manual", surfaced_for_tenant: null, status: "approved",
  confidence: null, proposed_by: null, reviewed_by: null,
  reviewed_at: "2026-08-01T00:00:00+00:00", review_note: null,
  created_at: "2026-07-01T00:00:00+00:00", updated_at: "2026-08-01T00:00:00+00:00",
  ...o,
});

describe("mergeOverlay", () => {
  test("a correction overrides base fields but never the join key", () => {
    const base = [{ id: "G-1", close_date: "2026-07-01", title: "Old" }];
    const out = mergeOverlay(base, [row({ base_id: "G-1", fields: { close_date: "2027-03-01", id: "HACK" } })]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("G-1");
    expect(out[0].close_date).toBe("2027-03-01");
    expect(out[0]._overlay?.kind).toBe("correction");
  });

  test("base is not mutated", () => {
    const base = [{ id: "G-1", close_date: "2026-07-01" }];
    mergeOverlay(base, [row({ base_id: "G-1", fields: { close_date: "2027-03-01" } })]);
    expect(base[0].close_date).toBe("2026-07-01");
  });

  test("FG-internal sourcing is hidden unless the caller reveals it", () => {
    const base = [{ id: "G-1" }];
    const overlay = [row({ base_id: "G-1", fields: { x: 1 } })];
    expect(mergeOverlay(base, overlay)[0]._overlay?.source_url).toBeUndefined();
    expect(mergeOverlay(base, overlay, { reveal: true })[0]._overlay?.source_url).toBe("https://example.org/x");
  });

  test("a new record joins the candidate set under a namespaced id", () => {
    const out = mergeOverlay([{ id: "G-1" }], [row({ id: "abc", fields: { title: "Found by FG" } })]);
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe(`${OVERLAY_ID_PREFIX}abc`);
    expect(out[1]._overlay?.kind).toBe("new");
  });

  test("a correction to an overlay-added record is applied, not dropped", () => {
    const add = row({ id: "abc", fields: { title: "Found by FG", award_ceiling: 25000 } });
    const fix = row({ id: "def", base_id: `${OVERLAY_ID_PREFIX}abc`, fields: { award_ceiling: 40000 } });
    const out = mergeOverlay([], [add, fix]);
    expect(out).toHaveLength(1);
    expect(out[0].award_ceiling).toBe(40000);
    expect(out[0].title).toBe("Found by FG");
  });

  test("a correction whose base record is absent is reported, not silently lost", () => {
    const lost: string[] = [];
    const out = mergeOverlay([{ id: "G-1" }], [row({ id: "z", base_id: "G-999", fields: {} })], {
      onUnmatched: r => lost.push(r.id),
    });
    expect(out).toHaveLength(1);
    expect(lost).toEqual(["z"]);
  });

  test("an addition that duplicates a base record by EIN folds in instead of double-listing", () => {
    const base = [{ id: "F-1", ein: "86-3418425", name: "Fund The Climb" }];
    const add = row({ kind: "funder", ein: "863418425", fields: { name: "Fund The Climb Foundation" } });
    const out = mergeOverlay(base, [add]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("F-1");
    expect(out[0].name).toBe("Fund The Climb Foundation");
  });

  test("an explicit correction wins over a same-identifier fold-in", () => {
    const base = [{ id: "F-1", ein: "12-3456789", name: "Base" }];
    const fix = row({ id: "fix", kind: "funder", base_id: "F-1", fields: { name: "Corrected" } });
    const dupe = row({ id: "dupe", kind: "funder", ein: "12-3456789", fields: { name: "Duplicate" } });
    const out = mergeOverlay(base, [fix, dupe]);
    expect(out).toHaveLength(2);              // the dupe stands alone rather than clobbering the correction
    expect(out[0].name).toBe("Corrected");
  });

  test("records with no overlay pass through untouched and marked", () => {
    const out = mergeOverlay([{ id: "G-1", title: "As shipped" }], []);
    expect(out[0].title).toBe("As shipped");
    expect(out[0]._overlay).toBeNull();
  });
});
