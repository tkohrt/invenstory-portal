"use client";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { getAllTags, getDocument, getTenant, searchDocuments } from "@/lib/data";
import { DocDrawer, LAYER_META } from "@/components/DocBits";

function Highlighted({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return <span>{parts.map((p, i) => p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p)}</span>;
}

export default function SearchPage() {
  const { tenantId } = useSession();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  if (!tenantId) return null;

  const hits = searchDocuments(tenantId, q, tag);
  const openDoc = openDocId ? getDocument(tenantId, openDocId) : null;

  return (
    <div>
      <div className="page-head"><div><h2>Search</h2>
        <p>Find anything by the words inside documents or by tag — within {getTenant(tenantId)?.name}.</p></div></div>
      <div className="searchbar"><span className="si">⌕</span>
        <input autoFocus placeholder="Try: transportation, budget, founding story, 990…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="filters">
        <button className={`chip ${!tag ? "active" : ""}`} onClick={() => setTag(null)}>All tags</button>
        {getAllTags(tenantId).map(t => (
          <button key={t} className={`chip ${tag === t ? "active" : ""}`} onClick={() => setTag(t)}>{t}</button>
        ))}
      </div>
      {hits.length === 0 && <div className="empty">No matches. Try a different term or tag.</div>}
      {hits.map(({ document: d, tags, snippet }) => (
        <div key={d.id} className="result" onClick={() => setOpenDocId(d.id)}>
          <h4>{d.title}</h4>
          <div className="snippet"><Highlighted text={snippet} q={q} /></div>
          <div className="rmeta">
            <span className="layer-dot" style={{ background: LAYER_META[d.layer].color }} />
            Layer {d.layer} — {LAYER_META[d.layer].name} · {new Date(d.created_at).getFullYear()}
            {tags.map(t => <span key={t} className="tag">{t}</span>)}
          </div>
        </div>
      ))}
      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} />}
    </div>
  );
}
