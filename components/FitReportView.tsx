"use client";
// The fit report page (patch 6 of the 1 November 2026 build). A clean, printable
// reading of every lead, grouped by what to do. "Save as PDF" is the browser's
// own print to PDF, with the portal's frame left off the page.
import { useMemo, useState } from "react";
import { kindWord, reportCsv, type FitReport, type FitRow, type Call3, type FitCall, type RangeCall } from "@/lib/fit-report";

const ELIG: Record<Call3, string> = { yes: "Yes", check: "Check", no: "No" };
const FIT: Record<FitCall, string> = { strong: "Strong", partial: "Partial", unclear: "Unclear" };
const SIZE: Record<RangeCall, string> = { fits: "Fits", small: "Small", large: "Large", unknown: "Unknown" };

function Pill({ tone, children, title }: { tone: "good" | "mid" | "low" | "bad"; children: React.ReactNode; title?: string }) {
  return <span className={`fr-pill fr-${tone}`} title={title}>{children}</span>;
}
const eligTone = (c: Call3) => c === "yes" ? "good" : c === "check" ? "mid" : "bad";
const fitTone = (c: FitCall) => c === "strong" ? "good" : c === "partial" ? "mid" : "low";
const sizeTone = (c: RangeCall) => c === "fits" ? "good" : c === "unknown" ? "low" : "mid";

function Row({ r, isAdmin }: { r: FitRow; isAdmin: boolean }) {
  return (
    <article className="fr-row">
      <header>
        <div className="fr-title">
          {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : r.title}
          <span className="fr-meta">
            {r.kind === "funder" ? "Funder" : "Opportunity"}
            {r.kind === "opportunity" && r.funder ? ` · ${r.funder}` : ""}
            {` · ${r.origin}`}
            {kindWord(r.moneyKind) ? ` · ${kindWord(r.moneyKind)}` : ""}
          </span>
        </div>
        <div className="fr-access">{r.access}</div>
      </header>
      <dl className="fr-grid">
        <div><dt>Can you apply?</dt><dd><Pill tone={eligTone(r.eligibility.call)}>{ELIG[r.eligibility.call]}</Pill> {r.eligibility.why}</dd></div>
        <div><dt>Mission fit</dt><dd><Pill tone={fitTone(r.mission.call)}>{FIT[r.mission.call]}</Pill> {r.mission.why}</dd></div>
        <div><dt>Size of the money</dt><dd><Pill tone={sizeTone(r.range.call)}>{SIZE[r.range.call]}</Pill> {r.range.why}</dd></div>
        <div><dt>Next step</dt><dd>{r.next}</dd></div>
      </dl>
      {r.clientView && <div className="fr-client">{isAdmin ? "The client's view" : "Your view"}: {r.clientView}</div>}
    </article>
  );
}

export default function FitReportView({ report, orgName, isAdmin, generatedAt, lastRun }: {
  report: FitReport; orgName: string; isAdmin: boolean; generatedAt: string; lastRun: string | null;
}) {
  const [kind, setKind] = useState<"all" | "opportunity" | "funder">("all");
  const groups = useMemo(() => report.groups
    .map(g => ({ ...g, rows: kind === "all" ? g.rows : g.rows.filter(r => r.kind === kind) }))
    .filter(g => g.rows.length), [report, kind]);

  const csv = () => {
    const blob = new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${orgName.replace(/[^a-z0-9]+/gi, "-")}-fit-report.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="fr-page">
      <div className="fr-actions no-print">
        <a className="sb-btn sb-quiet sb-sm" href="/funding">Funding</a>
        <span className="spacer" />
        <div className="fr-filter" role="group" aria-label="Show">
          {(["all", "opportunity", "funder"] as const).map(k => (
            <button key={k} type="button" className="rd-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "all" ? "Everything" : k === "opportunity" ? "Open calls" : "Funders"}
            </button>
          ))}
        </div>
        <button type="button" className="sb-btn sb-secondary sb-sm" onClick={csv}>Download as a spreadsheet (CSV)</button>
        <button type="button" className="sb-btn sb-primary sb-sm" onClick={() => window.print()}>Save as PDF</button>
      </div>

      <header className="fr-head">
        <div className="fr-brand">For Granted · Funding fit report</div>
        <h2>{orgName}</h2>
        <p className="fr-sub">
          {report.counts.total} lead{report.counts.total === 1 ? "" : "s"}
          {` · ${report.counts.apply} to apply for, ${report.counts.approach} to approach, ${report.counts.research} to research`}
          {isAdmin && report.counts.ruled_out ? `, ${report.counts.ruled_out} ruled out` : ""}
          {` · prepared ${new Date(generatedAt).toLocaleDateString()}`}
          {lastRun ? ` from the search of ${new Date(lastRun).toLocaleDateString()}` : ""}
        </p>
        <p className="fr-how">
          Every lead answers the same four questions. <b>Can you apply</b> comes from the eligibility rules and your
          Funding Eligibility answers; <b>mission fit</b> from how the opportunity matches your Inven(s)tory;
          <b> size</b> from your annual budget. Nothing here replaces reading the funder&rsquo;s own page:
          deadlines and priorities change.
        </p>
      </header>

      {!groups.length && <div className="empty">Nothing to report yet. Run a search on Funder Matches first.</div>}
      {groups.map(g => (
        <section key={g.key} className={`fr-group fr-g-${g.key}`}>
          <h3>{g.label} <span className="fr-count">{g.rows.length}</span></h3>
          <p className="fr-help">{g.help}</p>
          {g.rows.map(r => <Row key={`${r.kind}:${r.id}`} r={r} isAdmin={isAdmin} />)}
        </section>
      ))}
      <footer className="fr-foot">
        Sources: Ground Truth (For Granted&rsquo;s verified funder and grant records)
        {report.groups.some(g => g.rows.some(r => r.origin === "World Bank")) ? ", World Bank procurement notices" : ""}
        {report.groups.some(g => g.rows.some(r => r.origin === "EU portal")) ? ", the EU Funding & Tenders Portal" : ""}
        {report.groups.some(g => g.rows.some(r => r.origin === "IATI")) ? ", international aid data (IATI)" : ""}
        {report.groups.some(g => g.rows.some(r => r.origin === "Web")) ? ", and pages found by a web search" : ""}.
      </footer>
    </div>
  );
}
