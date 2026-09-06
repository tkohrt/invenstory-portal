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

export default function SearchProfilePanel({ profile, lastQueries, orgName, job: initialJob }: {
  profile: PanelProfile | null;
  lastQueries: { track: string; text: string; ok?: boolean; results?: number }[];
  orgName: string;
  /** A rebuild already in flight when the page loaded. */
  job: Job | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { job, setJob, starting, running, error, gaveUp } = useJob(initialJob);
  const [dismissed, setDismissed] = useState(false);
  const [chain, setChain] = useState<{ done: number; total: number } | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [paused, setPaused] = useState(false);

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
    setDismissed(false); setChainError(null); setPaused(false); setWorking(true);
    let jobRef: string | null = null;

    // Tell the row it ended. Without this the browser stops and the row still
    // says "running", so the progress panel spins over work that is over.
    const stop = async (reason: string) => {
      setPaused(true);
      setChainError(reason);
      try {
        const res = await fetch("/api/jobs/search-profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stop: true, reason }),
        });
        if (jobRef && res.ok) {
          const j = await fetch(`/api/jobs/${jobRef}`, { cache: "no-store" })
            .then(x => x.ok ? x.json() : null).catch(() => null);
          if (j?.job) setJob(j.job);
        }
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

        setChain({ done: r.done ?? 0, total: r.total ?? 0 });
        if (r.jobId) jobRef = r.jobId;
        if (r.jobId) {
          const j = await fetch(`/api/jobs/${r.jobId}`, { cache: "no-store" }).then(x => x.ok ? x.json() : null).catch(() => null);
          if (j?.job) setJob(j.job);
        }

        if (r.complete) { router.refresh(); return; }

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
  }, [router, setJob]);

  const rebuild = () => void runChain(true);
  const carryOn = () => void runChain(false);

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
            {open ? "hide" : "show"}
          </button>
        )}
        {/* Continue is the recovery path, and it must exist. Without it the
            only button destroys every document already read, which on a large
            Inven(s)tory is minutes of model spend. */}
        {paused && (
          <button type="button" className="btn" onClick={carryOn} disabled={working}>
            Continue
          </button>
        )}
        {/* Same rule as the readiness CTA: loud until it has been done once,
            quiet forever after. A Rebuild that pulses is asking to be pressed,
            and pressing it throws away every document already read. */}
        <button type="button"
                className={profile ? "btn ghost" : `btn sp-build${working || starting || running ? "" : " sp-build-pulse"}`}
                onClick={rebuild}
                disabled={working || starting || running}
                title={profile ? "Forgets what was read and starts over." : "Reads this Inven(s)tory and builds the profile the search runs on."}>
          {working ? "Reading…" : profile ? "Rebuild" : "Build it"}
        </button>
      </div>

      {!profile && (
        <p className="ov-note">
          Nothing built yet. Matching is falling back to the eligibility form,
          which knows the organization type and cause areas and nothing about
          what makes this client fundable.
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

      <JobProgress job={dismissed ? null : job} onDismiss={() => setDismissed(true)} lostContact={gaveUp} />
      {chain && chain.total > 0 && (working || paused) && (
        <p className="ov-note sp-chain">
          {chain.done} of {chain.total} documents read. A large Inven(s)tory takes
          longer than one request is allowed, so this runs in stages. Everything
          read is saved: closing this page pauses it, and Continue picks it up.
        </p>
      )}
      {(error || chainError) && <div className="ov-err">{error ?? chainError}</div>}

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
