"use client";
// Showing that work is happening, and what kind.
//
// A spinner says the browser is alive. It does not say whether the work is
// moving, how much is left, or whether it died four minutes ago, and each of
// those changes what somebody should do next. So this polls a job row and says
// the specific thing.
//
// It also survives a reload. The work runs on the server against a row, not in
// this tab, so someone can close the page, come back, and rejoin it.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  countPhrase, describeJob, elapsed, quietLine, MAX_EVENTS,
  type Job, type JobEvent, type JobKind,
} from "@/lib/job";

const POLL_MS = 2000;
/**
 * Give up after this many consecutive failed polls.
 *
 * Without it a poll that can never succeed (an expired session, a job id from
 * another tenant after a client switch, a read error) reschedules itself
 * forever: the job object never changes, so the effect never re-runs, so the
 * stall rule in the effect guard can never stop it. The panel would say "this
 * looks stuck" while quietly making a request every two seconds for as long as
 * the tab stayed open.
 */
const MAX_POLL_FAILURES = 5;

export function useJob(initial: Job | null) {
  const [job, setJob] = useState<Job | null>(initial);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [gaveUp, setGaveUp] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The id of the last line we hold. Every read asks for what comes after it,
  // so a two-second poll fetches the two new lines rather than the whole run.
  const afterRef = useRef(0);

  /**
   * Read a job and whatever is new in its log.
   *
   * One function for the poll and for a caller driving its own chain, so the
   * log cannot end up with a hole in it because two code paths fetched the
   * same job different ways.
   *
   * The endpoint returns no events at all to a client session, and that is not
   * an error: the log stays empty and everything else behaves as before.
   */
  const syncJob = useCallback(async (id: string): Promise<Job | null | "gone"> => {
    const res = await fetch(`/api/jobs/${id}?after=${afterRef.current}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 404) return "gone";
    if (!res.ok) throw new Error("poll failed");
    const body = await res.json() as { job: Job; events?: JobEvent[] };
    if (body.events?.length) {
      // The cursor is the largest id seen, which is what makes paging exact.
      // The DISPLAY order is by when each line happened, which is a different
      // question: an insert from inside a loop can land after one that came
      // later, so the two orders are not the same and only one of them is what
      // a reader wants.
      afterRef.current = Math.max(afterRef.current, ...body.events.map(e => e.id));
      setEvents(prev => [...prev, ...body.events!]
        .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
        .slice(-MAX_EVENTS));
    }
    if (body.job) setJob(body.job);
    return body.job ?? null;
  }, []);

  // Poll while the job is moving. describeJob decides when to stop, so the
  // stall rule and the polling rule can never disagree.
  useEffect(() => {
    if (!job || !describeJob(job).poll) return;
    let live = true;
    let failures = 0;
    const tick = async () => {
      try {
        const r = await syncJob(job.id);
        if (!live) return;
        if (r === "gone") {
          // Not a transient failure. Signing out or switching client makes this
          // job unreachable for good, so stop rather than retry forever.
          setGaveUp(true);
          return;
        }
        failures = 0;
      } catch {
        // A dropped poll is not a failed job, but an endless run of them is.
        failures += 1;
      }
      if (!live) return;
      if (failures >= MAX_POLL_FAILURES) { setGaveUp(true); return; }
      timer.current = setTimeout(tick, POLL_MS);
    };
    timer.current = setTimeout(tick, POLL_MS);
    return () => { live = false; if (timer.current) clearTimeout(timer.current); };
  }, [job, syncJob]);

  const start = useCallback(async (url: string, kind: JobKind, body?: unknown) => {
    setError(null); setStarting(true); setGaveUp(false);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Could not start that.");
      }
      const { jobId } = await res.json();
      const now = new Date().toISOString();
      // A new run gets a clean log rather than continuing the last one's.
      afterRef.current = 0;
      setEvents([]);
      // Optimistic row so the panel appears immediately rather than after the
      // first poll two seconds later.
      setJob({
        // The real kind, not a guess. describeJob words everything from it, and
        // a Search Profile rebuild labelled "match" would offer an excuse about
        // a sleeping funding service it never calls.
        id: jobId, kind, status: "running", label: null,
        done: 0, total: 0, detail: null, result: null, error: null,
        startedAt: now, updatedAt: now, finishedAt: null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start that.");
    } finally {
      setStarting(false);
    }
  }, []);

  const running = !!job && !gaveUp && describeJob(job).poll;
  const resetEvents = useCallback(() => { afterRef.current = 0; setEvents([]); }, []);
  // setJob is exported so a caller driving its own chain can show real progress
  // between invocations rather than waiting for the next poll.
  return { job, setJob, events, syncJob, resetEvents, start, starting, running, error, setError, gaveUp };
}

/**
 * What happened, in order.
 *
 * Replaces a stack of boxes that each said one transient thing and then
 * vanished. The reason it is a list rather than a better single line: the
 * questions people actually have about a long run are sequential ones. Where is
 * it now, what has it already finished, what did it skip and why, and where did
 * it stop. A field that gets overwritten can answer at most the first.
 *
 * Admin-only, enforced at the endpoint rather than here: a client session is
 * simply served no events, so this renders nothing and the panel above it is
 * unchanged.
 */
function JobLog({ events, kind, live }: {
  events: JobEvent[];
  kind: JobKind;
  /** Still expecting more lines. A finished run does not narrate its silence. */
  live: boolean;
}) {
  const box = useRef<HTMLOListElement | null>(null);
  const last = events.length ? events[events.length - 1].id : 0;

  // Ticks once a second while live, so the clock on the newest line moves and
  // the quiet message appears at the moment the wait becomes unusual rather
  // than when the server next has something to say.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  // Follow the newest line, but only while the reader is already at the bottom.
  // Yanking the view back down while somebody is reading an earlier line is
  // worse than not scrolling at all.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [last]);

  if (!events.length) return null;

  const newest = events[events.length - 1];
  const newestAt = new Date(newest.at).getTime();
  const previous = events.length > 1 ? new Date(events[events.length - 2].at).getTime() : null;
  const quietMs = live && !isNaN(newestAt) ? Math.max(0, now - newestAt) : 0;
  const quiet = live
    ? quietLine({
        kind, quietMs, lastText: newest.text,
        previousGapMs: previous != null && !isNaN(previous) ? newestAt - previous : null,
      })
    : null;

  return (
    <>
    <ol className="jl" ref={box}>
      {events.map(e => {
        // Only when the writer attached one. A count is shown because the
        // step counts ITEMS; a step that counts stages leaves it off and lets
        // the bar say so, rather than putting two denominators in one line:
        // "explaining match 16 of 31 — 3 of 5 (60%)".
        const count = e.kind === "progress" ? countPhrase(e.done, e.total) : null;
        return (
          <li key={e.id} className={`jl-${e.kind}`}>
            <span className="jl-mark" aria-hidden="true" />
            <span className="jl-text">{e.text}</span>
            {count && <span className="jl-count">{count}</span>}
            {/* Only the newest line carries a clock. Every line carrying one
                turns a log into a stopwatch collection. */}
            {live && e.id === newest.id && quietMs >= 3000 && (
              <span className="jl-clock">{elapsed(quietMs)}</span>
            )}
          </li>
        );
      })}
    </ol>
    {quiet && <p className="jl-quiet">{quiet}</p>}
    </>
  );
}

export default function JobProgress({ job, events = [], onDismiss, lostContact }: {
  job: Job | null;
  /** The run's log, oldest first. Empty for a client session, which is fine. */
  events?: JobEvent[];
  onDismiss?: () => void;
  /** Polling gave up. The work may still be running; we just cannot see it. */
  lostContact?: boolean;
}) {
  // Re-render on a timer while working, so the elapsed-time copy ("the service
  // sleeps when idle") appears at the moment the wait becomes unusual rather
  // than only when the server next reports in.
  const [, bump] = useState(0);
  // Gated on whether we are still polling, not on the stored status. A killed
  // function leaves the row saying "running" forever, and this would then tick
  // every second for as long as the page stayed open.
  const ticking = !!job && !lostContact && describeJob(job).poll;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => bump(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  if (!job) return null;
  const v = lostContact
    ? {
        title: "Lost track of this run", tone: "stalled" as const, percent: null, poll: false,
        detail: "The page can no longer read its progress, which usually means the session "
          + "changed. The work may still have finished. Reload to see where it got to.",
      }
    : describeJob(job);

  return (
    <div className={`jp jp-${v.tone}`} role="status" aria-live="polite">
      <div className="jp-head">
        {v.tone === "working" && <span className="jp-spin" aria-hidden="true" />}
        <strong>{v.title}</strong>
        {v.percent !== null && <span className="jp-pct">{v.percent}%</span>}
        {(v.tone === "done" || v.tone === "failed" || v.tone === "stalled") && onDismiss && (
          <button type="button" className="fc-link jp-dismiss" onClick={onDismiss}>dismiss</button>
        )}
      </div>
      {/* The one-line detail is the collapsed view of the same run. With a log
          on screen it repeats the newest line, so it steps aside. */}
      {v.detail && !events.length && <div className="jp-detail">{v.detail}</div>}
      {v.percent !== null && (
        <div className="jp-bar"><div className="jp-fill" style={{ width: `${v.percent}%` }} /></div>
      )}
      <JobLog events={events} kind={job.kind} live={v.poll && !lostContact} />
    </div>
  );
}
