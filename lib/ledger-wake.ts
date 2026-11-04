// Ground Truth naps (patch 19, 4 November 2026).
//
// The Funder Ledger runs on a host that sleeps when idle. While it starts up,
// its host answers every call at once with 502, 503 or 504, and a search used
// to give up on the first one ("Ground Truth did not answer any query"). These
// are the rules for waiting instead: which answers mean "starting up, ask again",
// how long to wait between tries, and how long a browser should wait for a
// wake-up before letting someone search anyway.
// Pure and free of `server-only`, tested in tests/ledger/ledger-wake.test.ts.

/** Answers a host gives while the service behind it is still starting. */
export function isStartingUp(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/** Waits between tries, in milliseconds. */
export const RETRY_DELAYS_MS = [1_500, 3_000, 5_000, 7_000] as const;

/**
 * How long one call may spend retrying, in total. A search runs inside a
 * 60-second function, with several calls in parallel, so this stays well short.
 */
export const RETRY_BUDGET_MS = 18_000;

/** The wait before try `n` (0-based, after the first failure), or null to stop. */
export function nextDelay(n: number, spentMs: number, budgetMs = RETRY_BUDGET_MS): number | null {
  const d = RETRY_DELAYS_MS[n];
  if (d === undefined) return null;
  return spentMs + d <= budgetMs ? d : null;
}

/** How long a search inside a run may wait for Ground Truth to wake first. */
export const RUN_WAKE_MS = 25_000;

/** How long the page waits for its own wake-up before letting a search go anyway. */
export const PAGE_WAKE_WAIT_MS = 30_000;

/** Browser-side: wake again only if the last wake-up was longer ago than this. */
export const REWAKE_AFTER_MS = 5 * 60_000;

/** The run's message when nothing answered: the page retries once on seeing it. */
export const ASLEEP_MESSAGE = "Ground Truth did not answer any query. Nothing has been changed. It may have been asleep: try again in a minute.";

export function looksAsleep(error: string | null | undefined): boolean {
  return !!error && error.includes("Ground Truth did not answer any query");
}

export function shouldWake(lastWokeAt: number | null, now: number): boolean {
  return lastWokeAt === null || now - lastWokeAt > REWAKE_AFTER_MS;
}
