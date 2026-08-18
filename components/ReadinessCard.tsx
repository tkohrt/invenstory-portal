"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addInvenstoryNoteAction } from "@/lib/server/note-actions";
import { runGapAnalysisAction } from "@/lib/server/gap-actions";

type Item = { key: string; label: string; tier: "essential" | "important" | "enriching"; layer: string; state: "covered" | "thin" | "missing" };

function ChecklistRow({ item, onSaved }: { item: Item; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const mark = item.state === "covered" ? "✓" : item.state === "thin" ? "◐" : "○";
  const save = async () => { setBusy(true); await addInvenstoryNoteAction(item.key, text); setBusy(false); setOpen(false); setText(""); onSaved(); };
  return (
    <div className={`ck-row ${item.state}`}>
      <div className="ck-head">
        <span className="ck-mark">{mark}</span>
        <span className="ck-label">{item.label}</span>
        {item.state === "thin" && <span className="ck-badge">thin</span>}
        {item.state !== "covered" && (
          <button type="button" className="ck-write" onClick={() => setOpen(o => !o)}>{open ? "Close" : (item.state === "thin" ? "Add more" : "Write about this")}</button>
        )}
        <a className="ck-upload" href="/invenstory" title={`Upload to Layer ${item.layer}`}>Upload →</a>
      </div>
      {open && (
        <div className="ck-note">
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder={`Write what you know about "${item.label}". It saves into your Inven(s)tory, tagged and searchable.`} />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn inline" onClick={save} disabled={busy || text.trim().length < 10}>{busy ? "Saving…" : "Save to Inven(s)tory"}</button>
            <span className="acct-note" style={{ margin: 0 }}>Filed to Layer {item.layer}.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReadinessCard({ readiness, computedAt }: {
  readiness: { pct: number; items: Item[] }; computedAt: string | null;
}) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const analyze = async () => { setAnalyzing(true); await runGapAnalysisAction(); setAnalyzing(false); router.refresh(); };
  return (
    <section className="acct-card readiness-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Inven(s)tory readiness</h3>
        <div style={{ flex: 1 }} />
        <b style={{ fontSize: 18, color: readiness.pct >= 80 ? "#3a7d44" : readiness.pct >= 50 ? "#b08a2e" : "#b06a2e" }}>{readiness.pct}%</b>
      </div>
      <div className="fe-bar" style={{ maxWidth: "none", margin: "8px 0 12px" }}><span style={{ width: `${readiness.pct}%` }} /></div>
      {(["essential", "important", "enriching"] as const).map(tier => {
        const rows = readiness.items.filter(i => i.tier === tier);
        if (!rows.length) return null;
        const T = { essential: "🟠 Essential", important: "🟡 Important", enriching: "⚪ Enriching" }[tier];
        return (
          <div key={tier} style={{ marginBottom: 8 }}>
            <div className="section-label">{T}</div>
            <div className="ck-list">{rows.map(i => <ChecklistRow key={i.key} item={i} onSaved={() => router.refresh()} />)}</div>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
        <button className="btn ghost" onClick={analyze} disabled={analyzing}>{analyzing ? "Analyzing…" : computedAt ? "Re-analyze" : "Analyze my Inven(s)tory"}</button>
        <span className="acct-note" style={{ margin: 0 }}>What a robust Inven(s)tory holds. ✓ covered · ◐ thin · ○ missing.</span>
      </div>
    </section>
  );
}
