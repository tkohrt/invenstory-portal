"use client";
import { useState } from "react";
import { runReadinessAuditAction } from "@/lib/server/gap-actions";
import type { CoverageTrace, ItemTrace } from "@/lib/server/gap-agent";

const STATE_LABEL: Record<string, string> = { covered: "ROBUST", thin: "THIN", missing: "MISSING" };

function StateBadge({ s }: { s: string }) {
  return <span className={`ra-badge ra-${s}`}>{STATE_LABEL[s] ?? s}</span>;
}

function simClass(sim: number) { return sim >= 0.6 ? "ra-sim-strong" : sim >= 0.4 ? "ra-sim-mid" : "ra-sim-weak"; }

function ItemRow({ it }: { it: ItemTrace }) {
  const [open, setOpen] = useState(false);
  const mismatch = it.finalState === "covered" && !it.llmQuote.trim();
  return (
    <div className={`ra-item${mismatch ? " ra-flag" : ""}`}>
      <button className="ra-item-head" onClick={() => setOpen(o => !o)}>
        <span className="ra-caret">{open ? "▾" : "▸"}</span>
        <StateBadge s={it.finalState} />
        <span className="ra-label">{it.label}</span>
        <span className="ra-tier">{it.tier}</span>
        <span className={`ra-sim ${simClass(it.maxSim)}`}>top match {it.maxSim.toFixed(2)}</span>
        {mismatch && <span className="ra-warn">⚠ covered without a supporting quote</span>}
      </button>
      {open && (
        <div className="ra-item-body">
          <div className="ra-meta">
            <span>query: <code>{it.query}</code></span>
            <span>LLM verdict: <b>{STATE_LABEL[it.llmVerdict]}</b></span>
            <span>similarity floor fired: <b>{it.floorFired ? "yes → thin" : "no"}</b></span>
            <span>final: <b>{STATE_LABEL[it.finalState]}</b></span>
          </div>
          <div className="ra-quote">supporting quote: {it.llmQuote.trim() ? <q>{it.llmQuote}</q> : <span className="ra-none">(none — grader gave no quote)</span>}</div>
          <div className="ra-sources">cited source: {it.citedSource.trim() || "(none)"} · shown to client: {it.sources.length ? it.sources.map(s => s.title).join("; ") : "(none)"}</div>
          <div className="ra-chunks-label">Retrieved chunks (what the grader saw):</div>
          {it.retrieved.length === 0 && <div className="ra-empty">No chunks retrieved.</div>}
          {it.retrieved.map((c, i) => (
            <div key={i} className="ra-chunk">
              <div className="ra-chunk-head">
                <span className={`ra-sim ${simClass(c.similarity)}`}>{c.similarity.toFixed(3)}</span>
                <span className="ra-chunk-title">{c.title}</span>
                {c.chunkId && <span className="ra-chunk-id">chunk {c.chunkId.slice(0, 8)}</span>}
              </div>
              <div className="ra-chunk-text">{c.text.slice(0, 500) || "(empty)"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReadinessAuditView({ tenantName }: { tenantName: string }) {
  const [trace, setTrace] = useState<CoverageTrace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setTrace(await runReadinessAuditAction()); }
    catch (e) { setErr(e instanceof Error ? e.message : "Audit failed"); }
    setBusy(false);
  };
  return (
    <div>
      <div className="page-head"><div>
        <h2>Readiness Audit — {tenantName}</h2>
        <p>Re-runs the readiness check and shows, per checklist item, exactly what was retrieved and how it was graded. Admin-only diagnostic.</p>
      </div><div className="spacer" /></div>
      <button className="btn rc-run-cta" style={{ width: "auto", margin: "0 0 14px" }} onClick={run} disabled={busy}>{busy ? "Running audit…" : trace ? "Re-run audit" : "Run audit"}</button>
      {err && <div className="metric-gap">{err}</div>}
      {trace && (
        <>
          <div className="ra-summary">
            {trace.docCount} ready documents · generation {trace.generationConfigured ? "on" : "off"} · similarity floor {trace.similarityFloor}
            {trace.usedFallback && " · ⚠ used whole-inventory fallback (no per-item retrieval)"}
          </div>
          <div className="ra-list">{trace.items.map(it => <ItemRow key={it.key} it={it} />)}</div>
          <details className="ra-raw"><summary>Raw model output</summary><pre>{trace.llmRaw || "(none)"}</pre></details>
          <details className="ra-raw"><summary>Full evidence sent to the grader</summary><pre>{trace.evidenceSent || "(none)"}</pre></details>
        </>
      )}
    </div>
  );
}
