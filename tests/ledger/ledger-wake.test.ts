/** Waiting for a napping Ground Truth (patch 19, 4 Nov 2026). */
import { describe, expect, test } from "vitest";
import { isStartingUp, nextDelay, looksAsleep, shouldWake, ASLEEP_MESSAGE, RETRY_BUDGET_MS, REWAKE_AFTER_MS } from "@/lib/ledger-wake";

describe("ledger wake rules", () => {
  test("only start-up answers are retried", () => {
    expect([502, 503, 504].every(isStartingUp)).toBe(true);
    expect([200, 400, 401, 404, 500].some(isStartingUp)).toBe(false);
  });
  test("waits grow, and stop at the budget", () => {
    expect(nextDelay(0, 0)).toBe(1500);
    expect(nextDelay(1, 1500)).toBe(3000);
    expect(nextDelay(2, 4500)).toBe(5000);
    expect(nextDelay(3, 9500)).toBe(7000);
    expect(nextDelay(4, 16500)).toBeNull();
    expect(nextDelay(3, RETRY_BUDGET_MS - 1000)).toBeNull();
  });
  test("the page recognises the run's asleep message, and nothing else", () => {
    expect(looksAsleep(ASLEEP_MESSAGE)).toBe(true);
    expect(looksAsleep("The Ledger rejected our key (check FUNDER_LEDGER_KEY).")).toBe(false);
    expect(looksAsleep(null)).toBe(false);
  });
  test("a browser wakes it again only after a quiet spell", () => {
    expect(shouldWake(null, 1000)).toBe(true);
    expect(shouldWake(1000, 1000 + REWAKE_AFTER_MS)).toBe(false);
    expect(shouldWake(1000, 1001 + REWAKE_AFTER_MS)).toBe(true);
  });
});
