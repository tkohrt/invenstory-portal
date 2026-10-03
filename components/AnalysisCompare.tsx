"use client";
// Inven(s)tory Analysis, Phase B: the Compare tab.
//
// What the one read implies, set beside what the portal shows today, so a
// person can judge every disagreement before any client is switched over
// (spec, Proving it). Three parts:
//   Readiness    item by item, with the gate: every disagreement judged
//   Eligibility  suggested answers against the client's profile (never saved here)
//   Search       the search profile's facts by facet, current against new
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ComparisonData } from "@/lib/server/analysis-compare";
import { VERDICT_LABEL, type Verdict } from "@/lib/analysis-derive";
import { saveVerdictAction, clearVerdictAction } from "@/lib/server/analysis-actions";

export type CompareResult = { ok: true; c: ComparisonData } | { ok: false; error: string } | undefined;

const STATE_LABEL: Record<string, string> = { covered: "Covered", thin: "Thin", missing: "Missing" };
const TIER_LABEL: Record<string, string> = { essential: "Essential", important: "Important", enriching: "Enriching" };

export default function AnalysisCompare({ result, titleById, initialPart = "readiness" }: {
  result: CompareResult; titleById: Map<string, string>;
  initialPart?: "readiness" | "eligibility" | "search";
}) {
  const [part, setPart] = useState<"readiness" | "eligibility" | "search">(initialPart);
  const [onlyDiff, setOnlyDiff] = useState(true);
  if (!result) return <p className="cl-note">The comparison is not available.</p>;
  if (!result.ok) return <div className="cl-error">The comparison could not be worked out: {result.error}</div>;
  const c = result.c;
  if (!c.analysed) return <p className="cl-note">Analyze the Inven(s)tory first. The comparison is worked out from what the analysis found.</p>;
  const r = c.readiness;
  const rows = onlyDiff ? r.rows.filter(x => !x.agree) : r.rows;

  return (
    <div className="an-compare">
      <p className="cl-note">Worked out in code from the {c.analysed} analysed document{c.analysed === 1 ? "" : "s"}, with no further reading, and set
        beside what the portal uses today. Nothing here changes what the client sees.</p>
      <div className="cl-filters">
        {(["readiness", "eligibility", "search"] as const).map(p => (
          <button key={p} type="button" className={`chip${part === p ? " active" : ""}`} onClick={() => setPart(p)}>
            {p === "readiness" ? `Readiness (${r.gate.judged}/${r.gate.disagreements})` : p === "eligibility" ? `Eligibility (${c.eligibility.length})` : "Search profile"}
          </button>
        ))}
      </div>

      {part === "readiness" && (
        <>
          <div className={`an-gate ${r.gate.passes ? "an-pass" : ""}`}>
            <strong>{r.gate.passes
              ? "Every disagreement has been judged, and none needs fixing."
              : `${r.gate.disagreements} item${r.gate.disagreements === 1 ? "" : "s"} disagree; ${r.gate.judged} judged.`}</strong>
            <ul>
              <li>Readiness today {r.currentPct}%{r.currentComputedAt ? ` (last checked ${new Date(r.currentComputedAt).toLocaleDateString()})` : ""}; from the new read {r.derivedPct}%.</li>
              <li>Funder Matches would open (every Essential at least thin): today {r.unlock.current ? "yes" : "no"}, new read {r.unlock.derived ? "yes" : "no"}.</li>
              {r.gate.toFix > 0 && <li className="an-fail">{r.gate.toFix} judged as the new read being wrong. Each is a fix to make before this client is switched over.</li>}
            </ul>
            <p className="cl-note">The rule for switching a client over: every disagreement looked at by a person. A judgement is kept only while
              both sides still say what they said when it was made; a re-read that changes either brings the item back.</p>
          </div>
          <label className="an-only"><input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> Show only disagreements</label>
          {rows.length === 0 ? <p className="cl-note">{onlyDiff ? "No disagreements." : "No items."}</p> : (
            <div className="an-cmp-list">
              {rows.map(row => <ReadinessRowView key={row.key} row={row} titleById={titleById} />)}
            </div>
          )}
        </>
      )}

      {part === "eligibility" && (
        <>
          <p className="cl-note">The answers the client would be asked to confirm on the eligibility screen (Phase C), beside what their
            Funding Eligibility profile holds today. Nothing is saved from here.</p>
          {c.eligibility.length === 0 ? <p className="cl-note">The analysis found no eligibility facts.</p> : (
            <table className="an-table">
              <thead><tr><th>Field</th><th>Today</th><th>Suggested</th><th>Judgement</th></tr></thead>
              <tbody>
                {c.eligibility.map(s => <EligibilityRowView key={s.field} s={s} titleById={titleById} />)}
              </tbody>
            </table>
          )}
        </>
      )}

      {part === "search" && (
        <>
          <p className="cl-note">The search profile behind Funder Matches, by facet: the profile in use today{c.search.currentAt ? ` (built ${new Date(c.search.currentAt).toLocaleDateString()})` : " (none built yet)"} beside
            the one the new read gives. &ldquo;Who they serve&rdquo; stays out of grant searches either way.</p>
          {c.search.facets.map(f => (
            <details key={f.facet} className="an-facet">
              <summary><b>{f.label}</b> <span className="cl-count">{f.current.length} today · {f.derived.length} new</span></summary>
              <div className="an-pair-cols">
                <div><h4>Today</h4>{f.current.length ? <ul className="an-list">{f.current.map((x, i) => <li key={i}>{x.text}<div className="cl-src">{x.documentTitle}</div></li>)}</ul> : <p className="cl-note">None.</p>}</div>
                <div><h4>New read</h4>{f.derived.length ? <ul className="an-list">{f.derived.map((x, i) => <li key={i}>{x.text}<div className="cl-src">{x.documentTitle}</div></li>)}</ul> : <p className="cl-note">None.</p>}</div>
              </div>
            </details>
          ))}
        </>
      )}
    </div>
  );
}

function VerdictButtons({ area, itemKey, oldState, newState, verdict, note: initialNote }: {
  area: "readiness" | "eligibility"; itemKey: string; oldState: string; newState: string;
  verdict: Verdict | null; note: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState(initialNote ?? "");
  const act = (fn: () => Promise<unknown>) => start(async () => {
    setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not save."); }
  });
  return (
    <div className="an-verdict">
      <div className="cl-card-acts">
        {(Object.keys(VERDICT_LABEL) as Verdict[]).map(v => (
          <button key={v} type="button" className={`btn ${verdict === v ? "inline cl-primary" : "secondary"} ap-mini`} disabled={pending}
            onClick={() => act(() => saveVerdictAction({ area, itemKey, verdict: v, oldState, newState, note }))}>{VERDICT_LABEL[v]}</button>
        ))}
        {verdict && <button type="button" className="btn ghost ap-mini" disabled={pending} onClick={() => act(() => clearVerdictAction(area, itemKey))}>Clear</button>}
      </div>
      <input className="cl-search" placeholder="Note (optional): what is wrong, or why" value={note} onChange={e => setNote(e.target.value)} />
      {err && <div className="cl-error">{err}</div>}
    </div>
  );
}

function ReadinessRowView({ row, titleById }: {
  row: ComparisonData["readiness"]["rows"][number]; titleById: Map<string, string>;
}) {
  const [open, setOpen] = useState(!row.agree);
  return (
    <div className={`an-cmp ${row.agree ? "an-cmp-agree" : row.verdict ? "an-cmp-judged" : "an-cmp-open"}`}>
      <div className="an-cmp-head" onClick={() => setOpen(o => !o)} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter") setOpen(o => !o); }}>
        <b>{row.label}</b> <span className="ov-muted">{TIER_LABEL[row.tier] ?? row.tier}</span>
        <span className="cl-spacer" />
        <span className={`an-st an-st-${row.current}`}>Today: {STATE_LABEL[row.current]}</span>
        <span className={`an-st an-st-${row.derived}`}>New: {STATE_LABEL[row.derived]}</span>
      </div>
      {open && (
        <div className="an-pair-cols">
          <div>
            <h4>Today</h4>
            {row.currentSources.length ? (
              <ul className="an-list">{row.currentSources.slice(0, 4).map((x, i) => (
                <li key={i}>{x.quote ? <span className="cl-quote">{`“${x.quote}”`}</span> : <em>no quote recorded</em>}<div className="cl-src">{x.title}</div></li>
              ))}</ul>
            ) : <p className="cl-note">No source recorded.</p>}
          </div>
          <div>
            <h4>New read</h4>
            <p className="cl-note">{row.derivedWhy}</p>
            {row.derivedSources.length > 0 && (
              <ul className="an-list">{row.derivedSources.slice(0, 4).map((x, i) => (
                <li key={i}>{x.quote ? <span className="cl-quote">{`“${x.quote}”`}</span> : <em>{x.via === "type" ? "the document itself" : "no quote"}</em>}
                  <div className="cl-src">{titleById.get(x.id) ?? x.title}</div></li>
              ))}</ul>
            )}
          </div>
        </div>
      )}
      {!row.agree && open && (
        <VerdictButtons area="readiness" itemKey={row.key} oldState={row.current} newState={row.derived} verdict={row.verdict} note={row.note} />
      )}
    </div>
  );
}

function EligibilityRowView({ s, titleById }: { s: ComparisonData["eligibility"][number]; titleById: Map<string, string> }) {
  const disagree = s.compare === "differs" || s.compare === "adds" || s.conflicting;
  return (
    <tr className={s.conflicting ? "an-conflict" : ""}>
      <td>{s.label}{s.conflicting && <div className="an-bad">more than one value found</div>}</td>
      <td>{s.current.length ? s.current.join(", ") : <em>empty</em>}</td>
      <td>{s.values.map((v, i) => (
        <div key={i}><b>{v.display}</b>
          {v.sources.slice(0, 2).map(src => <div key={src.id} className="cl-src">{`“${src.quote.slice(0, 140)}”`} · {titleById.get(src.id) ?? src.title}</div>)}
        </div>
      ))}
        <div className="ov-muted">{s.compare === "new" ? "Would fill an empty answer" : s.compare === "matches" ? "Matches today" : s.compare === "adds" ? "Adds to today's list" : "Differs from today"}</div>
      </td>
      <td>{disagree
        ? <VerdictButtons area="eligibility" itemKey={s.field} oldState={s.current.join(", ")} newState={s.values.map(v => v.display).join(", ")} verdict={s.verdict} note={s.note} />
        : <span className="ov-muted">Nothing to judge</span>}</td>
    </tr>
  );
}
