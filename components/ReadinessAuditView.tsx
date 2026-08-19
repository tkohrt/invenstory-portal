"use client";
import { useState, useEffect } from "react";
import { runReadinessAuditAction } from "@/lib/server/gap-actions";
import type { CoverageTrace, ItemTrace } from "@/lib/server/gap-agent";

const STATE_LABEL: Record<string, string> = { covered: "ROBUST", thin: "THIN", missing: "MISSING" };

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildAuditMarkdown(t: CoverageTrace, name: string, ranAt: number | null): string {
  const L: string[] = [];
  L.push(`# Readiness Audit — ${name}`);
  if (ranAt) L.push(`Run: ${new Date(ranAt).toLocaleString()}`);
  L.push(`${t.docCount} ready documents · generation ${t.generationConfigured ? "on" : "off"} · similarity floor ${t.similarityFloor}${t.usedFallback ? " · used whole-inventory fallback (no per-item retrieval)" : ""}`);
  L.push("");
  const counts = { covered: 0, thin: 0, missing: 0 } as Record<string, number>;
  t.items.forEach(i => { counts[i.finalState] = (counts[i.finalState] ?? 0) + 1; });
  L.push(`Summary: ROBUST ${counts.covered} · THIN ${counts.thin} · MISSING ${counts.missing}`);
  L.push("");
  for (const it of t.items) {
    L.push(`## ${STATE_LABEL[it.finalState] ?? it.finalState} — ${it.label} (${it.tier})`);
    L.push(`- query: ${it.query}`);
    L.push(`- top match similarity: ${it.maxSim.toFixed(3)}`);
    L.push(`- LLM verdict: ${STATE_LABEL[it.llmVerdict] ?? it.llmVerdict}`);
    L.push(`- supporting quote: ${it.llmQuote && it.llmQuote.trim() ? `"${it.llmQuote.trim()}"` : "(none)"}`);
    L.push(`- cited source: ${it.citedSource && it.citedSource.trim() ? it.citedSource.trim() : "(none)"}`);
    L.push(`- sources shown to client: ${it.sources.length ? it.sources.map(x => x.title).join("; ") : "(none)"}`);
    L.push(`### Retrieved chunks (what the grader saw)`);
    if (!it.retrieved.length) L.push("(none retrieved)");
    it.retrieved.forEach((c, i) => {
      L.push(`${i + 1}. [sim ${c.similarity.toFixed(3)}] ${c.title}${c.chunkId ? ` (chunk ${c.chunkId.slice(0, 8)})` : ""}`);
      L.push("```");
      L.push((c.text || "(empty)").slice(0, 1500));
      L.push("```");
    });
    L.push("");
  }
  L.push("---");
  L.push("## Raw model output");
  L.push("```json"); L.push(t.llmRaw || "(none)"); L.push("```");
  L.push("## Full evidence sent to the grader");
  L.push("```"); L.push(t.evidenceSent || "(none)"); L.push("```");
  return L.join("\n");
}

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

export default function ReadinessAuditView({ tenantName, tenantId }: { tenantName: string; tenantId: string }) {
  const [trace, setTrace] = useState<CoverageTrace | null>(null);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const storeKey = `fg_readiness_audit_${tenantId}`;

  // Hydrate the last run for this client from the browser on return.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storeKey);
      if (saved) { const parsed = JSON.parse(saved); if (parsed?.trace) { setTrace(parsed.trace); setRanAt(parsed.ranAt ?? null); } }
      else { setTrace(null); setRanAt(null); }
    } catch { /* ignore */ }
  }, [storeKey]);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const t = await runReadinessAuditAction();
      const now = Date.now();
      setTrace(t); setRanAt(now);
      try { localStorage.setItem(storeKey, JSON.stringify({ trace: t, ranAt: now })); } catch { /* quota */ }
    }
    catch (e) { setErr(e instanceof Error ? e.message : "Audit failed"); }
    setBusy(false);
  };
  const slug = tenantName.replace(/[^\w]+/g, "-").toLowerCase();
  const stamp = new Date(ranAt ?? Date.now()).toISOString().slice(0, 10);
  const exportMd = () => { if (trace) triggerDownload(`readiness-audit-${slug}-${stamp}.md`, buildAuditMarkdown(trace, tenantName, ranAt), "text/markdown"); };
  const exportJson = () => { if (trace) triggerDownload(`readiness-audit-${slug}-${stamp}.json`, JSON.stringify(trace, null, 2), "application/json"); };
  return (
    <div>
      <div className="page-head"><div>
        <h2>Readiness Audit — {tenantName}</h2>
        <p>Re-runs the readiness check and shows, per checklist item, exactly what was retrieved and how it was graded. Admin-only diagnostic.</p>
      </div><div className="spacer" /></div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 14px", flexWrap: "wrap" }}>
        <button className="btn rc-run-cta" style={{ width: "auto", margin: 0 }} onClick={run} disabled={busy}>{busy ? "Running audit…" : trace ? "Re-run audit" : "Run audit"}</button>
        {trace && <button className="btn secondary" style={{ width: "auto", margin: 0 }} onClick={exportMd}>⬇ Export Markdown</button>}
        {trace && <button className="btn secondary" style={{ width: "auto", margin: 0 }} onClick={exportJson}>⬇ Export JSON</button>}
        {ranAt && <span className="acct-note" style={{ margin: 0 }}>Last run {new Date(ranAt).toLocaleString()} · cached in this browser</span>}
      </div>
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
