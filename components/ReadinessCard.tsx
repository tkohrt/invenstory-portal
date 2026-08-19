"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addInvenstoryNoteAction } from "@/lib/server/note-actions";
import { runGapAnalysisAction } from "@/lib/server/gap-actions";
import type { ReadinessItem } from "@/lib/checklist";

const TIER_LABEL = { essential: "🟠 Essential", important: "🟡 Important", enriching: "🔵 Enriching" } as const;

function ItemDetail({ item, onClose, onUpload, onOpenDoc, onSaved }: {
  item: ReadinessItem; onClose: () => void;
  onUpload?: (layer: "I" | "II" | "III") => void; onOpenDoc?: (id: string) => void; onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); await addInvenstoryNoteAction(item.key, text); setBusy(false); onSaved(); };
  const badge = item.state === "covered" ? <span className="ck-badge robust">robust</span> : item.state === "thin" ? <span className="ck-badge thin">thin</span> : <span className="ck-badge missing">missing</span>;
  return (
    <div className="ck-detail">
      <div className="ck-detail-head">
        <b>{item.label}</b>{badge}
        <div style={{ flex: 1 }} />
        <button type="button" className="ck-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="ck-why">{item.blurb}</p>

      {item.state !== "missing" && item.sources.length > 0 && (
        <div className="ck-sources">
          <div className="section-label">Found in your documents</div>
          {item.sources.map(sdoc => (
            <button key={sdoc.id} type="button" className="ck-source" onClick={() => onOpenDoc?.(sdoc.id)}>📄 {sdoc.title}</button>
          ))}
        </div>
      )}

      <div className="section-label" style={{ marginTop: 12 }}>Add more</div>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={`Write what you know about "${item.label}". It saves into your Inven(s)tory, tagged and searchable.`} />
      <div className="ck-detail-actions">
        <button className="btn inline" onClick={save} disabled={busy || text.trim().length < 10}>{busy ? "Saving…" : `Save to your Inven(s)tory (Layer ${item.layer})`}</button>
        <span className="acct-note" style={{ margin: 0 }}>Auto-tagged: {item.key.replace(/_/g, " ")}</span>
      </div>
      <button type="button" className="btn secondary ck-upbtn" onClick={() => onUpload?.(item.layer)}>Upload to your Inven(s)tory →</button>
    </div>
  );
}

export default function ReadinessCard({ readiness, computedAt, onUpload, onOpenDoc }: {
  readiness: { pct: number; items: ReadinessItem[] }; computedAt: string | null;
  onUpload?: (layer: "I" | "II" | "III") => void; onOpenDoc?: (id: string) => void;
}) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const analyze = async () => { setAnalyzing(true); await runGapAnalysisAction(); setAnalyzing(false); router.refresh(); };
  const pctColor = readiness.pct >= 80 ? "#3a7d44" : readiness.pct >= 50 ? "#b08a2e" : "#b06a2e";
  const mark = (s: string) => s === "covered" ? "✓" : s === "thin" ? "◐" : "○";

  return (
    <section className="acct-card readiness-card">
      <div className="rc-head">
        <b style={{ fontSize: 22, color: pctColor }}>{readiness.pct}%</b>
        <h3 style={{ margin: 0 }}>Inven(s)tory readiness</h3>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={analyze} disabled={analyzing}>{analyzing ? "Analyzing…" : computedAt ? "Re-analyze" : "Analyze my Inven(s)tory"}</button>
        <span className="acct-note" style={{ margin: 0 }}>What a robust Inven(s)tory holds. ✓ covered · ◐ thin · ○ missing.</span>
      </div>
      <div className="fe-bar" style={{ maxWidth: "none", margin: "8px 0 12px" }}><span style={{ width: `${readiness.pct}%`, background: pctColor }} /></div>

      <div className="ck-cols">
        {(["essential", "important", "enriching"] as const).map(tier => {
          const rows = readiness.items.filter(i => i.tier === tier);
          const item = rows.find(i => i.key === expanded);
          return (
            <div key={tier} className={`ck-col ${tier}`}>
              <div className="section-label">{TIER_LABEL[tier]}</div>
              <div className="ck-list">
                {rows.map(i => (
                  <button key={i.key} type="button" className={`ck-row ${i.state}`} onClick={() => setExpanded(i.key)}>
                    <span className="ck-mark">{mark(i.state)}</span>
                    <span className="ck-label" title={i.label}>{i.label}</span>
                    <span className="ck-badge-slot">
                      {i.state === "covered" && <span className="ck-badge robust">robust</span>}
                      {i.state === "thin" && <span className="ck-badge thin">thin</span>}
                    </span>
                    <span className="ck-expand">Expand →</span>
                  </button>
                ))}
              </div>
              {item && (
                <div className="ck-overlay">
                  <ItemDetail item={item} onClose={() => setExpanded(null)} onUpload={onUpload} onOpenDoc={onOpenDoc}
                    onSaved={() => { setExpanded(null); router.refresh(); }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
