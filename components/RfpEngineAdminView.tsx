"use client";
// The RFP Engine, For Granted's view (patch 54): is the index fresh, and does
// the scoring still hold on the golden set? Linked quietly from All clients.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RfpAdminStatus, GoldenRunResult } from "@/lib/server/rfp-golden-run";
import { ACTION_LABEL, GOLDEN_BAR, RUBRIC_VERSION } from "@/lib/rfp-rubric";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const hoursAgo = (iso: string) => (Date.now() - Date.parse(iso)) / 3_600_000;

export default function RfpEngineAdminView({ status }: { status: RfpAdminStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GoldenRunResult | null>(null);

  const run = async () => {
    setBusy(true); setErr(null); setResult(null);
    try {
      const res = await fetch("/api/admin/rfp-golden", { method: "POST" });
      const r = (await res.json()) as GoldenRunResult;
      if (!r.ok) setErr(r.error ?? "The run did not finish.");
      else { setResult(r); router.refresh(); }
    } catch { setErr("The run did not finish. Reload and try again."); }
    setBusy(false);
  };

  if (!status.available) {
    return <div><div className="page-head"><div><h2>RFP Engine</h2></div></div>
      <p className="acct-note">The RFP tables are not in the database yet (migrations 0093 and 0095).</p></div>;
  }
  return (
    <div>
      <div className="page-head">
        <div><h2>RFP Engine</h2><p>The federal index and the scoring check. Rubric v{RUBRIC_VERSION}. For Granted only.</p></div>
      </div>

      <section className="wc-card">
        <h3>The index</h3>
        <p className="wc-sub">{status.openNotices === null ? "Open notices could not be counted." : `${status.openNotices.toLocaleString()} notices with a response date still ahead.`} Loaded nightly by fg-rfp-ingest on GitHub Actions; a run can start hours after its 4:23 am slot.</p>
        <ul className="gov-gates">
          {status.sources.map(s => {
            const r = s.lastRun;
            const stale = !r || hoursAgo(r.started_at) > 36;
            const state = !r ? "unanswered" : r.status === "ok" && !stale ? "answered" : "tbc";
            return (
              <li key={s.key}>
                <span className={`gov-dot ${state}`} aria-hidden />
                <span className="gov-gate-name">{s.name}</span>
                <span className="gov-gate-state">{!s.enabled ? "Disabled" : !r ? "Never run" : stale ? "Stale" : r.status === "ok" ? "OK" : r.status}</span>
                <span className="gov-gate-line">{r ? `Last run ${when(r.started_at)}: ${r.seen.toLocaleString()} seen, ${r.new_count.toLocaleString()} new, ${r.updated_count.toLocaleString()} changed, ${r.closed_count.toLocaleString()} closed` : "No run recorded yet."}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="wc-card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Golden set</h3>
          <div style={{ flex: 1 }} />
          <button type="button" className="sb-btn sb-secondary" onClick={run} disabled={busy || !status.goldenProfileLoaded}
            title={!status.goldenProfileLoaded ? "Load the golden set's client profile first." : "About 15 model calls, a few cents."}>
            {busy ? "Running… (up to a minute)" : "Run the golden set"}
          </button>
        </div>
        <p className="wc-sub">The 20 Big Kitty Labs opportunities with settled verdicts. No rubric or prompt change ships unless a run agrees on at least {pct(GOLDEN_BAR)} of rows. Rows the rules decide need no model call.</p>
        {!status.goldenProfileLoaded && <p className="cl-error">The golden set&rsquo;s client profile is not loaded, so the set cannot run yet.</p>}
        {err && <p className="cl-error" role="alert">{err}</p>}

        {result && (
          <>
            <p className="wc-sub" role="status" style={{ marginTop: 10 }}>
              <b>{result.passed ? "Passed" : "Below the bar"}: {result.agreed} of {result.total} rows agree ({pct(result.agreement)}).</b>{" "}
              On the original 8-row comparison set: {result.comparableAgreed} of {result.comparable} ({pct(result.comparableAgreement)}).
              {!result.recorded && " The run could not be recorded."}
            </p>
            <ul className="gov-gates">
              {result.rows.map(r => (
                <li key={r.id}>
                  <span className={`gov-dot ${r.agreed ? "answered" : "tbc"}`} aria-hidden />
                  <span className="gov-gate-name">{r.id} {r.label}</span>
                  <span className="gov-gate-state">{r.agreed ? "Agrees" : "Differs"}</span>
                  <span className="gov-gate-line">
                    {r.got ? ACTION_LABEL[r.got] : "Not scored"}
                    {!r.agreed && ` (settled: ${ACTION_LABEL[r.expected]})`}
                    {r.fit && `. Fit ${r.fit}${r.frozenFit && r.fit !== r.frozenFit ? `, settled ${r.frozenFit}` : ""}${r.quotesVerified === false ? ", quotes not found in source" : ""}`}
                    {r.byRules ? ". Decided by the rules." : r.rationale ? `. ${r.rationale}` : ""}
                    {r.quotesVerified === false && r.evidence.length > 0 && (
                      <span style={{ display: "block", marginTop: 2 }}>
                        Quotes given: {r.evidence.map(e => `${e.from === "client" ? "profile" : "notice"}: \u201c${e.text}\u201d`).join("; ")}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {status.goldenRuns.length > 0 && (
          <>
            <h4 style={{ margin: "14px 0 6px" }}>Recent runs</h4>
            <ul className="gov-gates">
              {status.goldenRuns.map(g => (
                <li key={g.run_at}>
                  <span className={`gov-dot ${g.passed ? "answered" : "tbc"}`} aria-hidden />
                  <span className="gov-gate-name">{when(g.run_at)}</span>
                  <span className="gov-gate-state">{g.passed ? "Passed" : "Below bar"}</span>
                  <span className="gov-gate-line">{g.agreed} of {g.comparable} ({pct(g.agreement)}), {g.model}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
