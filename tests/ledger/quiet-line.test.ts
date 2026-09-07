import { describe, it, expect } from "vitest";
import { elapsed, quietLine, QUIET_AFTER_MS } from "@/lib/job";

const base = { kind: "match" as const, lastText: "screening 45 opportunities", previousGapMs: 3000 };

describe("elapsed", () => {
  it("counts seconds under a minute and clock time above", () => {
    expect(elapsed(9_000)).toBe("9s");
    expect(elapsed(59_400)).toBe("59s");
    expect(elapsed(64_000)).toBe("1:04");
    expect(elapsed(600_000)).toBe("10:00");
  });
  it("never goes negative on a clock skew", () => {
    expect(elapsed(-5_000)).toBe("0s");
  });
});

describe("quietLine", () => {
  it("says nothing while the run is reporting normally", () => {
    expect(quietLine({ ...base, quietMs: 0 })).toBeNull();
    expect(quietLine({ ...base, quietMs: QUIET_AFTER_MS - 1 })).toBeNull();
  });

  it("at 20 seconds names the step and compares it to the one before", () => {
    const line = quietLine({ ...base, quietMs: 24_000 })!;
    expect(line).toContain("screening 45 opportunities");
    expect(line).toContain("3s");
    expect(line).toContain("24s");
  });

  it("falls back gracefully when there is nothing to compare against", () => {
    const line = quietLine({ ...base, quietMs: 24_000, previousGapMs: null })!;
    expect(line).toContain("screening 45 opportunities");
    expect(line).not.toContain("step before");
  });

  it("at a minute gives the cause specific to this kind of work", () => {
    expect(quietLine({ ...base, quietMs: 70_000 })!).toContain("sleeps when idle");
    expect(quietLine({ ...base, kind: "search_profile", quietMs: 70_000 })!)
      .toContain("long transcript");
    expect(quietLine({ ...base, kind: "rationales", quietMs: 70_000 })!)
      .toContain("batches of eight");
  });

  it("at two minutes answers the question that actually matters", () => {
    // Not "still working". Whether the wait is costing anything.
    expect(quietLine({ ...base, quietMs: 150_000 })!).toContain("already saved");
  });

  it("escalates rather than cycling", () => {
    const a = quietLine({ ...base, quietMs: 25_000 })!;
    const b = quietLine({ ...base, quietMs: 65_000 })!;
    const c = quietLine({ ...base, quietMs: 130_000 })!;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
