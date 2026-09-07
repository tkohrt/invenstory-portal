import { describe, it, expect } from "vitest";
import type { JobEvent } from "@/lib/job";

/**
 * The regression. Events are written fire-and-forget from inside a loop, so two
 * inserts can be in flight at once and arrive in either order. A real run
 * printed "screening 45 opportunities" AFTER two lines from the step that
 * follows it, because the ordering key was assigned when the row landed rather
 * than when the step fired.
 *
 * The fix is two-sided: the writer stamps `at` when the step happens, and both
 * the server and the browser order by `at` with the row id only as a tie-break.
 * The paging cursor stays the id, because that is what makes paging exact.
 */
const ev = (id: number, at: string, text: string): JobEvent =>
  ({ id, kind: "progress", text, done: null, total: null, at });

const displayOrder = (events: JobEvent[]) =>
  [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);

describe("log ordering", () => {
  it("puts a late-landing row back in the order it happened", () => {
    const arrived = [
      ev(1, "2026-09-07T03:12:11.000Z", "reading what we know about this client"),
      ev(2, "2026-09-07T03:12:14.000Z", "asking 7 questions of the funding data"),
      // Landed fourth, happened third.
      ev(4, "2026-09-07T03:12:52.000Z", "screening 45 opportunities"),
      ev(3, "2026-09-07T03:12:58.000Z", "explaining 31 matches"),
    ];
    expect(displayOrder(arrived).map(e => e.text)).toEqual([
      "reading what we know about this client",
      "asking 7 questions of the funding data",
      "screening 45 opportunities",
      "explaining 31 matches",
    ]);
  });

  it("breaks a tie on the row id, so two lines in one millisecond stay stable", () => {
    const same = "2026-09-07T03:12:11.000Z";
    const arrived = [ev(9, same, "second"), ev(8, same, "first")];
    expect(displayOrder(arrived).map(e => e.text)).toEqual(["first", "second"]);
  });

  it("advances the cursor by the largest id, not the last one in display order", () => {
    // Paging exactness and display order are different questions. Taking the
    // cursor from the last DISPLAYED line would re-fetch a row that arrived
    // out of order, forever.
    const batch = [ev(4, "2026-09-07T03:12:52.000Z", "c"), ev(3, "2026-09-07T03:12:58.000Z", "d")];
    const cursor = Math.max(0, ...batch.map(e => e.id));
    expect(cursor).toBe(4);
    expect(displayOrder(batch)[displayOrder(batch).length - 1].id).toBe(3);
  });
});
