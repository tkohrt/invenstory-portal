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
import { useEffect, useState } from "react";
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

export default function SearchProfilePanel({ profile, lastQueries, orgName, job: initialJob }: {
  profile: PanelProfile | null;
  lastQueries: { track: string; text: string; ok?: boolean; results?: number }[];
  orgName: string;
  /** A rebuild already in flight when the page loaded. */
  job: Job | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { job, start: startJob, starting, running, error, gaveUp } = useJob(initialJob);
  const [dismissed, setDismissed] = useState(false);

  const finished = job?.status;
  useEffect(() => { if (finished === "done") router.refresh(); }, [finished, router]);

  const rebuild = () => { setDismissed(false); void startJob("/api/jobs/search-profile", "search_profile"); };

  // Only facts that may describe the client. Competitor and partner lines are
  // kept in the data and deliberately not shown as if they were ours.
  const own = (profile?.facts ?? []).filter(f => f.subject === "organization");
  const others = (profile?.facts ?? []).filter(f => f.subject !== "organization");
  const byFacet = (f: Facet) => own.filter(x => x.facet === f);

  return (
    <div className="sp">
      <div className="sp-head">
        <strong>What we search on</strong>
        <span className="ov-muted"> for {orgName}</span>
        <span className="ov-spacer" />
        {profile && (
          <button type="button" className="fc-link" onClick={() => setOpen(v => !v)}>
            {open ? "hide" : "show"}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={rebuild} disabled={starting || running}>
          {running ? "Reading…" : starting ? "Starting…" : profile ? "Rebuild" : "Build it"}
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
      {error && <div className="ov-err">{error}</div>}

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
