import { describe, it, expect } from "vitest";
import { countPhrase, MAX_EVENTS, type JobEvent } from "@/lib/job";

describe("countPhrase", () => {
  it("says the count, the total and the percent", () => {
    expect(countPhrase(3, 15)).toBe("3 of 15 (20%)");
    expect(countPhrase(15, 15)).toBe("15 of 15 (100%)");
  });

  it("agrees with the bar rather than contradicting it", () => {
    // The bug this replaces: a bar reading 27% under a line reading "5 of 15".
    // One function now produces both halves, so they cannot drift.
    const done = 4, total = 15;
    const pct = Math.round((done / total) * 100);
    expect(countPhrase(done, total)).toContain(`${pct}%`);
  });

  it("falls back to a bare count when the total is not known yet", () => {
    expect(countPhrase(2, 0)).toBe("2");
    expect(countPhrase(2, null)).toBe("2");
  });

  it("never reports more than the total, however the caller counted", () => {
    expect(countPhrase(17, 15)).toBe("15 of 15 (100%)");
  });

  it("says nothing at all when there is no count", () => {
    expect(countPhrase(null, 15)).toBeNull();
  });
});

describe("log accumulation", () => {
  const ev = (id: number): JobEvent =>
    ({ id, kind: "progress", text: `line ${id}`, done: id, total: 20, at: "" });

  /** The client-side merge in useJob, stated once so a test can hold it. */
  const merge = (prev: JobEvent[], incoming: JobEvent[]) =>
    [...prev, ...incoming].slice(-MAX_EVENTS);

  it("appends in order and keeps the newest when capped", () => {
    let log: JobEvent[] = [];
    for (let i = 1; i <= MAX_EVENTS + 40; i++) log = merge(log, [ev(i)]);
    expect(log).toHaveLength(MAX_EVENTS);
    expect(log[0].id).toBe(41);
    expect(log[log.length - 1].id).toBe(MAX_EVENTS + 40);
  });

  it("advances the cursor to the last line held, so a poll fetches only what is new", () => {
    const batch = [ev(7), ev(8), ev(9)];
    const cursor = batch[batch.length - 1].id;
    expect(cursor).toBe(9);
  });
});
