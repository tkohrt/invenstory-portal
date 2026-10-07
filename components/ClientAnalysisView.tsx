"use client";
// Analyze my Inven(s)tory (Phase C): the client presses Analyze, watches it run,
// and sees what it found: readiness and what is missing, the Story Cards found,
// the eligibility answers to confirm one by one, and what has opened up.
//
// The button counts toward the monthly AI allowance (Phase D) but is never
// stopped by it: building the Inven(s)tory is always allowed. Near and past the
// allowance the page says so. Everything
// here is the client's own material; nothing For Granted uses to judge a
// reader (refusals, duplicate flags, reviews) is shown.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import JobProgress, { useJob } from "./JobProgress";
import type { Job } from "@/lib/job";
import type { ClientAnalysis } from "@/lib/server/analysis-client-read";
import { describeCap } from "@/lib/analysis-cap";
import { decideSuggestionAction, confirmEligibilityAction } from "@/lib/server/analysis-client-actions";
import AllowanceRequest from "./AllowanceRequest";
import DocTypePicker from "./DocTypePicker";

const STATE_LABEL = { covered: "Covered", thin: "Partly covered", missing: "Missing" } as const;
const TIER_LABEL: Record<string, string> = { essential: "Essential", important: "Important", enriching: "Enriching" };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });

export default function ClientAnalysisView({ orgName, data, job: initialJob, isAdmin }: {
  orgName: string; data: ClientAnalysis; job: Job | null; isAdmin: boolean;
}) {
  const router = useRouter();
  const { job, syncJob, starting, running, gaveUp } = useJob(initialJob);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const run = useCallback(async () => {
    setError(null); setDismissed(false); setWorking(true);
    const post = (body: unknown) => fetch("/api/jobs/analysis", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    try {
      const b = await post({ begin: true });
      const br = await b.json().catch(() => ({}));
      if (!b.ok) throw new Error(br.error ?? "The analysis could not start.");
      if (br.jobId) await syncJob(br.jobId).catch(() => null);
      const k = await post({ kick: true, begun: true });
      const kr = await k.json().catch(() => ({}));
      if (!k.ok) throw new Error(kr.error ?? "The analysis could not start.");
      if (kr.jobId) await syncJob(kr.jobId).catch(() => null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis could not start.");
      router.refresh();
    } finally { setWorking(false); }
  }, [router, syncJob]);

  // When a run finishes, show what it found.
  const status = job?.status;
  const last = useRef(status);
  useEffect(() => {
    if (last.current === "running" && status && status !== "running") router.refresh();
    last.current = status;
  }, [status, router]);

  const busy = working || starting || running;
  const cap = data.cap;
  const never = data.analysed === 0;

  return (
    <div className="cl ca">
      <div className="page-head">
        <div>
          <h2>Analyze my Inven(s)tory</h2>
          <p>Each of {orgName}&rsquo;s documents is read once, for what kind of document it is, the Story Cards in it and the
            facts funders ask about. Every card and fact carries the line it came from. Only new or changed documents are read again.</p>
        </div>
      </div>

      <section className="ca-run">
        {cap.allowed ? (
          <>
            <button type="button" className="btn inline cl-primary" disabled={busy} onClick={() => void run()} aria-busy={busy}>
              {busy ? "Analysing…" : never ? "Analyze my Inven(s)tory" : "Analyze new and changed documents"}
            </button>
            <p className="cl-note">About {cap.pages} page{cap.pages === 1 ? "" : "s"} to read.</p>
            {cap.warning && <p className="cl-note ca-warn">{cap.warning}</p>}
          </>
        ) : cap.reason === "nothing_new" ? (
          <p className="cl-note">{data.documents === 0 ? "Upload documents to your Inven(s)tory first, then analyse them here." : describeCap(cap)}</p>
        ) : isAdmin ? (
          <p className="cl-note">The client has used this month&rsquo;s AI allowance, so their button offers Request more.
            Your own runs are never limited: run it from Admin, then Analysis, or give more on the client&rsquo;s activity page.</p>
        ) : (
          <AllowanceRequest message={describeCap(cap)} requested={data.allowanceRequested} />
        )}
        {isAdmin && <p className="cl-note">For Granted view: this is the client&rsquo;s page, showing the client&rsquo;s allowance. Your own runs, never limited, are on Admin, then Analysis.</p>}
        {error && <div className="cl-error">{error}</div>}
        {job && !dismissed && (
          <JobProgress job={job} lostContact={gaveUp} onDismiss={() => setDismissed(true)} />
        )}
      </section>

      {never ? null : (
        <>
          <Readiness data={data} />
          <section className="ca-sec">
            <h3>Story Cards found ({data.cardTotal})</h3>
            <p className="cl-note">Short, quotable statements from your documents. For Granted checks each one before it goes into an application.</p>
            <div className="ca-chips">
              {data.cardsByKind.map(k => <span key={k.label} className="chip">{k.label} · {k.count}</span>)}
            </div>
          </section>
          <DocumentTypes data={data} />
          <Eligibility data={data} />
          <Unlocks data={data} />
        </>
      )}
    </div>
  );
}

function Readiness({ data }: { data: ClientAnalysis }) {
  const [all, setAll] = useState(false);
  const order = { missing: 0, thin: 1, covered: 2 } as const;
  const tierOrder: Record<string, number> = { essential: 0, important: 1, enriching: 2 };
  const items = [...data.readiness.items].sort((a, b) => order[a.state] - order[b.state] || (tierOrder[a.tier] ?? 3) - (tierOrder[b.tier] ?? 3));
  const gaps = items.filter(i => i.state !== "covered");
  const shown = all ? items : gaps;
  return (
    <section className="ca-sec">
      <h3>Readiness: {data.readiness.pct}%</h3>
      <p className="cl-note">{gaps.length
        ? `${gaps.length} item${gaps.length === 1 ? "" : "s"} still missing or only partly covered. Essential items matter most.`
        : "Every item is covered."}</p>
      <ul className="ca-items">
        {shown.map(i => (
          <li key={i.key} className={`ca-item ca-${i.state}`}>
            <span className={`an-st an-st-${i.state}`}>{STATE_LABEL[i.state]}</span>
            <b>{i.label}</b> <span className="ov-muted">{TIER_LABEL[i.tier] ?? i.tier}</span>
            {i.state !== "covered" && <div className="cl-note">{i.gap}</div>}
          </li>
        ))}
      </ul>
      <button type="button" className="fc-link" onClick={() => setAll(a => !a)}>{all ? "Show only what is missing" : "Show every item"}</button>
    </section>
  );
}

function Eligibility({ data }: { data: ClientAnalysis }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => start(async () => {
    setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not save."); }
  });
  return (
    <section className="ca-sec">
      <h3>Your eligibility answers</h3>
      <p className="cl-note">Funders screen on these. Each answer below was found in your documents, with the line it came from.
        Nothing is saved to your Funding Eligibility profile until you confirm it.</p>
      {err && <div className="cl-error">{err}</div>}
      {data.suggestions.length === 0 ? (
        data.eligibilityConfirmedAt
          ? <p className="cl-note">Confirmed on {day(data.eligibilityConfirmedAt)}. You can change any answer on the Funding Eligibility page.</p>
          : (
            <div className="ca-confirm">
              <p className="cl-note">Nothing is waiting. Check your Funding Eligibility page, then confirm your answers are right.</p>
              <button type="button" className="btn inline cl-primary" disabled={busy} onClick={() => act(() => confirmEligibilityAction())}>These answers are right</button>
            </div>
          )
      ) : (
        <ol className="ca-sugs">
          {data.suggestions.map(s => (
            <li key={s.field} className="ca-sug">
              <div><b>{s.label}</b>{s.current.length > 0 && <span className="ov-muted"> · today: {s.current.join(", ")}</span>}</div>
              {s.conflicting && <div className="an-warn">Your documents give more than one answer. Confirm the right one.</div>}
              {s.open.map(v => (
                <div key={v.value} className="ca-val">
                  <div className="ca-val-head"><span className="ca-val-text">{v.display}</span>
                    <span className="cl-card-acts">
                      <button type="button" className="btn inline cl-primary ap-mini" disabled={busy}
                        onClick={() => act(() => decideSuggestionAction(s.field, v.value, "confirmed"))}>Confirm</button>
                      <button type="button" className="btn secondary ap-mini" disabled={busy}
                        onClick={() => act(() => decideSuggestionAction(s.field, v.value, "rejected"))}>Not right</button>
                    </span>
                  </div>
                  {v.sources.slice(0, 2).map(src => (
                    <div key={src.id} className="cl-src">{`“${src.quote.slice(0, 200)}”`} · {src.title}</div>
                  ))}
                </div>
              ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Unlocks({ data }: { data: ClientAnalysis }) {
  const u = data.unlock;
  return (
    <section className="ca-sec">
      <h3>What this opens up</h3>
      <ul className="ca-items">
        <li className={`ca-item ${u.storyCards ? "ca-covered" : "ca-missing"}`}>
          <b>Story Cards review</b> <span className="ov-muted">{u.storyCards ? "Ready" : "After your first analysis"}</span>
        </li>
        <li className={`ca-item ${u.funderMatches ? "ca-covered" : "ca-missing"}`}>
          <b>Funder Matches</b> <span className="ov-muted">{u.funderMatches ? "Ready" : `Waiting on ${u.funderMatchesWaitingOn.join(" and ")}`}</span>
        </li>
      </ul>
      <p className="cl-note">For Granted turns each one on for your account once it is ready.</p>
    </section>
  );
}

/**
 * Decision 33: what kind of document each one is. The analysis suggests a type;
 * the client confirms it or picks another. Items such as a pitch deck, a 990 or
 * a budget count on the checklist only once a document is tagged.
 */
function DocumentTypes({ data }: { data: ClientAnalysis }) {
  const [all, setAll] = useState(false);
  const waiting = data.documentTypes.filter(d => !d.tag);
  const shown = all ? data.documentTypes : waiting;
  return (
    <section className="ca-sec">
      <h3>What kind of document is each one?</h3>
      <p className="cl-note">Some checklist items are a document in themselves, such as a pitch deck, an IRS 990 or a budget. They count
        once a document is marked as that type. We suggest a type for each; confirm it, or pick the right one.
        {waiting.length ? ` ${waiting.length} waiting for you.` : " All confirmed."}</p>
      {shown.length > 0 && (
        <table className="an-table">
          <tbody>{shown.map(d => (
            <tr key={d.id}><td>{d.title}</td>
              <td><DocTypePicker documentId={d.id} tag={d.tag} suggested={d.suggested} locked={d.lockedByFG} />
                {d.lockedByFG && <div className="cl-src">Set by For Granted</div>}</td></tr>
          ))}</tbody>
        </table>
      )}
      {data.documentTypes.length > waiting.length && (
        <button type="button" className="fc-link" onClick={() => setAll(a => !a)}>{all ? "Show only those waiting" : "Show every document"}</button>
      )}
    </section>
  );
}
