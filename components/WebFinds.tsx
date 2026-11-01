"use client";
// Found on the web (patch 5 of the 1 November 2026 build): what the web search
// found for this client, and for For Granted the button that runs it and where
// each find stands in the Ground Truth review queue.
//
// A run asks one question per call; this component asks for the next until
// none are left, as the explanations do, so each call fits the time limit.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import JobProgress, { useJob } from "./JobProgress";
import type { Job } from "@/lib/job";
import { FUNDING_KIND_LABEL, isFundingKind } from "@/lib/eligibility-fields";

export interface WebLead {
  id: string; kind: "opportunity" | "funder"; money_kind: string; title: string; funder: string | null;
  url: string; deadline: string | null; rolling: boolean; amount_text: string | null;
  geography: string | null; eligibility: string | null; why: string | null; quote: string | null;
  grounded: "exact" | "site"; review: string | null; found_at: string;
}

const REVIEW_LABEL: Record<string, string> = {
  proposed: "Waiting for review", in_review: "Being reviewed", approved: "In Ground Truth",
  rejected: "Rejected in review", superseded: "Superseded",
};

function when(d: string | null, rolling: boolean): string {
  if (d) {
    const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
    return days <= 30 ? `${new Date(d).toLocaleDateString()} · ${days}d left` : new Date(d).toLocaleDateString();
  }
  return rolling ? "Rolling" : "Not stated";
}

export default function WebFinds({ leads, isAdmin, orgName, available, canRun, initialJob, actions }: {
  leads: WebLead[];
  isAdmin: boolean;
  orgName: string;
  /** Web search works in this deployment (Claude on Vertex). */
  available: boolean;
  /** This person may start a search here (For Granted; a client only when allowed, patch 7). */
  canRun: boolean;
  initialJob: Job | null;
  /** Extra controls per row (the client's own verdict, patch 7). */
  actions?: (l: WebLead) => React.ReactNode;
}) {
  const router = useRouter();
  const { job, events, start, starting, running, error, gaveUp } = useJob(initialJob);
  const handled = useRef<string | null>(null);

  // Ask the next question when one finishes and more are left.
  useEffect(() => {
    if (!job || job.status !== "done" || handled.current === job.id) return;
    handled.current = job.id;
    router.refresh();
    const r = job.result as { runId?: string; remaining?: number } | null;
    if (r?.runId && (r.remaining ?? 0) > 0) void start("/api/jobs/discover", "discover", { runId: r.runId });
  }, [job, router, start]);

  const search = () => { handled.current = null; void start("/api/jobs/discover", "discover", {}); };
  const opps = leads.filter(l => l.kind === "opportunity");
  const funders = leads.filter(l => l.kind === "funder");

  const table = (rows: WebLead[], kind: "opportunity" | "funder") => (
    <table className="aq-table fm-table">
      <thead>
        <tr>
          <th>{kind === "opportunity" ? "Opportunity" : "Funder"}</th>
          {kind === "opportunity" && <th>Funder</th>}
          {kind === "opportunity" && <th>Deadline</th>}
          {kind === "opportunity" && <th>Amount</th>}
          <th>Where</th><th>Why it may fit</th>
          {isAdmin && <th>Ground Truth</th>}
          {actions && <th>Your view</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(l => (
          <tr key={l.id}>
            <td className="fm-name">
              <a href={l.url} target="_blank" rel="noopener noreferrer">{kind === "funder" ? (l.funder ?? l.title) : l.title}</a>
              {isFundingKind(l.money_kind) && l.money_kind !== "grants" && <div className="fm-listed">{FUNDING_KIND_LABEL[l.money_kind]}</div>}
              {isAdmin && l.grounded === "site" && (
                <div className="fm-caveat" title="The search returned this website but not this exact page. The link may be wrong; clients do not see this row.">Check the link</div>
              )}
              {kind === "funder" && l.eligibility && <div className="fm-listed">{l.eligibility}</div>}
            </td>
            {kind === "opportunity" && <td className="fm-funder">{l.funder ?? <span className="ov-muted">Not stated</span>}</td>}
            {kind === "opportunity" && <td className="fm-nowrap">{when(l.deadline, l.rolling)}</td>}
            {kind === "opportunity" && <td className="fm-nowrap">{l.amount_text ?? "—"}</td>}
            <td>{l.geography ?? <span className="ov-muted">Not stated</span>}</td>
            <td className="fm-why">
              {l.why ?? <span className="ov-muted">—</span>}
              {l.quote && <div className="fm-screen" title="Copied from the page when it was found.">Page says: &ldquo;{l.quote}&rdquo;</div>}
            </td>
            {isAdmin && (
              <td className="fm-nowrap">
                {l.review
                  ? <a href="/admin/ledger-overlay" className={`ov-tag wf-review wf-${l.review}`}>{REVIEW_LABEL[l.review] ?? l.review}</a>
                  : <span className="ov-muted">Not filed</span>}
              </td>
            )}
            {actions && <td className="fm-decide">{actions(l)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <section className="wf-section" aria-label="Found on the web">
      <div className="wf-head">
        <h3 className="fm-h3" style={{ margin: 0 }}>Found on the web</h3>
        <span className="spacer" />
        {canRun && (
          <button type="button" className="sb-btn sb-ai sb-sm" onClick={search}
            disabled={!available || starting || running}
            title={!available ? "Web search needs Claude on Vertex in this environment." : "Runs up to four searches. Each uses part of the monthly AI allowance."}>
            {running ? "Searching the web…" : starting ? "Starting…" : leads.length ? "Search the web again" : "Search the web"}
          </button>
        )}
      </div>
      <p className="fm-sub">
        {isAdmin
          ? <>What is open now, found by searching the web from {orgName}&apos;s profile. Each answer is kept only if its page was among the search results, and every find goes to the Ground Truth review queue as a proposal: none reaches another client until someone approves it.</>
          : <>Opportunities and funders found by searching the web for {orgName}, kept only when the page itself was found. Found on the date shown and not yet checked by For Granted: read the page before you act on it, and ask your For Granted team if anything is unclear.</>}
      </p>
      <JobProgress job={job} events={events} lostContact={gaveUp} />
      {error && <div className="ov-err">{error}</div>}
      {!leads.length && !running && (
        <div className="ov-note">{canRun ? "Nothing yet. Search the web to look for what is open now." : "Nothing found on the web yet."}</div>
      )}
      {opps.length > 0 && table(opps, "opportunity")}
      {funders.length > 0 && (<><h4 className="wf-h4">Funders</h4>{table(funders, "funder")}</>)}
    </section>
  );
}
