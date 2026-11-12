"use client";
// Live full-text search over document CONTENT via /api/search (Postgres FTS,
// RLS-scoped). Passages arrive with <<hl>>…<</hl>> sentinels; we HTML-escape
// the passage first, THEN swap sentinels for <mark>, so document content can
// never inject markup (stored-XSS safe).
import { useEffect, useRef, useState } from "react";
import { DocDrawer, LAYER_META } from "./DocBits";
import type { DocumentWithTags, Layer } from "@/lib/types";

interface Hit {
  document_id: string; title: string; layer: Layer; doc_kind: string;
  created_at: string; passage: string; page_number: number | null;
}

/** A find-by-name hit (patch 31): the title matched, whatever the parser thinks. */
interface TitleHit { id: string; title: string; layer: Layer; doc_kind: string; created_at: string }

function renderPassage(raw: string) {
  const escaped = raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const marked = escaped
    .replace(/&lt;&lt;hl&gt;&gt;/g, "<mark>").replace(/&lt;&lt;\/hl&gt;&gt;/g, "</mark>");
  return { __html: marked };
}

export default function SearchView({ tenantName, tags, docs, isAdmin, initialQuery }: {
  tenantName: string; tags: string[]; docs: DocumentWithTags[]; isAdmin: boolean; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [tag, setTag] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [titleHits, setTitleHits] = useState<TitleHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openDoc = docs.find(d => d.id === openDocId) ?? null;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setHits([]); setTitleHits([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const params = new URLSearchParams({ q });
      if (tag) params.set("tag", tag);
      if (layer) params.set("layer", layer);
      const res = await fetch(`/api/search?${params}`);
      const body = await res.json();
      setHits(body.results ?? []);
      setTitleHits(body.documents ?? []);
      setLoading(false);
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, tag, layer]);

  return (
    <div>
      <div className="page-head"><div><h2>Search</h2>
        <p>Find anything by the words inside your documents — within {tenantName}.</p></div></div>
      <div className="searchbar"><span className="si">⌕</span>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="Try: transportation, diversify settlement, founding story, dispatch…" />
      </div>
      <div className="filters">
        <button className={`chip ${!layer ? "active" : ""}`} onClick={() => setLayer(null)}>All layers</button>
        {(["I", "II", "III"] as Layer[]).map(L => (
          <button key={L} className={`chip ${LAYER_META[L].cls} ${layer === L ? "active" : ""}`}
            onClick={() => setLayer(layer === L ? null : L)}>Layer {L}</button>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="filters">
          <button className={`chip ${!tag ? "active" : ""}`} onClick={() => setTag(null)}>All tags</button>
          {tags.map(t => (
            <button key={t} className={`chip ${tag === t ? "active" : ""}`} onClick={() => setTag(tag === t ? null : t)}>{t}</button>
          ))}
        </div>
      )}
      {q.trim() && loading && <div className="empty">Searching…</div>}
      {q.trim() && !loading && hits.length === 0 && titleHits.length === 0 && <div className="empty">No matches inside your documents. Try a different term.</div>}
      {/* Documents whose NAME matches come first (patch 31): finding a file
          by its title must never depend on what its text happens to say. */}
      {!loading && titleHits.length > 0 && (
        <div className="sr-docs">
          <h3 className="sr-group">Documents</h3>
          {titleHits.map(d => (
            <a key={d.id} className="result sr-doc" href={`/documents/${d.id}`}>
              <h4>{d.title}</h4>
              <div className="rmeta">
                <span className="layer-dot" style={{ background: LAYER_META[d.layer].color }} />
                Layer {d.layer} — {LAYER_META[d.layer].name}
                <span>{new Date(d.created_at).getFullYear()}</span>
                <span className="tag">Open in the reader</span>
              </div>
            </a>
          ))}
        </div>
      )}
      {!loading && hits.length > 0 && titleHits.length > 0 && <h3 className="sr-group">Passages</h3>}
      {hits.map(h => (
        <div key={h.document_id} className="result" onClick={() => setOpenDocId(h.document_id)}>
          <h4>{h.title}</h4>
          <div className="snippet" dangerouslySetInnerHTML={renderPassage(h.passage)} />
          <div className="rmeta">
            <span className="layer-dot" style={{ background: LAYER_META[h.layer].color }} />
            Layer {h.layer} — {LAYER_META[h.layer].name}
            {h.page_number ? <span className="tag">page {h.page_number}</span> : null}
            <span>{new Date(h.created_at).getFullYear()}</span>
          </div>
        </div>
      ))}
      {!q.trim() && <div className="empty">Start typing to search across every document in this Inven(s)tory.</div>}
      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} isAdmin={isAdmin} />}
    </div>
  );
}
