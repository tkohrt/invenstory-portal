"use client";
// Funder matching results. Hidden from clients by default; For Granted runs the
// match and reads the results here. Every card is a June 2026 lead, and the page
// says so rather than letting anyone forget it.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearMatchesAction } from "@/lib/server/match-actions";
import JobProgress, { useJob } from "./JobProgress";
import type { Job } from "@/lib/job";
import type { Verdict } from "@/lib/server/matching";
import type { FunderRow } from "@/lib/funder-rows";
import { ACCESS_LABEL, ACCESS_HELP } from "@/lib/access-mode";
import { primaryContact, freshness, ROLE_LABEL, type ContactRecord } from "@/lib/funder-contact";
import { screenFunders, hiddenByScreen } from "@/lib/funder-screen";
import SearchProfilePanel, { type PanelProfile } from "./SearchProfilePanel";
import type { EligibilityProfile } from "@/lib/eligibility-fields";

interface Cached {
  grant_id: string; verdict: Verdict; reason: string | null;
  close_date: string | null; award_ceiling: number | null; matched_at: string;
  title: string | null; funder: string | null; url: string | null;
  rationale: string | null; source_site: string | null; verified_at: string | null;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  eligible: "Eligible", likely: "Likely", check: "Needs a check",
};

// What each rung of the ladder actually means, shown on hover.
//
// NAMING RULE (client-visible surface): clients see "Ground Truth" and nothing
// else. Never the Funder Ledger, never the vendor dataset, never the service.
// This mirrors the existing brand rule that external writing says "For Granted's
// funder discovery process" rather than naming the source. Everything a client
// reads here is For Granted's work; how it is assembled is not their concern.
//
// Every rung still ends in the same place on purpose: nothing here substitutes
// for reading the funder's own page.
/** Freshness in For Granted's own terms, never the source dataset's. */
function verified(m: { verified_at: string | null }): { label: string; help: string } {
  if (!m.verified_at) {
    return {
      label: "Not independently verified",
      help: "For Granted has not yet confirmed this record at the funder's own site. Treat the details as a starting point.",
    };
  }
  const d = new Date(m.verified_at);
  return {
    label: `Verified ${d.toLocaleDateString()}`,
    help: `A member of the For Granted team confirmed these details at the funder's own site on ${d.toLocaleDateString()}. Deadlines and priorities can still change.`,
  };
}

const VERDICT_HELP: Record<Verdict, string> = {
  eligible:
    "The eligibility text names your organization type, and nothing is blocking. "
    + "The strongest signal available from a June 2026 snapshot. Still verify at the source.",
  likely:
    "Nothing is blocking, and there is at least one real alignment signal: your state, "
    + "a cause-area overlap, or a strong alignment score. Worth an hour. Verify at the source.",
  check:
    "Either something is blocking (federal money without SAM.gov, a cost match you cannot meet), "
    + "or there is nothing to go on but topical similarity. Read the eligibility text before spending time on it.",
};

function money(n: number | null) {
  if (n == null) return "—";
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;
}

function deadline(d: string | null) {
  if (!d) return "Rolling";
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
  const label = new Date(d).toLocaleDateString();
  if (days < 0) return `${label} (closed)`;
  if (days <= 30) return `${label} · ${days}d left`;
  return label;
}

/** Peer grantees, phrased as evidence for an approach rather than a promise. */
function evidenceText(f: FunderRow): string {
  // Amounts and years included: "Goodwill of NW Ohio ($1.0M, 2023)" is a
  // reason to write the letter, where a bare name is only a hint.
  const shown = f.evidence.slice(0, 3).filter(e => e.name).map(e => {
    const bits = [e.total_usd ? money(e.total_usd) : null, e.latest_year].filter(Boolean);
    return bits.length ? `${e.name} (${bits.join(", ")})` : e.name;
  });
  if (!shown.length) return "";
  // Counted against the true total, not the twelve rows we store: a funder with
  // fifty grantees should read "and 47 more", not "and 9 more".
  const more = Math.max(0, (f.evidence_count || f.evidence.length) - shown.length);
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/**
 * What a row is actually claiming.
 *
 * Three different things end up in this table and only one of them is a match
 * against this client. Saying so is the difference between a shortlist someone
 * can trust and a list that quietly overstates its own evidence.
 */
function signal(f: FunderRow): { label: string; cls: string; help: string } {
  if (f.from_graph) return {
    label: "Already funds peers", cls: "fm-eligible",
    help: "On the giving history on record, this funder has made grants to organizations like this one. The strongest signal on this page — and still a June 2026 record, so confirm it before acting.",
  };
  if (f.from_overlay) return {
    label: "For Granted record", cls: "",
    help: "A funder For Granted added or verified directly. It has not been assessed against this organization specifically — it is here because the team thought it worth knowing about.",
  };
  return {
    label: "Focus aligns", cls: "",
    help: "Their stated focus lines up with this organization's work. Weaker than a giving history: read their guidelines before investing time.",
  };
}

export default function FunderMatchesView({
  matches, funders, orgName, configured, health, isAdmin, contacts, eligibility,
  profile, lastQueries, matchJob, profileJob, pendingRationales,
}: {
  matches: Cached[]; funders: FunderRow[]; orgName: string; configured: boolean;
  /** Matches still owed a real explanation, because a run was cut short. */
  pendingRationales: number;
  health: { ok: boolean; detail: string }; isAdmin: boolean;
  /** For Granted internal, admin sessions only. Empty for a client. */
  contacts: Record<string, ContactRecord[]>;
  /** Drives the eligibility screen. Null means run the data-quality screen only. */
  eligibility: EligibilityProfile | null;
  /** For Granted's working view of what the search is built from. Admin only. */
  profile: PanelProfile | null;
  lastQueries: { track: string; text: string }[];
  /** Work already in flight when the page loaded, so a reload rejoins it. */
  matchJob: Job | null;
  profileJob: Job | null;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The run happens on the server against a job row, not in this tab, so the
  // page can be closed and come back to it.
  const { job, start: startJob, starting, running, error: jobError, gaveUp } = useJob(matchJob);
  const [dismissed, setDismissed] = useState(false);
  const shownJob = dismissed ? null : job;

  // Refresh once the work lands, so the tables show the new run rather than
  // asking somebody to reload.
  const finished = job?.status;
  // Refresh on failure as well as success: a run can fail after the grant
  // tables were replaced, and reading a stale table beside a failure banner is
  // how somebody acts on the wrong data.
  useEffect(() => {
    if (finished === "done" || finished === "failed") router.refresh();
  }, [finished, router]);
  // Rows the source records as making no grants to anyone. Set aside rather
  // than dropped, and one click from view, so a wrong screen is visible.
  const [showNoHistory, setShowNoHistory] = useState(false);
  const screened = screenFunders(funders, eligibility);
  const visibleFunders = showNoHistory
    ? [...screened.shown, ...screened.hidden.map(h => h.row)]
    : screened.shown;
  // Why rows were set aside, so the toggle names a reason rather than a number.
  const hiddenReasons = [...new Set(screened.hidden.map(h => h.reason))];

  // Wake the funding service on load, in its own request. It sleeps when idle
  // and the first call after a nap spends most of a minute starting up, which
  // inside a run is the difference between finishing and being killed at the
  // function limit. Out here it costs nothing: by the time somebody has read
  // the page and pressed Run, it is usually already awake.
  useEffect(() => {
    if (!isAdmin || !configured) return;
    void fetch("/api/ledger/warm", { method: "POST" }).catch(() => { /* a failed warm-up is not a failure */ });
  }, [isAdmin, configured]);

  const run = () => { setDismissed(false); setErr(null); void startJob("/api/jobs/match", "match"); };

  // Explanations are the long tail of a run and the part most likely to be cut
  // off by the function limit. They are also the only part that is safe to
  // resume, so the page keeps asking until nothing is owed.
  const { job: rJob, start: startRationales, running: rRunning, gaveUp: rGaveUp } = useJob(null);
  const [owed, setOwed] = useState(pendingRationales);
  useEffect(() => { setOwed(pendingRationales); }, [pendingRationales]);

  const rFinished = rJob?.status;
  useEffect(() => {
    if (rFinished !== "done") return;
    const remaining = Number((rJob?.result as { remaining?: number } | null)?.remaining ?? 0);
    setOwed(remaining);
    router.refresh();
    // Still owed after a pass means the budget ran out, not that it failed.
    // Another pass picks up where this one stopped.
    if (remaining > 0) void startRationales("/api/jobs/rationales", "rationales");
  }, [rFinished, rJob, router, startRationales]);

  const clear = () => start(async () => {
    try { await clearMatchesAction(); setErr(null); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not clear."); }
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Funder Matches</h2>
          <p>
            Opportunities screened for {orgName}: eligibility rules first, then alignment,
            then funding evidence. Everything here is a <strong>June 2026 lead, not a fact</strong>.
            Verify eligibility and deadlines on the funder&apos;s own site before any of it
            reaches a client or an application.
          </p>
        </div>
        {isAdmin && (
          <>
            <span className="spacer" />
            <button className="btn" onClick={run} disabled={starting || running || !configured}>
              {running ? "Searching…" : starting ? "Starting…" : matches.length ? "Re-run matching" : "Run matching"}
            </button>
          </>
        )}
      </div>

      {!configured && (
        <div className="ov-note">
          {isAdmin
            ? <>Ground Truth is not connected in this environment. Set <code>FUNDER_LEDGER_URL</code>{" "}
              and <code>FUNDER_LEDGER_KEY</code> and this page goes live.</>
            : <>Ground Truth is being prepared for {orgName}. Your For Granted team will be in touch
              once matches are ready.</>}
        </div>
      )}
      {configured && !health.ok && (
        <div className="ov-note">{isAdmin ? `Ground Truth status: ${health.detail}` : "Matches are being refreshed."}</div>
      )}

      {isAdmin && (
        <SearchProfilePanel
          profile={profile} lastQueries={lastQueries} orgName={orgName} job={profileJob} />
      )}

      <JobProgress job={shownJob} onDismiss={() => setDismissed(true)} lostContact={gaveUp} />
      <JobProgress job={rJob} lostContact={rGaveUp} />

      {isAdmin && owed > 0 && !rRunning && (
        <div className="ov-note fm-owed">
          {owed} match{owed === 1 ? "" : "es"} {owed === 1 ? "is" : "are"} showing a
          rule-based summary because the last run ran out of time before explaining
          {owed === 1 ? " it" : " them"}.
          {" "}
          <button type="button" className="fc-link"
                  onClick={() => void startRationales("/api/jobs/rationales", "rationales")}>
            Finish the explanations
          </button>
        </div>
      )}
      {jobError && <div className="ov-err">{jobError}</div>}
      {err && <div className="ov-err">{err}</div>}

      {matches.length === 0 && visibleFunders.length === 0 && !screened.hidden.length ? (
        <div className="empty">
          No matches cached yet.{isAdmin && configured ? " Run matching to build the list." : ""}
        </div>
      ) : matches.length === 0 ? (
        <div className="empty">
          No open solicitations survived screening this run. The funders below are still worth
          approaching — most foundation money never appears as a public call.
        </div>
      ) : (
        <>
          <div className="ov-runbar">
            {matches.length} opportunities · compiled{" "}
            {new Date(matches[0].matched_at).toLocaleDateString()} · every match is a lead to
            confirm with the funder before applying
          </div>
          <table className="aq-table fm-table">
            <thead>
              <tr>
                <th>Opportunity</th><th>Funder</th><th>Verdict</th>
                <th>Deadline</th><th>Ceiling</th><th>Verified</th><th>Why this client</th>
              </tr>
            </thead>
            <tbody>
              {matches.map(m => (
                <tr key={m.grant_id}>
                  <td className="fm-name">
                    {m.url
                      ? <a href={m.url} target="_blank" rel="noopener noreferrer">{m.title || m.grant_id}</a>
                      : (m.title || m.grant_id)}
                  </td>
                  <td className="fm-funder">
                    {m.funder || <span className="ov-muted" title="The dataset does not carry a funder name for this record. Resolved once the opportunity page is fetched.">Unknown</span>}
                    {m.source_site && <div className="fm-listed">listed on {m.source_site.replace(/^https?:\/\//i, "").toLowerCase()}</div>}
                  </td>
                  <td>
                    <span className={`ov-tag fm-${m.verdict} fm-verdict`} title={VERDICT_HELP[m.verdict]}>
                      {VERDICT_LABEL[m.verdict]}
                    </span>
                  </td>
                  <td className="fm-nowrap">{deadline(m.close_date)}</td>
                  <td className="fm-nowrap">{money(m.award_ceiling)}</td>
                  <td className="fm-nowrap">
                    <span className={m.verified_at ? "fm-verified" : "ov-muted"} title={verified(m).help}>
                      {verified(m).label}
                    </span>
                  </td>
                  <td className="fm-why">
                    {m.rationale || <span className="ov-muted">{m.reason ?? "—"}</span>}
                    {m.rationale && m.reason && (
                      <div className="fm-screen">Screen: {m.reason}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Gated on hidden too. Otherwise a run where every funder is screened
          out hides the toggle inside the block the toggle would have to open,
          and the rows become unreachable rather than one click away. */}
      {(visibleFunders.length > 0 || screened.hidden.length > 0) && (
        <>
          <h3 className="fm-h3">Funders worth approaching</h3>
          <p className="fm-sub">
            Not open calls. These are organizations whose giving lines up with {orgName}&apos;s
            work, and the ones marked <strong>already funds peers</strong> have a record of
            granting to organizations like this one — the strongest reason on this page to
            spend an afternoon on an approach. Like everything here it reads a{" "}
            <strong>June 2026 snapshot</strong>: a funder&apos;s priorities and the people who
            run their programmes both move. A funder with no open solicitation is normally
            reached by a letter of inquiry, so treat this as a shortlist to research, not a
            list to apply to. Read the <strong>Access</strong> column first: an invitation-only
            funder will not read a cold proposal however well it fits, and &ldquo;likely&rdquo;
            there means we inferred it rather than checked.
          </p>
          {visibleFunders.length > 0 && (
          <table className="aq-table fm-table">
            <thead>
              <tr>
                <th>Funder</th><th>Access</th><th>Signal</th><th>Typical grant</th>
                <th>Evidence</th>{isAdmin && <th>Who reads it</th>}
                <th>Verified</th><th>Why this client</th>
              </tr>
            </thead>
            <tbody>
              {visibleFunders.map(f => (
                <tr key={f.funder_id}>
                  <td className="fm-name">
                    {f.website
                      ? <a href={f.website} target="_blank" rel="noopener noreferrer">{f.name}</a>
                      : f.name}
                    {f.location && <div className="fm-listed">{f.location}</div>}
                    {hiddenByScreen(f) && (
                      <div className="fm-nohistory"
                           title="No outgoing grants on file for this organization. Often an operating charity that delivers services itself rather than funding others, which semantic search cannot tell apart from a funder. Worth a look only if you have another reason.">
                        No grants on record
                      </div>
                    )}
                    {/* Relayed verbatim. A donor-advised fund is not an approachable
                        foundation, and softening that wastes a client's time. */}
                    {f.caveat && <div className="fm-caveat">{f.caveat}</div>}
                  </td>
                  <td className="fm-access">
                    {/* The distinction between checked and guessed is the whole
                        point of Ground Truth, so it is visible, not buried in a
                        tooltip: an inferred answer is styled differently and
                        says "likely". */}
                    <span className={`ov-tag fm-acc-${f.access_mode}${f.access_verified ? "" : " fm-acc-guess"}`}
                          title={`${ACCESS_HELP[f.access_mode]}${f.access_note ? `\n\n${f.access_note}` : ""}${
                            f.access_verified
                              ? "\n\nFor Granted confirmed this at the funder's own materials."
                              : f.access_mode === "unknown"
                                ? ""
                                : "\n\nInferred from the record, not confirmed by anyone. Check before acting on it."}`}>
                      {f.access_verified || f.access_mode === "unknown"
                        ? ACCESS_LABEL[f.access_mode]
                        : `Likely ${ACCESS_LABEL[f.access_mode].toLowerCase()}`}
                    </span>
                  </td>
                  <td className="fm-nowrap">
                    <span className={`ov-tag ${signal(f).cls} fm-verdict`} title={signal(f).help}>
                      {signal(f).label}
                    </span>
                  </td>
                  <td className="fm-nowrap">
                    {f.typical_grant_range || <span className="ov-muted">—</span>}
                  </td>
                  <td className="fm-why">
                    {f.evidence.length
                      ? <span title="Organizations this funder has actually granted to, from the giving history on record.">{evidenceText(f)}</span>
                      : <span className="ov-muted">No giving history on record</span>}
                  </td>
                  {isAdmin && (
                    <td className="fc-cell">
                      {(() => {
                        const c = primaryContact(contacts[f.ein ?? ""] ?? []);
                        if (!c) return <span className="ov-muted">—</span>;
                        const fr = freshness(c.last_verified_at);
                        return (
                          <>
                            <div>{c.name}</div>
                            <div className="ov-muted">
                              {c.title || ROLE_LABEL[c.role]}
                              {c.portfolio ? ` · ${c.portfolio}` : ""}
                            </div>
                            <div className={fr.stale ? "fc-stale" : "ov-muted"}
                                 title={fr.stale
                                   ? "Nobody has confirmed this in over a year. People move; check before writing."
                                   : "Recently confirmed."}>
                              {fr.label}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                  )}
                  <td className="fm-nowrap">
                    <span className={f.verified_at ? "fm-verified" : "ov-muted"} title={verified(f).help}>
                      {verified(f).label}
                    </span>
                  </td>
                  <td className="fm-why">
                    {f.match_reason
                      ? f.match_reason
                      : f.from_overlay
                        // Not a reason. This funder was never assessed against
                        // this client, and the column header promises that it
                        // was, so say the true thing instead.
                        ? <span className="ov-muted">Not assessed against {orgName}</span>
                        : f.focus
                          ? <span className="ov-muted" title="The funder's own stated focus, not a match explanation.">{f.focus}</span>
                          : <span className="ov-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}

          {visibleFunders.length === 0 && (
            <div className="empty">
              Every funder this run returned was set aside: {hiddenReasons.join("; ")}.
              They are below if you want to look.
            </div>
          )}

          {screened.hidden.length > 0 && (
            <button type="button" className="fm-toggle"
                    onClick={() => setShowNoHistory(v => !v)}>
              {showNoHistory
                ? `Hide the ${screened.hidden.length} set aside`
                : `Show ${screened.hidden.length} set aside (${hiddenReasons.join("; ")})`}
            </button>
          )}
        </>
      )}

      {isAdmin && (matches.length > 0 || funders.length > 0) && (
        <div className="ov-actions">
          <button className="btn ghost" onClick={clear} disabled={pending}>Clear cached matches</button>
        </div>
      )}
    </div>
  );
}
