"use client";
// Phase 3a: client-side filter over live rows. Phase 5 replaces the matching
// with Postgres FTS + ts_headline passage results (shapes stay).
import { useState } from "react";
import { DocDrawer, LAYER_META } from "./DocBits";
import type { DocumentWithTags } from "@/lib/types";

function Highlighted({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return <span>{parts.map((p, i) => p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p)}</span>;
}

export default function SearchView({ tenantName, docs }: { tenantName: string; docs: DocumentWithTags[] }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const allTags = [...new Set(docs.flatMap(d => d.tags))];
  const query = q.toLowerCase().trim();
  const hits = docs.filter(d => {
    const text = `${d.title} ${d.snippet} ${d.tags.join(" ")}`.toLowerCase();
    return (!query || text.includes(query)) && (!tag || d.tags.includes(tag));
  });
  const openDoc = docs.find(d => d.id === openDocId) ?? null;

  return (
    <div>
      <div className="page-head"><div><h2>Search</h2>
        <p>Find anything by the words inside documents or by tag — within {tenantName}.</p></div></div>
      <div className="searchbar"><span className="si">⌕</span>
        <input autoFocus placeholder="Try: transportation, budget, founding story, 990…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="filters">
        <button className={`chip ${!tag ? "active" : ""}`} onClick={() => setTag(null)}>All tags</button>
        {allTags.map(t => (
          <button key={t} className={`chip ${tag === t ? "active" : ""}`} onClick={() => setTag(t)}>{t}</button>
        ))}
      </div>
      {hits.length === 0 && <div className="empty">No matches. Try a different term or tag.</div>}
      {hits.map(d => (
        <div key={d.id} className="result" onClick={() => setOpenDocId(d.id)}>
          <h4>{d.title}</h4>
          <div className="snippet"><Highlighted text={d.snippet} q={q} /></div>
          <div className="rmeta">
            <span className="layer-dot" style={{ background: LAYER_META[d.layer].color }} />
            Layer {d.layer} — {LAYER_META[d.layer].name} · {new Date(d.created_at).getFullYear()}
            {d.tags.map(t => <span key={t} className="tag">{t}</span>)}
          </div>
        </div>
      ))}
      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} />}
    </div>
  );
}
