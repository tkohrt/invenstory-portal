// When a server-carried build has stopped between stages and should be picked up again (3 October 2026).
import { expect, test } from "vitest";
import { chainStalled } from "@/lib/job";

const now = Date.parse("2026-10-03T15:43:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

test("no lease and quiet for more than 15 seconds is stopped", () => {
  expect(chainStalled({ updatedAt: ago(16_000), claimedAt: null }, now)).toBe(true);
  expect(chainStalled({ updatedAt: ago(5_000), claimedAt: null }, now)).toBe(false);
});

test("a stage holding the lease is left alone until the lease expires", () => {
  expect(chainStalled({ updatedAt: ago(60_000), claimedAt: ago(60_000) }, now)).toBe(false);
  expect(chainStalled({ updatedAt: ago(120_000), claimedAt: ago(100_000) }, now)).toBe(true);
});
