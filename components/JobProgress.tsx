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
import { describeJob, type Job, type JobKind } from "@/lib/job";

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
  const [gaveUp, setGaveUp] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll while the job is moving. describeJob decides when to stop, so the
  // stall rule and the polling rule can never disagree.
  useEffect(() => {
    if (!job || !describeJob(job).poll) return;
    let live = true;
    let failures = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (!live) return;
        if (res.status === 401 || res.status === 404) {
          // Not a transient failure. Signing out or switching client makes this
          // job unreachable for good, so stop rather than retry forever.
          setGaveUp(true);
          return;
        }
        if (res.ok) {
          failures = 0;
          const { job: next } = await res.json();
          setJob(next as Job);
        } else {
          failures += 1;
        }
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
  }, [job]);

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
  return { job, start, starting, running, error, setError, gaveUp };
}

export default function JobProgress({ job, onDismiss, lostContact }: {
  job: Job | null; onDismiss?: () => void;
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
      {v.detail && <div className="jp-detail">{v.detail}</div>}
      {v.percent !== null && (
        <div className="jp-bar"><div className="jp-fill" style={{ width: `${v.percent}%` }} /></div>
      )}
    </div>
  );
}
