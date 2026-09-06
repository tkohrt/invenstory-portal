/**
 * What a waiting person is told.
 *
 * The rule: a spinner says the browser is alive, and nothing else. Whether the
 * work is moving, how much is left, and whether it died four minutes ago each
 * change what somebody should do next, so each has to be said.
 */
import { describe, expect, test } from "vitest";
import { describeJob, isStalled, percent, STALL_AFTER_MS, type Job } from "@/lib/job";

const NOW = new Date("2026-09-06T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const job = (o: Partial<Job>): Job => ({
  id: "j1", kind: "match", status: "running", label: "Searching for funding",
  done: 0, total: 0, detail: null, result: null, error: null,
  startedAt: ago(2000), updatedAt: ago(2000), finishedAt: null, ...o,
});

describe("isStalled", () => {
  test("a job that just reported in is not stalled", () => {
    expect(isStalled(job({ updatedAt: ago(5000) }), NOW)).toBe(false);
  });

  test("a running job gone quiet is presumed dead", () => {
    // A killed function cannot update its own row to say so. Without this the
    // spinner turns forever.
    expect(isStalled(job({ updatedAt: ago(STALL_AFTER_MS + 1000) }), NOW)).toBe(true);
  });

  test("a finished job is never stalled, however old", () => {
    expect(isStalled(job({ status: "done", updatedAt: ago(864000000) }), NOW)).toBe(false);
    expect(isStalled(job({ status: "failed", updatedAt: ago(864000000) }), NOW)).toBe(false);
  });

  test("an unreadable timestamp counts as stalled rather than as fresh", () => {
    expect(isStalled(job({ updatedAt: "not a date" }), NOW)).toBe(true);
  });
});

describe("percent", () => {
  test("null when the work cannot count itself yet", () => {
    expect(percent(job({ total: 0, done: 0 }))).toBeNull();
  });
  test("a normal fraction", () => {
    expect(percent(job({ done: 3, total: 4 }))).toBe(75);
  });
  test("never over 100, even if the counts disagree", () => {
    expect(percent(job({ done: 9, total: 4 }))).toBe(100);
  });
});

describe("the stall window and the function limit", () => {
  test("a job may go quiet for longer than a run is allowed to take", () => {
    // The routes declare maxDuration 300s. If the stall window were shorter, a
    // live run in a long step would be declared dead while still working: the
    // button re-enables, somebody clicks again, and two runs race the same
    // sweeps.
    const MAX_DURATION_MS = 300_000;
    expect(STALL_AFTER_MS).toBeGreaterThan(MAX_DURATION_MS);
  });
});

describe("describeJob", () => {
  test("a failure relays what happened, and stops polling", () => {
    const v = describeJob(job({ status: "failed", error: "Ground Truth did not answer any query." }), NOW);
    expect(v.tone).toBe("failed");
    expect(v.detail).toBe("Ground Truth did not answer any query.");
    expect(v.poll).toBe(false);
  });

  test("the generic failure does not promise the data is untouched", () => {
    // A run can fail after the grant tables are replaced and before the funder
    // ones are. Claiming nothing changed would be worse than saying less.
    const v = describeJob(job({ status: "failed", error: null }), NOW);
    expect(v.detail?.toLowerCase()).not.toContain("nothing was changed");
    expect(v.detail?.toLowerCase()).not.toContain("nothing has been changed");
  });

  test("a stall is distinguished from a failure and from working", () => {
    // Three different situations that a single spinner would render identically.
    const v = describeJob(job({ updatedAt: ago(STALL_AFTER_MS + 1000) }), NOW);
    expect(v.tone).toBe("stalled");
    expect(v.title).toContain("stuck");
    expect(v.poll).toBe(false);
  });

  test("success stops polling and keeps the summary", () => {
    const v = describeJob(job({ status: "done", detail: "12 opportunities kept" }), NOW);
    expect(v.tone).toBe("done");
    expect(v.detail).toBe("12 opportunities kept");
    expect(v.poll).toBe(false);
  });

  test("a short wait says what is happening, without excuses", () => {
    const v = describeJob(job({ startedAt: ago(3000), detail: "screening 40 opportunities" }), NOW);
    expect(v.tone).toBe("working");
    expect(v.detail).toBe("screening 40 opportunities");
    expect(v.poll).toBe(true);
  });

  test("a long match wait explains the sleeping service", () => {
    // The commonest "is this broken" moment in the product, and the answer is
    // known, so it gets said at the point the wait becomes unusual.
    const v = describeJob(job({ kind: "match", startedAt: ago(30000) }), NOW);
    expect(v.detail).toContain("sleeps when idle");
  });

  test("a long non-match wait says it is still going rather than inventing a reason", () => {
    const v = describeJob(job({ kind: "search_profile", startedAt: ago(60000) }), NOW);
    expect(v.detail).toContain("still going");
    expect(v.detail).not.toContain("sleeps when idle");
  });

  test("counts stand in when there is no named step", () => {
    const v = describeJob(job({ done: 2, total: 9, startedAt: ago(2000) }), NOW);
    expect(v.detail).toBe("2 of 9");
    expect(v.percent).toBe(22);
  });

  test("polling and the stall rule can never disagree", () => {
    // The component polls on describeJob().poll, so the two rules are one rule.
    const stalled = job({ updatedAt: ago(STALL_AFTER_MS + 1) });
    expect(describeJob(stalled, NOW).poll).toBe(isStalled(stalled, NOW) === false);
  });
});
