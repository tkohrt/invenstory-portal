/**
 * The queue's two axes. Kind changes which fields a reviewer reads; type
 * changes what they are deciding. The counts matter as much as the filtering:
 * a tab promising three rows that yields one is worse than an unlabelled tab.
 */
import { describe, expect, test } from "vitest";
import { filterQueue, queueCounts, rowType, isOverlayTargeted } from "@/lib/overlay-queue";
import type { OverlayQueueRow } from "@/lib/types";

const r = (id: string, kind: "funder" | "grant", base_id: string | null): OverlayQueueRow =>
  ({ id, kind, base_id, provenance: "manual", status: "proposed" } as unknown as OverlayQueueRow);

// two funder corrections, one funder new, one grant correction, two grant new
const Q = [
  r("1", "funder", "340714588"),
  r("2", "funder", "111111111"),
  r("3", "funder", null),
  r("4", "grant", "https://grants.gov/x"),
  r("5", "grant", null),
  r("6", "grant", null),
];

describe("rowType", () => {
  test("a base_id makes it a correction", () => {
    expect(rowType(r("x", "funder", "1"))).toBe("correction");
  });
  test("no base_id makes it a new record", () => {
    expect(rowType(r("x", "funder", null))).toBe("new");
  });
  test("a correction to an FG-added record is still a correction", () => {
    const row = r("x", "grant", "overlay:abc");
    expect(rowType(row)).toBe("correction");
    expect(isOverlayTargeted(row)).toBe(true);
  });
  test("an ordinary base id is not overlay-targeted", () => {
    expect(isOverlayTargeted(r("x", "funder", "340714588"))).toBe(false);
  });
});

describe("filterQueue", () => {
  test("all/all is everything", () => {
    expect(filterQueue(Q, "all", "all")).toHaveLength(6);
  });
  test("one axis at a time", () => {
    expect(filterQueue(Q, "funder", "all")).toHaveLength(3);
    expect(filterQueue(Q, "all", "new")).toHaveLength(3);
  });
  test("the axes compose", () => {
    const out = filterQueue(Q, "grant", "new");
    expect(out.map(x => x.id)).toEqual(["5", "6"]);
  });
  test("an empty intersection is empty, not everything", () => {
    expect(filterQueue([r("1", "funder", "x")], "grant", "all")).toEqual([]);
  });
});

describe("queueCounts", () => {
  test("with no filters, each tab counts its own slice", () => {
    const c = queueCounts(Q, "all", "all");
    expect(c).toEqual({ anyKind: 6, anyType: 6, funder: 3, grant: 3, correction: 3, new: 3 });
  });

  test("the no-filter tabs respect the OTHER axis, which is the whole point", () => {
    // "Everything" on the kind axis, while Corrections is selected, must promise
    // the three corrections — not the six rows in the raw queue.
    expect(queueCounts(Q, "all", "correction").anyKind).toBe(3);
    // "Both" on the type axis, while Grants is selected, must promise three.
    expect(queueCounts(Q, "grant", "all").anyType).toBe(3);
  });

  test("every tab's number equals the rows clicking it renders", () => {
    // The property all six numbers exist for, checked on both axes at once.
    for (const type of ["all", "correction", "new"] as const) {
      const c = queueCounts(Q, "all", type);
      expect(filterQueue(Q, "all", type)).toHaveLength(c.anyKind);
      expect(filterQueue(Q, "funder", type)).toHaveLength(c.funder);
      expect(filterQueue(Q, "grant", type)).toHaveLength(c.grant);
    }
    for (const kind of ["all", "funder", "grant"] as const) {
      const c = queueCounts(Q, kind, "all");
      expect(filterQueue(Q, kind, "all")).toHaveLength(c.anyType);
      expect(filterQueue(Q, kind, "correction")).toHaveLength(c.correction);
      expect(filterQueue(Q, kind, "new")).toHaveLength(c.new);
    }
  });

  test("kind counts respect the active type filter", () => {
    // Showing only new records: 1 funder, 2 grants.
    const c = queueCounts(Q, "all", "new");
    expect(c.funder).toBe(1);
    expect(c.grant).toBe(2);
  });

  test("type counts respect the active kind filter", () => {
    // Showing only grants: 1 correction, 2 new.
    const c = queueCounts(Q, "grant", "all");
    expect(c.correction).toBe(1);
    expect(c.new).toBe(2);
  });

  test("every count matches what clicking that tab actually shows", () => {
    // The property the numbers are for.
    const c = queueCounts(Q, "all", "correction");
    expect(filterQueue(Q, "funder", "correction")).toHaveLength(c.funder);
    expect(filterQueue(Q, "grant", "correction")).toHaveLength(c.grant);
  });

  test("an empty queue counts zero rather than throwing", () => {
    expect(queueCounts([], "all", "all").anyKind).toBe(0);
  });
});
