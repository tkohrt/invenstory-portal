"use client";
// The Card Library: every Story Card in a client's story, and the quotes that
// prove them.
//
// Admin only (Decision 1 of the Story Card Drafter spec). Its job in Phase 1 is
// the review the gate depends on: a person reads each suggested card against its
// quote and verifies, edits, merges or retires it. Nothing becomes "verified"
// any other way.
//
// Colour carries meaning, not decoration: the outline is the card's layer
// (public, internal, living voice), a dashed outline is a thin card, and a
// verified card says so in words as well as colour.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JobProgress, { useJob } from "./JobProgress";
import type { Job } from "@/lib/job";
import type { CardLibraryData } from "@/lib/server/card-library";
import CardReview from "./CardReview";
import { USER_GENERATED } from "@/lib/user-card";

type StatusFilter = "review" | "sensitive" | "verified" | "duplicates" | "retired" | "all";

const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };

function possessive(name: string) {
  const n = (name ?? "").trim();
  if (!n) return "This client's";
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

export default function CardLibraryView({ orgName, data, job: initialJob }: {
  orgName: string; data: CardLibraryData; job: Job | null;
}) {
  const router = useRouter();
  const { job, events, syncJob, resetEvents, starting, running, error: jobError, gaveUp } = useJob(initialJob);
  const [working, setWorking] = useState(false);
  // True from the click until the server has acknowledged the build: the one
  // moment when there is no job on screen yet. Shown at once, so a click never
  // looks like it did nothing.
  const [launching, setLaunching] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const [status, setStatus] = useState<StatusFilter>("review");
  const [kind, setKind] = useState<string>("");
  const [layer, setLayer] = useState<string>("");
  const [q, setQ] = useState("");
  const [userOnly, setUserOnly] = useState(false);
  const [showRefusals, setShowRefusals] = useState(false);

  const byId = useMemo(() => new Map(data.cards.map(c => [c.id, c])), [data.cards]);
  const counts = useMemo(() => ({
    review: data.cards.filter(c => c.status === "suggested").length,
    sensitive: data.cards.filter(c => c.status !== "retired" && c.sensitive && !c.sensitiveCleared).length,
    verified: data.cards.filter(c => c.status === "verified").length,
    duplicates: data.cards.filter(c => c.status !== "retired" && c.possibleDuplicateOf).length,
    retired: data.cards.filter(c => c.status === "retired").length,
    all: data.cards.length,
  }), [data.cards]);
  const kinds = useMemo(() => [...new Map(data.cards.map(c => [c.kind, c.kindLabel])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [data.cards]);

  const shown = data.cards.filter(c => {
    if (status === "review" && c.status !== "suggested") return false;
    if (status === "sensitive" && !(c.status !== "retired" && c.sensitive && !c.sensitiveCleared)) return false;
    if (status === "verified" && c.status !== "verified") return false;
    if (status === "duplicates" && !(c.status !== "retired" && c.possibleDuplicateOf)) return false;
    if (status === "retired" && c.status !== "retired") return false;
    if (kind && c.kind !== kind) return false;
    if (layer && c.layer !== layer) return false;
    if (userOnly && c.createdFrom !== "manual") return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const label = c.createdFrom === "manual" ? `${USER_GENERATED} ${c.sourceLine ?? ""}` : "";
      const hay = `${c.statement} ${label} ${c.evidence.map(e => `${e.quote} ${e.title}`).join(" ")}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  /**
   * Start the build, then watch it.
   *
   * The server carries the build from stage to stage itself (since 1 October
   * 2026), so this page only starts it and polls the job's own log. Leaving the
   * page does not stop it; the notice at the top of every portal page shows its
   * progress and says when it is done.
   */
  const runChain = useCallback(async (restart: boolean) => {
    setDismissed(false); setChainError(null); setWorking(true);
    if (restart) resetEvents();
    const post = (body: unknown) => fetch("/api/jobs/cards", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    setLaunching(true);
    try {
      const b = await post({ begin: true, restart });
      const br = await b.json().catch(() => ({}));
      if (!b.ok) throw new Error(br.error ?? "Could not start the build.");
      if (br.jobId) await syncJob(br.jobId).catch(() => null);
      const k = await post({ kick: true, restart, begun: true });
      const kr = await k.json().catch(() => ({}));
      if (!k.ok) throw new Error(kr.error ?? "Could not start the build.");
      if (kr.jobId) await syncJob(kr.jobId).catch(() => null);
    } catch (e) {
      setChainError(e instanceof Error ? e.message : "Could not start the build. What has been read is saved.");
    } finally {
      setLaunching(false);
      setWorking(false);
    }
  }, [syncJob, resetEvents]);

  // When the build the page is watching finishes, show its cards.
  const jobStatus = job?.status;
  const lastStatus = useRef(jobStatus);
  useEffect(() => {
    if (lastStatus.current === "running" && jobStatus && jobStatus !== "running") router.refresh();
    lastStatus.current = jobStatus;
  }, [jobStatus, router]);

  const remerge = useCallback(async () => {
    setChainError(null); setWorking(true);
    try {
      const res = await fetch("/api/jobs/cards", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ remerge: true }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error ?? "Could not re-merge the Card Library.");
      if (r.jobId) await syncJob(r.jobId).catch(() => null);
      router.refresh();
    } catch (e) {
      setChainError(e instanceof Error ? e.message : "Could not re-merge the Card Library.");
    } finally {
      setWorking(false);
    }
  }, [router, syncJob]);

  const busy = working || starting || running;
  const nothingYet = data.progress.done === 0 && data.cards.length === 0;
  const left = data.progress.total - data.progress.done;

  return (
    <div className="cl">
      <div className="page-head">
        <div>
          <h2>Card Library</h2>
          <p>{possessive(orgName)} story as claim-sized cards, each proven by a quote from the Inven(s)tory.
            For Granted&rsquo;s working view. The client sees its own cards only if Story Cards is turned on for it.</p>
        </div>
        <div className="spacer" />
        <div className="cl-actions">
          {data.source === "analysis" ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void remerge()}
              title="Free. Rebuilds the library from what the analysis stored, without reading anything.">
              Re-merge
            </button>
          ) : nothingYet ? (
            <button type="button" className="btn inline cl-primary" disabled={busy} onClick={() => void runChain(false)}
              aria-busy={busy}>
              {busy ? "Building\u2026" : "Build the Card Library"}
            </button>
          ) : (
            <>
              {left > 0 && (
                <button type="button" className="btn inline cl-primary" disabled={busy} onClick={() => void runChain(false)}>
                  Read {left} new document{left === 1 ? "" : "s"}
                </button>
              )}
              <button type="button" className="btn secondary" disabled={busy} onClick={() => void runChain(false)}
                title="Reads any document added or changed since the last build. Unchanged documents are not re-read.">
                Check for changes
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void remerge()}
                title="Free. Rebuilds the library from documents already read, without reading anything.">
                Re-merge
              </button>
              <button type="button" className="btn ghost" disabled={busy}
                onClick={() => { if (confirm("Re-read every document? This costs model time (minutes, and real money). Cards, edits and verifications are kept.")) void runChain(true); }}
                title="Paid. Re-reads every document. Use after a change to what is extracted.">
                Re-read everything
              </button>
            </>
          )}
        </div>
      </div>

      {launching && (
        <div className="jp jp-working" role="status" aria-live="polite">
          <div className="jp-head">
            <span className="jp-spin" aria-hidden="true" />
            <strong>Starting {possessive(orgName)} Card Library build</strong>
          </div>
          <div className="jp-detail">Request received. Each document will appear below as it is read.
            If the database has been idle it can take a few seconds to wake.</div>
        </div>
      )}
      {!launching && !dismissed && (job || jobError) && (
        <JobProgress job={job} events={events} lostContact={gaveUp} onDismiss={() => setDismissed(true)} />
      )}
      {(chainError || jobError) && <div className="cl-error">{chainError ?? jobError}</div>}

      <div className="cl-summary">
        <span><b>{counts.review}</b> to review</span>
        {counts.sensitive > 0 && <span className="cl-sens-count"><b>{counts.sensitive}</b> sensitive, awaiting a decision</span>}
        <span><b>{counts.verified}</b> verified</span>
        <span><b>{counts.duplicates}</b> possible duplicates</span>
        <span><b>{counts.retired}</b> retired</span>
        <span className="cl-read">{data.progress.done} of {data.progress.total} documents read for cards{data.source === "analysis" ? " (by the analysis)" : ""}</span>
      </div>
      {data.source === "analysis" && (
        <p className="cl-note">This client is on the analysis: its cards come from the Inven(s)tory Analysis, and new or changed
          documents are read on Admin, then Analysis. Verifying, editing, retiring and merging cards work as before.</p>
      )}
      {data.unread.length > 0 && !nothingYet && (
        <p className="cl-note">Not read yet: {data.unread.slice(0, 8).join(", ")}
          {data.unread.length > 8 ? `, and ${data.unread.length - 8} more` : ""}.</p>
      )}

      {nothingYet ? (
        <div className="cl-empty">
          <p>No cards yet. Building reads each ready document once and keeps only claims backed by a verbatim quote.
            Anything whose quote is not in its document, whose figures are not in its quote, or which describes a
            competitor is refused, and the refusals are listed here so the checks can be judged too.</p>
          <p>Expect about a minute per two or three documents. Each document appears in the progress log as it is
            read; the cards themselves appear here once the last one is done, because that is when cards found in
            different documents are recognised as the same claim. The build runs on the server, so you can leave this
            page: the portal shows its progress and tells you when it is done.</p>
        </div>
      ) : (
        <>
          <div className="cl-filters">
            {(["review", "sensitive", "verified", "duplicates", "retired", "all"] as StatusFilter[]).map(s => (
              <button key={s} type="button" className={`chip${status === s ? " active" : ""}`} onClick={() => setStatus(s)}>
                {s === "review" ? "To review" : s === "duplicates" ? "Possible duplicates" : s === "sensitive" ? "Sensitive" : s[0].toUpperCase() + s.slice(1)}
                {" "}<span className="cl-count">{counts[s]}</span>
              </button>
            ))}
            <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind" className="cl-select">
              <option value="">Every kind</option>
              {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {(["I", "II", "III"] as const).map(l => (
              <button key={l} type="button" className={`chip l${l.length}${layer === l ? " active" : ""}`}
                onClick={() => setLayer(layer === l ? "" : l)}>{LAYER_NAME[l]}</button>
            ))}
            <button type="button" className={`chip${userOnly ? " active" : ""}`} onClick={() => setUserOnly(v => !v)}
              title="Cards a person wrote, not ones read from documents">{USER_GENERATED} <span className="cl-count">{data.cards.filter(c => c.createdFrom === "manual" && c.status !== "retired").length}</span></button>
            <input className="cl-search" placeholder="Search statements and quotes" value={q} onChange={e => setQ(e.target.value)} />
            <a className="btn ghost" href="/api/export/cards" title="Every card with its quotes and sources, as a spreadsheet">⬇ Export cards (.csv)</a>
          </div>

          {shown.length === 0
            ? <p className="cl-note">Nothing matches these filters.</p>
            : <div className="cl-grid">{shown.map(c => <CardReview key={c.id} card={c} byId={byId} />)}</div>}
        </>
      )}

      {data.refusals.length > 0 && (
        <div className="cl-refusals">
          <button type="button" className="btn ghost" onClick={() => setShowRefusals(v => !v)}>
            {showRefusals ? "Hide" : "Show"} what the checks refused ({data.refusals.reduce((n, r) => n + r.count, 0)})
          </button>
          {showRefusals && (
            <div>
              <p className="cl-note">Candidates the model proposed and the code refused. Too many of one reason
                means a check or the prompt needs adjusting; judge them the same way as the cards.</p>
              {data.refusals.map(r => (
                <div key={r.reason} className="cl-refusal">
                  <h4>{r.label} <span className="cl-count">{r.count}</span></h4>
                  {r.examples.map((x, i) => (
                    <div key={i} className="cl-refusal-ex">
                      <div>{x.statement || <em>no statement</em>}</div>
                      <div className="cl-quote">{x.quote ? `“${x.quote}”` : "no quote"}</div>
                      <div className="cl-src">{x.title} · {x.kind}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
