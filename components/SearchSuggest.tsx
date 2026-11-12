"use client";
// The predictive global search bar (patch 32). As the person types, name
// matches arrive grouped (Documents, Grants, Funders, Drafts) in a dropdown
// under the bar; each row routes to where the thing lives, and the last row
// hands the query to the full Search page, where passage search remains.
// Plain lookups, debounced; typing costs nothing in AI spend.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Suggest {
  documents: { id: string; title: string; layer: string }[];
  grants: { id: string; title: string; funder: string | null; where: "open" | "watch" | "saved" }[];
  funders: { id: string; name: string }[];
  drafts: { id: string; title: string }[];
}

interface Row { key: string; href: string; group: string; label: string; meta?: string }

const WHERE_LABEL = { open: "Open call", watch: "Watchlist", saved: "Saved" } as const;

export default function SearchSuggest() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const box = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) { setRows([]); setOpen(false); setActive(-1); return; }
    timer.current = setTimeout(async () => {
      const mySeq = ++seq.current;
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(query)}`);
        const body = (await res.json()) as Suggest;
        if (mySeq !== seq.current) return; // a newer keystroke superseded this
        const next: Row[] = [
          ...(body.documents ?? []).map(d => ({
            key: `d:${d.id}`, href: `/documents/${d.id}`, group: "Documents",
            label: d.title, meta: `Layer ${d.layer} · opens in the reader`,
          })),
          ...(body.grants ?? []).map(g => ({
            key: `g:${g.id}`, href: `/funding?focus=${encodeURIComponent(`g:${g.id}`)}`, group: "Grants",
            label: g.title, meta: [WHERE_LABEL[g.where], g.funder].filter(Boolean).join(" · "),
          })),
          ...(body.funders ?? []).map(f => ({
            key: `f:${f.id}`, href: `/funding?mode=funders&focus=${encodeURIComponent(`f:${f.id}`)}`, group: "Funders",
            label: f.name,
          })),
          ...(body.drafts ?? []).map(d => ({
            key: `dr:${d.id}`, href: `/drafts/${d.id}`, group: "Drafts",
            label: d.title,
          })),
        ];
        setRows(next);
        setOpen(true);
        setActive(-1);
      } catch { /* suggestions are a convenience; the full page still works */ }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  // Click outside closes.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (href: string) => { setOpen(false); setQ(""); router.push(href); };
  const searchAll = () => { const v = q.trim(); if (v) go(`/search?q=${encodeURIComponent(v)}`); };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setOpen(rows.length > 0); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, -1)); }
    else if (e.key === "Escape") { setOpen(false); setActive(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && active < rows.length) go(rows[active].href);
      else searchAll(); // the index after the last row, or no selection
    }
  };

  // Group headers render once per group, in arrival order.
  let lastGroup = "";

  return (
    <form ref={box} className="topbar-search ts-suggest" role="search"
      onSubmit={e => { e.preventDefault(); searchAll(); }}>
      <span className="ts-icon">&#8981;</span>
      <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
        onFocus={() => { if (rows.length) setOpen(true); }}
        placeholder="Search this Inven(s)tory…" aria-label="Search" aria-expanded={open}
        aria-autocomplete="list" role="combobox" autoComplete="off" />
      {open && (
        <div className="ts-drop" role="listbox">
          {rows.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={r.key}>
                {header && <div className="ts-group">{header}</div>}
                <button type="button" role="option" aria-selected={i === active}
                  className={`ts-row${i === active ? " ts-active" : ""}`}
                  onMouseEnter={() => setActive(i)} onClick={() => go(r.href)}>
                  <span className="ts-label">{r.label}</span>
                  {r.meta && <span className="ts-meta">{r.meta}</span>}
                </button>
              </div>
            );
          })}
          {rows.length === 0 && <div className="ts-group">No names match</div>}
          <button type="button" className={`ts-row ts-all${active === rows.length ? " ts-active" : ""}`}
            onMouseEnter={() => setActive(rows.length)} onClick={searchAll}>
            Search everything for &ldquo;{q.trim()}&rdquo;
          </button>
        </div>
      )}
    </form>
  );
}
