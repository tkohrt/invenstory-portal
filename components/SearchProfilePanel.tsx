"use client";
// What we say about this client when we go looking for money, and where each
// line came from.
//
// This exists so a disappointing run can be diagnosed rather than argued about.
// Without it a bad row is ambiguous three ways: the retrieval was wrong, the
// query was wrong, or the document behind the query was wrong. With the profile
// and the exact query text on screen, it is usually obvious which.
//
// Admin only. It shows document titles and quotes, which is For Granted's
// working view of a client's Inven(s)tory rather than a client-facing one.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import JobProgress, { useJob } from "./JobProgress";
import type { Job } from "@/lib/job";
import { FACET_LABEL, FACETS, type ProfileFact, type Facet } from "@/lib/search-profile";

export interface PanelProfile {
  facts: ProfileFact[];
  generatedAt: string;
  documentCount: number;
  note: string | null;
  stale: boolean;
}

/** "RE-Assist's", but "Bridges'" rather than "Bridges's". */
function possessive(name: string) {
  const n = (name ?? "").trim();
  if (!n) return "This client's";
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

export default function SearchProfilePanel({
  profile, lastQueries, orgName, job: initialJob, stored,
}: {
  profile: PanelProfile | null;
  lastQueries: { track: string; text: string; ok?: boolean; results?: number }[];
  orgName: string;
  /** A rebuild already in flight when the page loaded. */
  job: Job | null;
  /**
   * Documents already read and kept, from the server rather than this tab.
   *
   * Without it "Continue" existed only in the browser's memory: a reload left
   * partial work in the database with no way to reach it, and the only button
   * on screen was one that deleted it.
   */
  stored: { done: number; total: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { job, setJob, events, syncJob, resetEvents, starting, running, error, gaveUp } = useJob(initialJob);
  const [dismissed, setDismissed] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Partial work exists and no profile was assembled from it. Server truth on
  // load, updated by the chain as it goes.
  const [partial, setPartial] = useState(!profile && stored.done > 0);

  const finished = job?.status;
  useEffect(() => { if (finished === "done") router.refresh(); }, [finished, router]);

  /**
   * Read the whole Inven(s)tory, however many invocations that takes.
   *
   * A large one is minutes of model time and no single request gets that long,
   * so this is a loop: each call reads what fits, keeps it, and says what is
   * left. The decision to come back is made from the RESPONSE, not from a
   * string in a progress field that other writers own.
   *
   * Everything read is saved, so closing the tab pauses this rather than losing
   * it, and Continue picks it up.
   */
  const runChain = useCallback(async (restart: boolean) => {
    setDismissed(false); setChainError(null); setWorking(true);
    if (restart) resetEvents();
    let jobRef: string | null = null;

    // Tell the row it ended. Without this the browser stops and the row still
    // says "running", so the progress panel spins over work that is over.
    //
    // The row is also where the reason gets written, so it reaches the log and
    // survives a reload rather than living in this tab.
    const stop = async (reason: string) => {
      setChainError(reason);
      try {
        await fetch("/api/jobs/search-profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stop: true, reason }),
        });
        if (jobRef) await syncJob(jobRef);
      } catch { /* the message on screen is the part that matters */ }
    };

    try {
      // Bounded. A loop that cannot terminate is worse than one that stops
      // early and says so.
      for (let pass = 0; pass < 40; pass++) {
        const res = await fetch("/api/jobs/search-profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ restart: restart && pass === 0 }),
        });
        const r = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(r.error ?? "Reading failed.");

        // Server truth about what is kept, so the buttons stay right even if
        // this tab is closed and reopened mid-build.
        setPartial(!r.complete && (r.done ?? 0) > 0);
        if (r.jobId) { jobRef = r.jobId; await syncJob(r.jobId).catch(() => null); }

        if (r.complete) { setPartial(false); router.refresh(); return; }

        // Another tab holds the lease. Wait rather than racing it.
        if (r.busy) { await new Promise(f => setTimeout(f, 3000)); continue; }

        // A pass now always reads at least one document, so `read` of zero with
        // work left is a real dead end rather than a slow pass, and one pass is
        // enough to know it.
        //
        // This used to compare the TOTAL read so far across passes, which is a
        // different question, and it answered the wrong one: it declared the
        // build stuck while every pass was working correctly.
        if ((r.read ?? 0) === 0) {
          await stop(`Stopped after reading ${r.done} of ${r.total} documents: a pass read nothing `
            + "while documents were still outstanding. What has been read is saved, and Continue "
            + "tries again from here.");
          return;
        }
      }
      await stop("Stopped after many passes without finishing. What has been read is saved.");
    } catch (e) {
      await stop(e instanceof Error ? e.message : "Reading failed. What has been read is saved.");
    } finally {
      setWorking(false);
    }
  }, [router, syncJob, resetEvents]);

  const rebuild = () => void runChain(true);
  const carryOn = () => void runChain(false);

  /**
   * Re-merge without re-reading.
   *
   * Reading costs minutes and real money; merging is free. They also go wrong
   * for different reasons, so they get different buttons. When the selection
   * rule changes and the documents have not, this is the whole fix.
   */
  const reassemble = useCallback(async () => {
    setChainError(null); setWorking(true);
    try {
      const res = await fetch("/api/jobs/search-profile", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ reassemble: true }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error ?? "Could not rebuild the profile.");
      if (r.jobId) await syncJob(r.jobId).catch(() => null);
      router.refresh();
    } catch (e) {
      setChainError(e instanceof Error ? e.message : "Could not rebuild the profile.");
    } finally {
      setWorking(false);
    }
  }, [router, syncJob]);
  const busy = working || starting || running;

  /**
   * Three states, from what the SERVER has, not from what this tab remembers.
   *
   * The old rule had two, keyed only on a finished profile, so a page reload
   * during a staged build offered "Build it" as the only action while five
   * documents sat unused in the database. Pressing it deleted them.
   */
  const cta = profile
    ? { label: "Rebuild", hint: "Forgets what was read and starts over." }
    : partial
      ? {
          label: "Continue",
          hint: `Picks up from the ${stored.done} document(s) already read rather than starting again.`,
        }
      : { label: "Build it", hint: "Reads this Inven(s)tory and builds the profile the search runs on." };

  // Only facts that may describe the client. Competitor and partner lines are
  // kept in the data and deliberately not shown as if they were ours.
  const own = (profile?.facts ?? []).filter(f => f.subject === "organization");
  const others = (profile?.facts ?? []).filter(f => f.subject !== "organization");
  const byFacet = (f: Facet) => own.filter(x => x.facet === f);

  return (
    <div className="sp">
      <div className="sp-head">
        <strong>{possessive(orgName)} Funder Matching Profile:</strong>
        {/* Native title= is what the rest of this panel uses, but it truncates
            long text in some browsers and never appears on keyboard focus. This
            one sentence is the only explanation of what the profile is FOR, so
            it gets a real tooltip that a keyboard reaches. */}
        <span className="sp-info" tabIndex={0} role="note"
              aria-label="Your Funder Matching Profile is what For Granted uses to search our Ground Truth database for highly aligned funders and opportunities.">
          <span aria-hidden="true">i</span>
          <span className="sp-tip" aria-hidden="true">
            Your Funder Matching Profile is what For Granted uses to search our
            Ground Truth database for highly aligned funders and opportunities.
          </span>
        </span>
        <span className="ov-spacer" />
        {profile && (
          <button type="button" className="fc-link" onClick={() => setOpen(v => !v)}>
            {open ? "Hide" : "Expand"}
          </button>
        )}
        {/* Free and instant, so it is a link rather than a button competing
            with the one that costs three minutes. */}
        {profile && stored.done > 0 && (
          <button type="button" className="fc-link" onClick={() => void reassemble()}
                  disabled={busy}
                  title="Re-merges the facts already read into the profile. Reads nothing again, so it costs nothing and takes a moment.">
            re-merge
          </button>
        )}
        {/* Start over is deliberately the QUIET button whenever there is
            partial work, and deliberately separate from the loud one. The loud
            button must never be the one that deletes minutes of model spend. */}
        {partial && !profile && (
          <button type="button" className="btn ghost" onClick={rebuild} disabled={busy}
                  title="Forgets the documents already read and starts from the first one.">
            Start over
          </button>
        )}
        {/* Loud until the profile exists, quiet forever after. A Rebuild that
            pulses is asking to be pressed, and pressing it throws away every
            document already read. */}
        <button type="button"
                className={profile ? "btn ghost" : `btn sp-build${busy ? "" : " sp-build-pulse"}`}
                onClick={profile ? rebuild : partial ? carryOn : rebuild}
                disabled={busy}
                title={cta.hint}>
          {working ? "Reading…" : cta.label}
        </button>
      </div>

      {!profile && !partial && (
        <p className="ov-note">
          Nothing built yet. Matching is falling back to the eligibility form,
          which knows the organization type and cause areas and nothing about
          what makes this client fundable.
        </p>
      )}

      {!profile && partial && (
        <p className="ov-note">
          Part-built: {stored.done} of {stored.total} document(s) read and saved,
          nothing assembled yet. Matching still falls back to the eligibility
          form until the reading finishes. Continue picks up where it stopped.
        </p>
      )}

      {profile && (
        <p className="ov-note">
          {profile.note ?? `Built from ${profile.documentCount} document(s).`}
          {/* Formatted from the ISO string rather than with toLocaleDateString:
              a client component renders under the server's locale during SSR
              and the browser's on hydration, which mismatches near midnight. */}
          {" "}Built {(profile.generatedAt ?? "").slice(0, 10) || "date unknown"}.
          {profile.stale && (
            <span className="sp-stale" title="Documents have been added or removed since this was built, so the search is running on an out-of-date picture.">
              {" "}Documents have changed since. Rebuild before trusting a run.
            </span>
          )}
        </p>
      )}

      {/* One box now. The staging note and the transient error text used to sit
          beside it saying overlapping things; both are lines in the log. */}
      <JobProgress job={dismissed ? null : job} events={events}
                   onDismiss={() => setDismissed(true)} lostContact={gaveUp} />

      {/* Kept for the case the log cannot cover: a failure to START, and a stop
          whose write to the row did not land. Anything the row knows about is
          already on screen above. */}
      {(error || (chainError && job?.status !== "failed")) && (
        <div className="ov-err">{error ?? chainError}</div>
      )}

      {open && profile && (
        <>
          <dl className="sp-facets">
            {FACETS.map(f => {
              const rows = byFacet(f);
              if (!rows.length) return null;
              return (
                <div key={f}>
                  <dt>{FACET_LABEL[f]}</dt>
                  <dd>
                    <ul className="sp-list">
                      {rows.map((r, i) => (
                        <li key={`${f}-${i}`}>
                          {r.text}
                          <span className="sp-src" title={`"${r.quote}"`}>
                            {r.documentTitle}{r.layer ? ` · Layer ${r.layer}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              );
            })}
          </dl>

          {others.length > 0 && (
            <p className="ov-note sp-quarantine">
              {others.length} line(s) about competitors or partners were found and
              are deliberately excluded from every query. A rival&apos;s product and
              a partner&apos;s programme are not this client&apos;s work, and searching
              on them finds the wrong money.
            </p>
          )}
        </>
      )}

      {lastQueries.length > 0 && (
        <details className="sp-queries">
          <summary>Exactly what was asked, last run ({lastQueries.length})</summary>
          <ol>
            {lastQueries.map((q, i) => (
              <li key={i}>
                <span className="sp-track">{q.track}</span> {q.text}
                {q.ok === false
                  ? <span className="sp-failed" title="This query did not answer. Its results are missing from the run.">did not answer</span>
                  : typeof q.results === "number"
                    ? <span className="sp-count">{q.results} back</span>
                    : null}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
