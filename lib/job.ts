// Reading a job's state, and saying it in words a person can act on.
//
// The rule this file exists for: a spinner tells you the browser is alive. It
// does not tell you whether the work is moving, how much is left, or whether it
// died ten minutes ago. Each of those changes what someone should do next, so
// each gets said out loud.
//
// Pure and free of `server-only` so the staleness rule and the copy can be
// tested without a database.

export type JobKind = "match" | "search_profile" | "readiness" | "rationales";
export type JobStatus = "running" | "done" | "failed";

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  label: string | null;
  done: number;
  total: number;
  detail: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/**
 * How long a running job may go quiet before it is presumed dead.
 *
 * A killed serverless function cannot update its own row to say so, so the
 * alternative to this rule is a spinner that turns forever.
 *
 * MUST exceed the routes' maxDuration (300s). Shorter, and a live run that goes
 * quiet during a long step gets declared dead while it is still working and
 * still about to write results: the button re-enables, somebody clicks again,
 * and two runs race the same sweeps.
 */
export const STALL_AFTER_MS = 6 * 60 * 1000;

export function isStalled(j: Job, now = Date.now()): boolean {
  if (j.status !== "running") return false;
  const t = new Date(j.updatedAt).getTime();
  if (isNaN(t)) return true;
  return now - t > STALL_AFTER_MS;
}

/** Whole percent, or null when the work cannot count itself yet. */
export function percent(j: Job): number | null {
  if (j.total <= 0) return null;
  return Math.min(100, Math.round((Math.min(j.done, j.total) / j.total) * 100));
}

export interface JobView {
  /** The headline. Says what is happening, not that something is. */
  title: string;
  /** The second line: where it has got to, or what went wrong. */
  detail: string | null;
  tone: "working" | "done" | "failed" | "stalled";
  percent: number | null;
  /** True while the page should keep polling. */
  poll: boolean;
}

const WORKING: Record<JobKind, string> = {
  match: "Searching for funding",
  search_profile: "Reading the Inven(s)tory",
  readiness: "Reading the Inven(s)tory",
  rationales: "Finishing the explanations",
};

const DONE: Record<JobKind, string> = {
  match: "Search finished",
  search_profile: "Finished reading",
  readiness: "Finished reading",
  rationales: "Explanations finished",
};

/**
 * Turn a job row into something worth showing.
 *
 * The elapsed-time line is not decoration. The Ledger sleeps when idle and the
 * first call after a quiet spell can take a minute, which is indistinguishable
 * from a hang unless somebody says so. Saying it at the moment the wait becomes
 * unusual is better than a permanent disclaimer nobody reads.
 */
export function describeJob(j: Job, now = Date.now()): JobView {
  const pct = percent(j);

  if (j.status === "failed") {
    return {
      title: "That did not finish",
      // Deliberately does not claim nothing changed. A run can fail after the
      // grant tables are written and before the funder ones are, and telling
      // somebody their data is untouched when it is half-replaced is worse than
      // saying less.
      detail: j.error ?? "Something went wrong. Check the results before relying on them.",
      tone: "failed", percent: null, poll: false,
    };
  }

  if (j.status === "done") {
    return { title: DONE[j.kind], detail: j.detail, tone: "done", percent: null, poll: false };
  }

  if (isStalled(j, now)) {
    return {
      title: "This looks stuck",
      detail: "Nothing has moved for a few minutes, so the run has probably died. "
        + "Nothing has been changed. Try again.",
      tone: "stalled", percent: null, poll: false,
    };
  }

  const elapsed = Math.max(0, now - new Date(j.startedAt).getTime());
  const parts: string[] = [];
  if (j.detail) parts.push(j.detail);
  else if (j.total > 0) parts.push(`${j.done} of ${j.total}`);

  if (elapsed > 25_000 && j.kind === "match") {
    parts.push("the funding service sleeps when idle, so the first search after a quiet spell takes a minute to wake it");
  } else if (elapsed > 45_000) {
    parts.push("still going");
  }
  // The hosting plan allows a minute per run. Past that the work is killed
  // mid-flight, which shows up here as a job that stops moving, so it is worth
  // warning before it happens rather than explaining afterwards.
  if (elapsed > 55_000) {
    parts.push("close to the time limit for a single run; if it stops here, run it again and it will pick up faster with the service already awake");
  }

  return {
    title: j.label ?? WORKING[j.kind],
    detail: parts.length ? parts.join(", ") : null,
    tone: "working", percent: pct, poll: true,
  };
}
