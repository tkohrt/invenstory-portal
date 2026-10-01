import { describe, expect, test } from "vitest";
import { estimateRemainingMs, roughly, FINISH_MS, DEFAULT_MS_PER_UNIT } from "@/lib/job";

describe("estimateRemainingMs", () => {
  const startedAt = "2026-10-01T12:00:00Z";
  test("uses the pace of units finished in this run", () => {
    // Two documents in 60s: 30s each; 4 left.
    const ms = estimateRemainingMs({ done: 6, total: 10, startedAt, unitTimes: ["2026-10-01T12:00:30Z", "2026-10-01T12:01:00Z"] });
    expect(ms).toBe(4 * 30_000 + FINISH_MS);
  });
  test("guesses a round default before anything is timed", () => {
    expect(estimateRemainingMs({ done: 0, total: 3, startedAt, unitTimes: [] })).toBe(3 * DEFAULT_MS_PER_UNIT + FINISH_MS);
  });
  test("only the finish is left when every document is read; null when there is nothing to count", () => {
    expect(estimateRemainingMs({ done: 5, total: 5, startedAt, unitTimes: [] })).toBe(FINISH_MS);
    expect(estimateRemainingMs({ done: 0, total: 0, startedAt, unitTimes: [] })).toBeNull();
  });
  test("roughly", () => {
    expect(roughly(30_000)).toBe("under a minute");
    expect(roughly(70_000)).toBe("about a minute");
    expect(roughly(185_000)).toBe("about 3 minutes");
    expect(roughly(null)).toBeNull();
  });
});
