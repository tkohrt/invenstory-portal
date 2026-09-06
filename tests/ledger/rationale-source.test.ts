/**
 * Which explanations still owe a real answer.
 *
 * A run cut short at the function limit leaves some matches explained and some
 * not. Until this distinction existed, those were indistinguishable from the
 * ones we deliberately chose not to explain, so resuming would either retry the
 * refusals forever or skip the genuinely unfinished ones.
 */
import { describe, expect, test } from "vitest";

// The vocabulary is enforced by a database check constraint and by the resume
// query, so these pin the meanings rather than an implementation.
const SOURCES = ["llm", "rule", "pending"] as const;
type Source = (typeof SOURCES)[number];

/** The rule the resume path applies. */
function shouldRetry(source: Source | null): boolean {
  return source === "pending" || source === null;
}

describe("rationale_source", () => {
  test("a real explanation is never regenerated", () => {
    expect(shouldRetry("llm")).toBe(false);
  });

  test("a deliberate rule-based fallback is final", () => {
    // Two ways to get here: no generation provider, or the model cited a
    // document that does not exist and we refused it. Retrying reaches the
    // same missing provider or invites the same invention.
    expect(shouldRetry("rule")).toBe(false);
  });

  test("an unfinished one is retried", () => {
    expect(shouldRetry("pending")).toBe(true);
  });

  test("a row from before this column existed is retried", () => {
    // Safer than assuming it was finished: the worst case is one wasted call.
    expect(shouldRetry(null)).toBe(true);
  });

  test("the three states are distinct, which is the whole point", () => {
    expect(new Set(SOURCES).size).toBe(3);
  });
});
