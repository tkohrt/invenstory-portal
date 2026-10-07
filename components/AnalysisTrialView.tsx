"use client";
// Inven(s)tory Analysis, Phase A: the trial page.
//
// For Granted's view of what the one read found, beside the current reads and
// without touching them. Four views:
//   Documents  each document's type, cards, facts and refusals
//   Cards      the Card Library this read WOULD produce (nothing is written to it)
//   Facts      every fact by key, with conflicts called out
//   Review     the card-quality review the Build Spec requires, counted here
//   Refused    quotes For Granted refused, remembered and held back from every read (Phase D)
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import JobProgress, { useJob } from "./JobProgress";
import type { Job } from "@/lib/job";
import type { AnalysisTrialData, TrialDoc } from "@/lib/server/analysis-read";
import type { PreviewCard } from "@/lib/analysis";
import { FACT_KEY_MAP } from "@/lib/analysis";
import { CARD_KIND_MAP } from "@/lib/story-card";
import { saveReviewAction, clearReviewAction, saveDupDecisionAction, clearDupDecisionAction, liftRefusalAction } from "@/lib/server/analysis-actions";
import { REVIEW_ALL_UP_TO } from "@/lib/analysis";
import AnalysisCompare, { type CompareResult } from "./AnalysisCompare";
import { decideAnalysisRequestAction } from "@/lib/server/analysis-client-actions";

export interface AnalysisRequestRow { id: string; note: string | null; at: string; by: string }

type Tab = "documents" | "cards" | "facts" | "review" | "compare" | "refused";
const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };

function possessive(name: string) {
  const n = (name ?? "").trim();
  if (!n) return "This client's";
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

export default function AnalysisTrialView({ orgName, data, job: initialJob, compare, requests = [] }: {
  orgName: string; data: AnalysisTrialData; job: Job | null;
  /** Phase C: the client's requests to run an analysis past the fair-use cap. */
  requests?: AnalysisRequestRow[];
  /** Phase B: what the read implies, beside what the portal shows today. */
  compare?: CompareResult;
}) {
  const router = useRouter();
  const { job, events, syncJob, resetEvents, starting, running, error: jobError, gaveUp } = useJob(initialJob);
  const [working, setWorking] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [tab, setTab] = useState<Tab>("documents");

  const titleById = useMemo(() => new Map(data.docs.map(d => [d.id, d.title])), [data.docs]);

  const run = useCallback(async (restart: boolean, documentId?: string, requestId?: string) => {
    setDismissed(false); setChainError(null); setWorking(true);
    if (restart) resetEvents();
    const post = (body: unknown) => fetch("/api/jobs/analysis", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    setLaunching(true);
    try {
      const b = await post({ begin: true, restart, ...(requestId ? { request: requestId } : {}) });
      const br = await b.json().catch(() => ({}));
      if (!b.ok) throw new Error(br.error ?? "Could not start the analysis.");
      if (br.jobId) await syncJob(br.jobId).catch(() => null);
      const k = await post({ kick: true, restart, begun: true, ...(documentId ? { documentId } : {}) });
      const kr = await k.json().catch(() => ({}));
      if (!k.ok) throw new Error(kr.error ?? "Could not start the analysis.");
      if (kr.jobId) await syncJob(kr.jobId).catch(() => null);
    } catch (e) {
      setChainError(e instanceof Error ? e.message : "Could not start the analysis. What has been read is saved.");
    } finally {
      setLaunching(false); setWorking(false);
    }
  }, [syncJob, resetEvents]);

  const stop = useCallback(async () => {
    setWorking(true);
    try {
      const r = await fetch("/api/jobs/analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stop: true }) });
      const j = await r.json().catch(() => ({}));
      if (j.jobId) await syncJob(j.jobId).catch(() => null);
      router.refresh();
    } finally { setWorking(false); }
  }, [router, syncJob]);

  const jobStatus = job?.status;
  const lastStatus = useRef(jobStatus);
  useEffect(() => {
    if (lastStatus.current === "running" && jobStatus && jobStatus !== "running") router.refresh();
    lastStatus.current = jobStatus;
  }, [jobStatus, router]);

  const busy = working || starting || running;
  const nothingYet = data.progress.done === 0;
  const left = data.progress.total - data.progress.done;
  const totalCards = data.docs.reduce((n, d) => n + (d.read?.cards.length ?? 0), 0);
  const totalFacts = data.docs.reduce((n, d) => n + (d.read?.facts.length ?? 0), 0);
  const unreadable = data.docs.filter(d => d.read?.skipped === "empty");
  const dupCount = data.liveLibrary.filter(c => c.possibleDuplicateOf).length;
  const activeRefusals = data.remembered.filter(r => !r.liftedAt);
  const heldBack = data.library.length - data.liveLibrary.length;

  return (
    <div className="cl an">
      <div className="page-head">
        <div>
          <h2>Inven(s)tory Analysis <span className="an-trial">Trial</span></h2>
          <p>One read of each of {possessive(orgName)} documents for its type, its Story Cards and its facts, each
            proven by a quote. Runs beside the current reads: nothing here changes readiness, the Card Library,
            Funding Eligibility or Funder Matches, and the client sees none of it.</p>
        </div>
        <div className="spacer" />
        <div className="cl-actions">
          {nothingYet ? (
            <button type="button" className="btn inline cl-primary" disabled={busy} onClick={() => void run(false)} aria-busy={busy}>
              {busy ? "Analysing…" : "Analyze the Inven(s)tory"}
            </button>
          ) : (
            <>
              {left > 0 && (
                <button type="button" className="btn inline cl-primary" disabled={busy} onClick={() => void run(false)}>
                  Read {left} new document{left === 1 ? "" : "s"}
                </button>
              )}
              <button type="button" className="btn secondary" disabled={busy} onClick={() => void run(false)}
                title="Reads any document that is new, has changed, or was read under older reading rules. Nothing else is re-read.">
                Check for changes
              </button>
              <button type="button" className="btn ghost" disabled={busy}
                onClick={() => { if (confirm("Re-read every document? This costs model time (minutes, and real money). Reviews are kept.")) void run(true); }}
                title="Paid. Re-reads every document. Rarely needed: Check for changes already re-reads documents read under older rules.">
                Re-read everything
              </button>
            </>
          )}
          {running && <button type="button" className="btn ghost" disabled={working} onClick={() => void stop()}>Stop</button>}
        </div>
      </div>

      {requests.length > 0 && (
        <RequestsPanel orgName={orgName} requests={requests} busy={busy} onRun={id => void run(false, undefined, id)} />
      )}
      {launching && (
        <div className="jp jp-working" role="status" aria-live="polite">
          <div className="jp-head"><span className="jp-spin" aria-hidden="true" /><strong>Starting the analysis</strong></div>
          <div className="jp-detail">Request received. Each document will appear below as it is read.</div>
        </div>
      )}
      {!launching && !dismissed && (job || jobError) && (
        <JobProgress job={job} events={events} lostContact={gaveUp} onDismiss={() => setDismissed(true)} />
      )}
      {(chainError || jobError) && <div className="cl-error">{chainError ?? jobError}</div>}

      <div className="cl-summary">
        <span className="cl-read">{data.progress.done} of {data.progress.total} documents analysed</span>
        <span><b>{totalCards}</b> card candidates, <b>{data.liveLibrary.length}</b> after merging
          {heldBack > 0 ? <>, <b>{heldBack}</b> held back by remembered refusals</> : null}</span>
        <span><b>{dupCount}</b> possible duplicates</span>
        <span><b>{totalFacts}</b> facts</span>
        <span title="The current Card Library, built by the old card read. For reference only.">Current Card Library: <b>{data.current.liveCards}</b> live cards</span>
      </div>
      {unreadable.length > 0 && (
        <p className="cl-note an-warn">No text could be read from {unreadable.map(d => d.title).join(", ")}.
          {unreadable.some(d => d.docKind === "pdf") ? " A PDF with no text is usually a scan; it needs text recognition (the Textract plan) before any read can use it." : ""}</p>
      )}

      {nothingYet ? (
        <div className="cl-empty">
          <p>Not analysed yet. Analyze reads each ready document once, in stages on the server, and keeps only cards
            and facts backed by a verbatim quote. Expect roughly the time and cost of a Card Library build.</p>
          <p>When it is done, check the four views: the type given to each document, the cards it would make, the
            facts it found, and then the Review, which is the gate for this phase: every card when the library has 100 or
            fewer, otherwise 100 drawn from each document, plus every flagged duplicate pair.</p>
        </div>
      ) : (
        <>
          <div className="cl-filters">
            {([["documents", "Documents"], ["cards", "Cards"], ["facts", "Facts"], ["review", "Review"], ["compare", "Compare"], ["refused", "Refused before"]] as [Tab, string][]).map(([t, label]) => (
              <button key={t} type="button" className={`chip${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
                {label}{t === "review" ? <> <span className="cl-count">{data.tally.reviewed}/{data.tally.target}{data.tally.pairs.total ? ` · ${data.tally.pairs.decided}/${data.tally.pairs.total} pairs` : ""}</span></> : null}
                {t === "refused" && activeRefusals.length > 0 ? <> <span className="cl-count">{activeRefusals.length}</span></> : null}
              </button>
            ))}
          </div>
          {tab === "documents" && <DocumentsTab docs={data.docs} refusals={data.refusals} busy={busy}
            onReread={id => void run(false, id)} />}
          {tab === "cards" && <CardsTab cards={data.liveLibrary} heldBack={heldBack} titleById={titleById} />}
          {tab === "facts" && <FactsTab facts={data.facts} titleById={titleById} />}
          {tab === "review" && <ReviewTab data={data} titleById={titleById} />}
          {tab === "compare" && <AnalysisCompare result={compare} titleById={titleById} />}
          {tab === "refused" && <RefusedTab refusals={data.remembered} titleById={titleById} />}
        </>
      )}
    </div>
  );
}

function DocumentsTab({ docs, refusals, busy, onReread }: {
  docs: TrialDoc[]; refusals: AnalysisTrialData["refusals"];
  /** Read one document again (seconds of model time), e.g. when its type looks wrong. */
  busy: boolean; onReread: (documentId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <table className="an-table">
        <thead><tr><th>Document</th><th>Type</th><th>Cards</th><th>Facts</th><th>Refused</th><th /></tr></thead>
        <tbody>
          {docs.map(d => {
            const r = d.read;
            const isOpen = open === d.id;
            return (
              <Fragment key={d.id}>
                <tr className={isOpen ? "an-open" : ""} onClick={() => r && !r.skipped && setOpen(isOpen ? null : d.id)}>
                  <td>{d.title}<div className="cl-src">{d.layer ? LAYER_NAME[d.layer] : ""}{d.docKind ? ` · ${d.docKind}` : ""}</div></td>
                  <td>
                    {!r ? <em>Not read yet</em>
                      : r.skipped === "boilerplate" ? <em>Skipped: template, sample or unsigned</em>
                      : r.skipped === "empty" ? <em className="an-bad">No readable text</em>
                      : <>
                          {r.docTypeLabel}
                          <span className={`an-proof${r.docTypeProven ? " ok" : ""}`}
                            title={r.docTypeProven ? `Quoted: “${r.docTypeQuote}”` : "No quote found in the document for the type; judged from the content"}>
                            {r.docTypeProven ? "quoted" : "judged"}</span>
                        </>}
                  </td>
                  <td>{r && !r.skipped ? r.cards.length : ""}</td>
                  <td>{r && !r.skipped ? r.facts.length : ""}</td>
                  <td>{r && !r.skipped ? r.rejected.length : ""}</td>
                  <td>{r && r.skipped !== "empty" && (
                    <button type="button" className="btn ghost ap-mini" disabled={busy}
                      title="Reads this one document again under the current rules. Seconds of model time; reviews of cards that come back unchanged are kept."
                      onClick={e => { e.stopPropagation(); onReread(d.id); }}>Read again</button>
                  )}</td>
                </tr>
                {isOpen && r && (
                  <tr className="an-detail"><td colSpan={6}>
                    {r.docTypeReason && <p className="cl-note">Type: {r.docTypeReason}</p>}
                    <h4>Cards</h4>
                    {r.cards.length === 0 ? <p className="cl-note">None.</p> : (
                      <ul className="an-list">{r.cards.map((c, i) => (
                        <li key={i}><span className="cl-kind">{CARD_KIND_MAP[c.kind]?.label ?? c.kind}</span> {c.statement}
                          <div className="cl-quote">{`“${c.quote}”`}</div>
                          {c.speaker && <div className="cl-src">{c.speaker}</div>}</li>))}</ul>
                    )}
                    <h4>Facts</h4>
                    {r.facts.length === 0 ? <p className="cl-note">None.</p> : (
                      <ul className="an-list">{r.facts.map((f, i) => (
                        <li key={i}><b>{FACT_KEY_MAP[f.key]?.label ?? f.key}:</b> {f.value}
                          <div className="cl-quote">{`“${f.quote}”`}</div></li>))}</ul>
                    )}
                    {r.rejected.length > 0 && (<>
                      <h4>Refused by the checks</h4>
                      <ul className="an-list">{r.rejected.map((x, i) => (
                        <li key={i} className="an-refused"><span className="cl-kind">{x.what}: {x.key}</span> {x.text || <em>empty</em>}
                          <div className="cl-quote">{x.quote ? `“${x.quote}”` : "no quote"}</div>
                          <div className="cl-src">{x.label}</div></li>))}</ul>
                    </>)}
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {refusals.length > 0 && (
        <p className="cl-note">Refusals across every document: {refusals.map(r => `${r.label} (${r.count})`).join("; ")}.
          Too many of one reason means a check or the prompt needs adjusting.</p>
      )}
    </div>
  );
}

function Evidence({ card, titleById }: { card: PreviewCard; titleById: Map<string, string> }) {
  return (
    <ul className="cl-evidence">
      {card.evidence.map(e => (
        <li key={e.documentId}>
          <div className="cl-quote">{`“${e.quote}”`}</div>
          <div className="cl-src">{titleById.get(e.documentId) ?? "document"}{e.speaker ? ` · ${e.speaker}` : ""}</div>
        </li>
      ))}
    </ul>
  );
}

function CardsTab({ cards, heldBack, titleById }: { cards: PreviewCard[]; heldBack: number; titleById: Map<string, string> }) {
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const kinds = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const c of cards) m.set(c.kind, { label: c.kindLabel, n: (m.get(c.kind)?.n ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [cards]);
  const byFp = useMemo(() => new Map(cards.map(c => [c.fingerprint, c])), [cards]);
  const shown = cards.filter(c => (!kind || c.kind === kind)
    && (!q.trim() || `${c.statement} ${c.evidence.map(e => e.quote).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div>
      <p className="cl-note">The Card Library this read would produce, merged by the same rules as the real one. Nothing
        here is written to the Card Library.{heldBack > 0 ? ` ${heldBack} card${heldBack === 1 ? " rests" : "s rest"} on a quote For Granted refused and ${heldBack === 1 ? "is" : "are"} left out: see Refused before.` : ""}</p>
      <div className="cl-filters">
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind" className="cl-select">
          <option value="">Every kind ({cards.length})</option>
          {kinds.map(([k, v]) => <option key={k} value={k}>{v.label} ({v.n})</option>)}
        </select>
        <input className="cl-search" placeholder="Search statements and quotes" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="cl-grid">
        {shown.map(c => (
          <div key={c.fingerprint} className={`cl-card ${c.layer ? `cl-l${c.layer.length}` : "cl-l0"}${c.strength === "thin" ? " cl-thin" : ""}`}>
            <div className="cl-card-head"><span className="cl-kind">{c.kindLabel}</span>
              {c.layer && <span className="cl-layer">{LAYER_NAME[c.layer]}</span>}</div>
            <p className="cl-statement">{c.statement}</p>
            <Evidence card={c} titleById={titleById} />
            {c.possibleDuplicateOf && byFp.get(c.possibleDuplicateOf) && (
              <div className="cl-dup"><div className="cl-dup-head">Possibly the same claim as:</div>
                <p>{byFp.get(c.possibleDuplicateOf)!.statement}</p></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FactsTab({ facts, titleById }: { facts: AnalysisTrialData["facts"]; titleById: Map<string, string> }) {
  if (!facts.length) return <p className="cl-note">No facts found yet.</p>;
  return (
    <div>
      <p className="cl-note">What Phase B will offer the client to confirm as Funding Eligibility answers, and feed the search
        profile. Each value shows the line it came from. Nothing is saved to the client&rsquo;s profile.</p>
      <table className="an-table">
        <thead><tr><th>Fact</th><th>Value</th><th>Where it says so</th></tr></thead>
        <tbody>
          {facts.flatMap(f => f.values.map((v, i) => (
            <tr key={`${f.key}-${i}`} className={f.conflicting ? "an-conflict" : ""}>
              <td>{i === 0 ? <>{f.label}{f.conflicting && <div className="an-bad">more than one value</div>}</> : ""}</td>
              <td><b>{v.value}</b></td>
              <td>{v.sources.map(s => (
                <div key={s.documentId}><span className="cl-quote">{`“${s.quote}”`}</span>
                  <div className="cl-src">{titleById.get(s.documentId) ?? "document"}</div></div>))}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewTab({ data, titleById }: { data: AnalysisTrialData; titleById: Map<string, string> }) {
  const t = data.tally;
  const mark = (ok: boolean) => (ok ? "an-pass" : "an-fail");
  const whole = t.librarySize <= REVIEW_ALL_UP_TO;
  return (
    <div>
      <div className={`an-gate ${t.passes ? "an-pass" : ""}`}>
        <strong>{t.passes ? "The card-quality gate passes." : "Card-quality review"}</strong>
        <ul>
          <li className={mark(t.checks.enough)}>{t.reviewed} of {t.target} cards reviewed
            {whole ? " (every card: the library has 100 or fewer)" : ` (100 of ${t.librarySize}, drawn from each document in proportion)`}</li>
          <li className={mark(t.checks.pairs)}>{t.pairs.decided} of {t.pairs.total} flagged duplicate pairs decided</li>
          <li className={mark(t.checks.supported)}>{t.supportedPct}% of reviewed cards fully supported by their quote (at least 90%)</li>
          <li className={mark(t.checks.competitor)}>{t.competitor} about a competitor (must be 0)</li>
          <li className={mark(t.checks.duplicates)}>{t.duplicatePct}% of the library duplicated (under 10%): {t.pairs.same} same-claim pair{t.pairs.same === 1 ? "" : "s"}
            {t.duplicate - t.pairs.same ? `, plus ${t.duplicate - t.pairs.same} unflagged duplicate${t.duplicate - t.pairs.same === 1 ? "" : "s"} noticed in the review` : ""}</li>
        </ul>
        <p className="cl-note">The Build Spec&rsquo;s gate, applied to whichever reader makes the cards. Cards are chosen by a hash,
          not by looking at them, and stay the same between visits. &ldquo;Partly&rdquo; does not count as supported. Duplicates are
          counted across the whole library, from the flagged pairs below, because a sample rarely holds both cards of a pair.</p>
      </div>

      {data.pairs.length > 0 && (
        <section className="an-pairs">
          <h3>Possible duplicates ({data.pairs.length})</h3>
          <p className="cl-note">Each pair was flagged because the wording overlaps. Decide whether they make the same claim.</p>
          {data.pairs.map(p => <PairRow key={`${p.card.fingerprint}|${p.other.fingerprint}`} pair={p} titleById={titleById} />)}
        </section>
      )}

      <h3>Cards to review ({data.sample.length})</h3>
      {data.sample.length === 0 ? <p className="cl-note">No cards to review yet.</p> : (
        <ol className="an-review">
          {data.sample.map(c => <ReviewRow key={c.fingerprint} card={c} review={data.reviews[c.fingerprint]} titleById={titleById} />)}
        </ol>
      )}
    </div>
  );
}

function PairRow({ pair: p, titleById }: { pair: AnalysisTrialData["pairs"][number]; titleById: Map<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => start(async () => {
    setErr(null);
    try { await fn(); router.refresh(); } catch (x) { setErr(x instanceof Error ? x.message : "That did not save."); }
  });
  const side = (c: PreviewCard) => (
    <div className="an-pair-side">
      <span className="cl-kind">{c.kindLabel}</span>
      <p className="cl-statement">{c.statement}</p>
      <div className="cl-src">{c.evidence.map(e => titleById.get(e.documentId) ?? "document").join(" · ")}</div>
    </div>
  );
  return (
    <div className={`an-pair${p.same === true ? " an-rev-unsupported" : p.same === false ? " an-rev-supported" : ""}`}>
      <div className="an-pair-cols">{side(p.card)}{side(p.other)}</div>
      <div className="cl-card-acts">
        {p.same !== null && <span className="cl-badge">{p.same ? "Same claim" : "Different claims"}</span>}
        <button type="button" className="btn secondary" disabled={pending} onClick={() => act(() => saveDupDecisionAction(p.card.fingerprint, p.other.fingerprint, true))}>Same claim</button>
        <button type="button" className="btn secondary" disabled={pending} onClick={() => act(() => saveDupDecisionAction(p.card.fingerprint, p.other.fingerprint, false))}>Different</button>
        {p.same !== null && <button type="button" className="btn ghost" disabled={pending} onClick={() => act(() => clearDupDecisionAction(p.card.fingerprint, p.other.fingerprint))}>Clear</button>}
      </div>
      {err && <div className="cl-error">{err}</div>}
    </div>
  );
}

function ReviewRow({ card: c, review, titleById }: {
  card: PreviewCard; review: AnalysisTrialData["reviews"][string] | undefined; titleById: Map<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [competitor, setCompetitor] = useState(review?.competitor ?? false);
  const [duplicate, setDuplicate] = useState(review?.duplicate ?? false);
  const [note, setNote] = useState(review?.note ?? "");

  const save = (verdict: "supported" | "partly" | "unsupported") => start(async () => {
    setErr(null);
    try {
      const e = c.evidence[0];
      await saveReviewAction({
        fingerprint: c.fingerprint, documentId: e?.documentId ?? null, kind: c.kind,
        statement: c.statement, quote: e?.quote ?? "", verdict, competitor, duplicate, note,
        evidence: c.evidence.map(x => ({ documentId: x.documentId, quote: x.quote })),
      });
      router.refresh();
    } catch (x) { setErr(x instanceof Error ? x.message : "That did not save."); }
  });
  const clear = () => start(async () => {
    setErr(null);
    try { await clearReviewAction(c.fingerprint); router.refresh(); } catch (x) { setErr(x instanceof Error ? x.message : "That did not work."); }
  });

  return (
    <li className={`an-rev${review ? ` an-rev-${review.verdict}` : ""}`}>
      <div className="cl-card-head"><span className="cl-kind">{c.kindLabel}</span>
        {review && <span className="cl-badge">{review.verdict}{review.competitor ? ", competitor" : ""}{review.duplicate ? ", duplicate" : ""}</span>}</div>
      <p className="cl-statement">{c.statement}</p>
      <Evidence card={c} titleById={titleById} />
      <div className="an-rev-acts">
        <label><input type="checkbox" checked={competitor} onChange={e => setCompetitor(e.target.checked)} /> About a competitor</label>
        <label><input type="checkbox" checked={duplicate} onChange={e => setDuplicate(e.target.checked)} /> Duplicate of another card not flagged above</label>
        <input className="cl-search" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
      </div>
      <div className="cl-card-acts">
        <button type="button" className="btn inline cl-primary" disabled={pending} onClick={() => save("supported")}>Fully supported</button>
        <button type="button" className="btn secondary" disabled={pending} onClick={() => save("partly")}>Partly</button>
        <button type="button" className="btn secondary" disabled={pending} onClick={() => save("unsupported")}>Not supported</button>
        {review && <button type="button" className="btn ghost" disabled={pending} onClick={clear}>Clear</button>}
      </div>
      {review?.verdict === "unsupported" && (
        <p className="cl-note">Remembered: {c.evidence.length === 1 ? "this quote is" : "these quotes are"} refused on every later read for this client, and the card stays out of the library. It still counts here, because the review judges the reader.</p>
      )}
      {err && <div className="cl-error">{err}</div>}
    </li>
  );
}

/**
 * Phase C: a client asked for an analysis past the fair-use cap. Approving runs
 * it now, as For Granted, and uses the approval up; it never counts against the
 * client's allowance. Declining tells the client on their page.
 */
function RequestsPanel({ orgName, requests, busy, onRun }: {
  orgName: string; requests: AnalysisRequestRow[]; busy: boolean; onRun: (requestId: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="an-gate">
      <strong>{orgName} asked for an analysis</strong>
      <ul>
        {requests.map(r => (
          <li key={r.id}>
            {r.by}, {new Date(r.at).toLocaleString()}{r.note ? `: “${r.note}”` : ""}
            <span className="cl-card-acts" style={{ display: "inline-flex", marginLeft: 8 }}>
              <button type="button" className="btn inline cl-primary ap-mini" disabled={busy || pending}
                onClick={() => start(async () => {
                  setErr(null);
                  try { await decideAnalysisRequestAction(r.id, true); onRun(r.id); router.refresh(); }
                  catch (e) { setErr(e instanceof Error ? e.message : "That did not save."); }
                })}>Approve and run now</button>
              <button type="button" className="btn secondary ap-mini" disabled={busy || pending}
                onClick={() => start(async () => {
                  setErr(null);
                  try { await decideAnalysisRequestAction(r.id, false); router.refresh(); }
                  catch (e) { setErr(e instanceof Error ? e.message : "That did not save."); }
                })}>Decline</button>
            </span>
          </li>
        ))}
      </ul>
      {err && <div className="cl-error">{err}</div>}
    </div>
  );
}

/**
 * Phase D (decisions 19 and 31): every quote For Granted refused for this
 * client, what each is holding back from the current read, and a way to let
 * one through again. Lifting is recorded, never deleted.
 */
function RefusedTab({ refusals, titleById }: { refusals: AnalysisTrialData["remembered"]; titleById: Map<string, string> }) {
  if (!refusals.length) {
    return <p className="cl-note">Nothing refused yet. A card marked Not supported in the Review, or retired as Inaccurate in the
      Card Library, has its quote remembered here and held back from every later read.</p>;
  }
  return (
    <div>
      <p className="cl-note">Quotes For Granted refused for this client. A card resting on one of them is left out of the library,
        readiness, eligibility and the search profile, however a later read words it. A quote matches when it is the same
        passage, or most of a new quote is taken from it. Lift a refusal to let the quote through again.</p>
      <ol className="an-review">
        {refusals.map(r => <RefusalRow key={r.id} r={r} titleById={titleById} />)}
      </ol>
    </div>
  );
}

function RefusalRow({ r, titleById }: { r: AnalysisTrialData["remembered"][number]; titleById: Map<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const toggle = (lift: boolean) => start(async () => {
    setErr(null);
    try { await liftRefusalAction(r.id, lift); router.refresh(); }
    catch (x) { setErr(x instanceof Error ? x.message : "That did not save."); }
  });
  return (
    <li className={`an-rev${r.liftedAt ? " an-rev-supported" : " an-rev-unsupported"}`}>
      <div className="cl-card-head">
        <span className="cl-kind">{CARD_KIND_MAP[r.kind]?.label ?? r.kind}</span>
        <span className="cl-badge">{r.source === "review" ? "Not supported in review" : "Retired as Inaccurate"}
          {r.liftedAt ? `, lifted ${new Date(r.liftedAt).toLocaleDateString()}` : ""}</span>
      </div>
      <p className="cl-statement">{r.statement}</p>
      <div className="cl-quote">{`“${r.quote}”`}</div>
      <div className="cl-src">{r.documentId ? titleById.get(r.documentId) ?? "a document no longer ready" : "document not recorded"}
        {` · refused ${new Date(r.createdAt).toLocaleDateString()}`}</div>
      {!r.liftedAt && (r.blocking.length === 0
        ? <p className="cl-note">Holding back nothing in the current read.</p>
        : <>
            <p className="cl-note">Holding back {r.blocking.length} card{r.blocking.length === 1 ? "" : "s"} in the current read:</p>
            <ul className="an-list">{r.blocking.map((b, i) => (
              <li key={i} className="an-refused"><span className="cl-kind">{CARD_KIND_MAP[b.kind]?.label ?? b.kind}</span> {b.statement}
                <div className="cl-quote">{`“${b.quote}”`}</div>
                <div className="cl-src">{titleById.get(b.documentId) ?? "document"}</div></li>))}</ul>
          </>)}
      <div className="cl-card-acts">
        {r.liftedAt
          ? <button type="button" className="btn secondary" disabled={pending} onClick={() => toggle(false)}>Refuse again</button>
          : <button type="button" className="btn ghost" disabled={pending} onClick={() => toggle(true)}>Lift: let this quote through</button>}
      </div>
      {err && <div className="cl-error">{err}</div>}
    </li>
  );
}
