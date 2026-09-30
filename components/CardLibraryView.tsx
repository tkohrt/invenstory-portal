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
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import JobProgress, { useJob } from "./JobProgress";
import type { Job } from "@/lib/job";
import type { CardLibraryData, LibraryCard } from "@/lib/server/card-library";
import {
  verifyCardAction, unverifyCardAction, editCardAction, retireCardAction,
  reinstateCardAction, mergeCardAction, dismissDuplicateAction,
} from "@/lib/server/card-actions";

type StatusFilter = "review" | "verified" | "duplicates" | "retired" | "all";

const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };
const RETIRED_WHY: Record<string, string> = {
  source_removed: "its source document is gone or no longer says this",
  superseded: "superseded by newer information",
  inaccurate: "marked inaccurate",
  merged: "merged into another card",
};

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
  const [showRefusals, setShowRefusals] = useState(false);

  const byId = useMemo(() => new Map(data.cards.map(c => [c.id, c])), [data.cards]);
  const counts = useMemo(() => ({
    review: data.cards.filter(c => c.status === "suggested").length,
    verified: data.cards.filter(c => c.status === "verified").length,
    duplicates: data.cards.filter(c => c.status !== "retired" && c.possibleDuplicateOf).length,
    retired: data.cards.filter(c => c.status === "retired").length,
    all: data.cards.length,
  }), [data.cards]);
  const kinds = useMemo(() => [...new Map(data.cards.map(c => [c.kind, c.kindLabel])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [data.cards]);

  const shown = data.cards.filter(c => {
    if (status === "review" && c.status !== "suggested") return false;
    if (status === "verified" && c.status !== "verified") return false;
    if (status === "duplicates" && !(c.status !== "retired" && c.possibleDuplicateOf)) return false;
    if (status === "retired" && c.status !== "retired") return false;
    if (kind && c.kind !== kind) return false;
    if (layer && c.layer !== layer) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const hay = `${c.statement} ${c.evidence.map(e => `${e.quote} ${e.title}`).join(" ")}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  /**
   * Read the whole Inven(s)tory, however many invocations it takes. The same
   * loop as the Search Profile build: each call reads what fits, keeps it, and
   * says what is left, and the decision to come back is made from the response.
   */
  const runChain = useCallback(async (restart: boolean) => {
    setDismissed(false); setChainError(null); setWorking(true);
    if (restart) resetEvents();
    let jobRef: string | null = null;
    const post = (body: unknown) => fetch("/api/jobs/cards", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const stop = async (reason: string) => {
      setChainError(reason);
      try { await post({ stop: true, reason }); if (jobRef) await syncJob(jobRef); } catch { /* the message is what matters */ }
    };
    let cutShort = 0;
    setLaunching(true);
    try {
      // Acknowledged in well under a second. From here the job's own log is
      // polled every two seconds, so each document shows as it is read rather
      // than when a 40-second stage finishes.
      const b = await post({ begin: true, restart });
      const br = await b.json().catch(() => ({}));
      if (!b.ok) throw new Error(br.error ?? "Could not start the build.");
      if (br.jobId) { jobRef = br.jobId; await syncJob(br.jobId).catch(() => null); }
      setLaunching(false);

      for (let pass = 0; pass < 40; pass++) {
        const res = await post({ restart: restart && pass === 0, begun: true });
        const r = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (r.error) throw new Error(r.error);
          if (++cutShort >= 3) {
            await stop("Three stages in a row were cut off before they could report back. "
              + "Everything read is saved, and Build picks up from there.");
            return;
          }
          await new Promise(f => setTimeout(f, 1500));
          continue;
        }
        cutShort = 0;
        if (r.jobId) { jobRef = r.jobId; await syncJob(r.jobId).catch(() => null); }
        if (r.complete) { router.refresh(); return; }
        if (r.busy) { await new Promise(f => setTimeout(f, 3000)); continue; }
        // Keep the "documents read" count on the page moving between stages.
        router.refresh();
        if ((r.read ?? 0) === 0) {
          await stop(`Stopped after reading ${r.done} of ${r.total} documents: a pass read nothing while `
            + "documents were still outstanding. What has been read is saved.");
          return;
        }
      }
      await stop("Stopped after many passes without finishing. What has been read is saved.");
    } catch (e) {
      await stop(e instanceof Error ? e.message : "Reading failed. What has been read is saved.");
    } finally {
      setLaunching(false);
      setWorking(false);
    }
  }, [router, syncJob, resetEvents]);

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
            For Granted only; never shown to the client.</p>
        </div>
        <div className="spacer" />
        <div className="cl-actions">
          {nothingYet ? (
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
        <span><b>{counts.verified}</b> verified</span>
        <span><b>{counts.duplicates}</b> possible duplicates</span>
        <span><b>{counts.retired}</b> retired</span>
        <span className="cl-read">{data.progress.done} of {data.progress.total} documents read for cards</span>
      </div>
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
            different documents are recognised as the same claim. Everything read is kept, so closing the page pauses
            the build rather than losing it.</p>
        </div>
      ) : (
        <>
          <div className="cl-filters">
            {(["review", "verified", "duplicates", "retired", "all"] as StatusFilter[]).map(s => (
              <button key={s} type="button" className={`chip${status === s ? " active" : ""}`} onClick={() => setStatus(s)}>
                {s === "review" ? "To review" : s === "duplicates" ? "Possible duplicates" : s[0].toUpperCase() + s.slice(1)}
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
            <input className="cl-search" placeholder="Search statements and quotes" value={q} onChange={e => setQ(e.target.value)} />
          </div>

          {shown.length === 0
            ? <p className="cl-note">Nothing matches these filters.</p>
            : <div className="cl-grid">{shown.map(c => <CardTile key={c.id} card={c} byId={byId} />)}</div>}
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

function CardTile({ card: c, byId }: { card: LibraryCard; byId: Map<string, LibraryCard> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.statement);
  const [open, setOpen] = useState(false);

  const act = (fn: () => Promise<unknown>) => start(async () => {
    setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  });

  const dup = c.possibleDuplicateOf ? byId.get(c.possibleDuplicateOf) : undefined;
  const layerClass = c.layer ? `cl-l${c.layer.length}` : "cl-l0";
  const cls = `cl-card ${layerClass}${c.strength === "thin" ? " cl-thin" : ""}${c.status === "verified" ? " cl-verified" : ""}${c.status === "retired" ? " cl-retired" : ""}`;

  return (
    <div className={cls}>
      <div className="cl-card-head">
        <span className="cl-kind">{c.kindLabel}</span>
        {c.layer && <span className="cl-layer">{LAYER_NAME[c.layer]}</span>}
        <span className="cl-spacer" />
        {c.status === "verified" && <span className="cl-badge cl-badge-ok">Verified</span>}
        {c.status === "suggested" && <span className="cl-badge">Suggested</span>}
        {c.status === "retired" && <span className="cl-badge cl-badge-off">Retired</span>}
      </div>

      {editing ? (
        <div className="cl-edit">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} />
          <div className="cl-card-acts">
            <button type="button" className="btn inline cl-primary" disabled={pending}
              onClick={() => act(async () => { await editCardAction(c.id, draft); setEditing(false); })}>Save as new version</button>
            <button type="button" className="btn ghost" disabled={pending} onClick={() => { setEditing(false); setDraft(c.statement); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="cl-statement">{c.statement}</p>
      )}

      <div className="cl-tags">
        <span>{c.strength === "covered" ? "Specific" : "General"}</span>
        {c.hasFigures && <span>Has figures</span>}
        {c.subject === "third_party" && <span title="The quote is about or by someone outside the organization">Outside voice</span>}
        {c.statementOrigin === "human" && <span title={`Edited by For Granted; version ${c.version}`}>Edited v{c.version}</span>}
        <button type="button" className="cl-link" onClick={() => setOpen(o => !o)}>
          {open ? "Hide" : "Show"} {c.evidence.length} source{c.evidence.length === 1 ? "" : "s"}
        </button>
      </div>

      {open && (
        <ul className="cl-evidence">
          {c.evidence.length === 0 && <li className="cl-note">No live source. It was read from a document that is gone or has changed.</li>}
          {c.evidence.map(e => (
            <li key={e.documentId}>
              <div className="cl-quote">{`“${e.quote}”`}</div>
              <div className="cl-src">
                {e.title}{e.layer ? ` · ${LAYER_NAME[e.layer] ?? e.layer}` : ""}{e.speaker ? ` · ${e.speaker}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}

      {c.status === "retired" && (
        <p className="cl-note">Retired: {RETIRED_WHY[c.retiredReason ?? ""] ?? c.retiredReason ?? "no reason recorded"}
          {c.mergedInto && byId.get(c.mergedInto) ? ` (“${byId.get(c.mergedInto)!.statement.slice(0, 80)}…”)` : ""}.</p>
      )}

      {dup && c.status !== "retired" && (
        <div className="cl-dup">
          <div className="cl-dup-head">Possibly the same claim as:</div>
          <p>{dup.statement}</p>
          <div className="cl-card-acts">
            <button type="button" className="btn secondary" disabled={pending}
              onClick={() => act(() => mergeCardAction(c.id, dup.id))}>Merge this into that one</button>
            <button type="button" className="btn secondary" disabled={pending}
              onClick={() => act(() => mergeCardAction(dup.id, c.id))}>Merge that one into this</button>
            <button type="button" className="btn ghost" disabled={pending}
              onClick={() => act(() => dismissDuplicateAction(c.id))}>Not the same</button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="cl-card-acts">
          {c.status === "suggested" && (
            <button type="button" className="btn inline cl-primary" disabled={pending} onClick={() => act(() => verifyCardAction(c.id))}>Verify</button>
          )}
          {c.status === "verified" && (
            <button type="button" className="btn ghost" disabled={pending} onClick={() => act(() => unverifyCardAction(c.id))}>Undo verify</button>
          )}
          {c.status !== "retired" && (
            <>
              <button type="button" className="btn ghost" disabled={pending} onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="btn ghost" disabled={pending} onClick={() => act(() => retireCardAction(c.id, "inaccurate"))}>Inaccurate</button>
              <button type="button" className="btn ghost" disabled={pending} onClick={() => act(() => retireCardAction(c.id, "superseded"))}>Out of date</button>
            </>
          )}
          {c.status === "retired" && (
            <button type="button" className="btn ghost" disabled={pending} onClick={() => act(() => reinstateCardAction(c.id))}>Reinstate</button>
          )}
        </div>
      )}
      {err && <div className="cl-error">{err}</div>}
    </div>
  );
}
