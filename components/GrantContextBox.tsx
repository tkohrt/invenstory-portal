"use client";
// The grant context box (Auto-Draft patch 5, spec section 4a): Funder context
// and Client context, each holding any number of items, each typed or pasted
// text, a PDF, a Word file, a .txt file or a web address.
//
// Two ways to use it:
//   pending  on /drafts/new, before the draft exists: items are held here and
//            the page sends them once the draft is created (sendPendingContext);
//   live     on a draft: each item is saved as it is added, and can be
//            renamed, removed, read back, and its original file opened.
// Nothing here is filed into the Inven(s)tory, and nothing uses AI.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONTEXT_PARTS, CONTEXT_KIND_LABEL, MAX_CONTEXT_UPLOAD_BYTES, MAX_ITEMS_PER_PART, contextTitle, wordCount,
  type ContextPart,
} from "@/lib/draft-context";
import {
  openDraftContextFileAction, readDraftContextAction, removeDraftContextAction, renameDraftContextAction,
} from "@/lib/server/draft-context-actions";
import type { ContextItem } from "@/lib/server/draft-context";

type AddSource = "text" | "file" | "url";

/** An item waiting on /drafts/new for the draft to exist. */
export interface PendingContext { key: string; part: ContextPart; source: AddSource; title: string; text?: string; file?: File; url?: string }

/** Send every waiting item to the new draft. Returns how many could not be added, with the first reason. */
export async function sendPendingContext(draftId: string, items: PendingContext[]): Promise<{ failed: number; reason: string | null }> {
  let failed = 0, reason: string | null = null;
  for (const it of items) {
    const err = await postItem(draftId, it.part, it.source, it.title, it.text, it.file, it.url);
    if (err) { failed++; reason ??= err; }
  }
  return { failed, reason };
}

async function postItem(draftId: string, part: ContextPart, source: AddSource, title: string, text?: string, file?: File, url?: string): Promise<string | null> {
  const fd = new FormData();
  fd.set("draftId", draftId); fd.set("part", part); fd.set("source", source); fd.set("title", title);
  if (source === "text") fd.set("text", text ?? "");
  if (source === "file" && file) fd.set("file", file);
  if (source === "url") fd.set("url", url ?? "");
  try {
    const res = await fetch("/api/drafts/context", { method: "POST", body: fd });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return r.error ?? (res.status === 413 ? "That file is too large. Paste the text instead." : "Could not add that.");
    return null;
  } catch { return "Could not reach the portal. Check the connection and try again."; }
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function GrantContextBox(props:
  | { mode: "pending"; items: PendingContext[]; onChange: (items: PendingContext[]) => void }
  | { mode: "live"; draftId: string; items: ContextItem[]; locked: boolean; ready: boolean }) {
  const router = useRouter();
  const [viewing, setViewing] = useState<{ title: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = props.mode === "live";
  const locked = live && props.locked;

  if (live && !props.ready) return <div className="gc"><div className="ap-error">The grant context box needs migration 0063.</div></div>;

  const countIn = (part: ContextPart) => props.items.filter(i => i.part === part).length;

  return (
    <div className="gc">
      {err && <div className="ap-error" role="alert">{err}</div>}
      <div className="gc-parts">
        {CONTEXT_PARTS.map(p => (
          <section key={p.key} className={`gc-part gc-${p.key}`} aria-label={p.label}>
            <h4>{p.label} <span className="ov-muted gc-n">{countIn(p.key) || ""}</span></h4>
            <p className="ov-muted gc-describe">{p.describe}</p>
            <ul className="gc-items">
              {props.mode === "pending"
                ? props.items.filter(i => i.part === p.key).map(i => (
                    <li key={i.key} className="gc-item">
                      <span className="gc-kind">{CONTEXT_KIND_LABEL[i.source === "file" ? fileKindLabel(i.file) : i.source === "url" ? "url" : "text"]}</span>
                      <span className="gc-title">{i.title}</span>
                      <span className="ov-muted gc-meta">{i.source === "text" ? `${wordCount(i.text ?? "").toLocaleString()} words` : i.source === "file" ? `${Math.ceil((i.file?.size ?? 0) / 1024)} KB` : "read when the draft is created"}</span>
                      <button type="button" className="fc-link" onClick={() => props.onChange(props.items.filter(x => x.key !== i.key))}>remove</button>
                    </li>
                  ))
                : props.items.filter(i => i.part === p.key).map(i => (
                    <LiveRow key={i.id} item={i} locked={locked} onError={setErr} onView={setViewing} onDone={() => router.refresh()} />
                  ))}
            </ul>
            {!locked && countIn(p.key) < MAX_ITEMS_PER_PART && (
              <AddForm part={p.key} placeholder={p.placeholder}
                onAdd={async (source, title, text, file, url) => {
                  setErr(null);
                  if (props.mode === "pending") {
                    props.onChange([...props.items, {
                      key: `${Date.now()}-${Math.random()}`, part: p.key, source, text, file, url,
                      title: contextTitle({ title, filename: file?.name, url, text }),
                    }]);
                    return null;
                  }
                  const e = await postItem(props.draftId, p.key, source, title, text, file, url);
                  if (!e) router.refresh();
                  return e;
                }} />
            )}
          </section>
        ))}
      </div>
      {viewing && <TextWindow title={viewing.title} text={viewing.text} onClose={() => setViewing(null)} />}
    </div>
  );
}

function fileKindLabel(f?: File): "pdf" | "docx" | "txt" {
  const n = (f?.name ?? "").toLowerCase();
  return n.endsWith(".pdf") ? "pdf" : n.endsWith(".docx") ? "docx" : "txt";
}

function LiveRow({ item, locked, onError, onView, onDone }: {
  item: ContextItem; locked: boolean; onError: (e: string | null) => void;
  onView: (v: { title: string; text: string }) => void; onDone: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const act = async (f: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true); onError(null);
    try { const r = await f(); if (!r.ok) onError(r.error); else { setRenaming(false); onDone(); } }
    catch { onError("Could not reach the portal. Check the connection and try again."); }
    setBusy(false);
  };
  return (
    <li className="gc-item">
      <span className="gc-kind">{CONTEXT_KIND_LABEL[item.kind]}</span>
      {renaming
        ? <span className="gc-rename">
            <input value={title} maxLength={160} autoFocus aria-label="Name" onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void act(() => renameDraftContextAction(item.id, title)); if (e.key === "Escape") setRenaming(false); }} />
            <button type="button" className="btn inline ap-mini" disabled={busy} onClick={() => void act(() => renameDraftContextAction(item.id, title))}>Save</button>
            <button type="button" className="fc-link" onClick={() => { setTitle(item.title); setRenaming(false); }}>cancel</button>
          </span>
        : <span className="gc-title">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a> : item.title}</span>}
      <span className="ov-muted gc-meta">{item.words.toLocaleString()} words · {item.addedBy ? `${item.addedBy}, ` : ""}{day(item.addedAt)}</span>
      {!renaming && (
        <span className="gc-acts">
          <button type="button" className="fc-link" disabled={busy}
            onClick={() => void readDraftContextAction(item.id).then(r => r.ok ? onView({ title: r.title, text: r.text }) : onError(r.error))}>read</button>
          {item.hasFile && <button type="button" className="fc-link" disabled={busy}
            onClick={() => void openDraftContextFileAction(item.id).then(r => r.ok ? window.open(r.url, "_blank", "noopener,noreferrer") : onError(r.error))}>original</button>}
          {!locked && <button type="button" className="fc-link" disabled={busy} onClick={() => setRenaming(true)}>rename</button>}
          {!locked && <button type="button" className="fc-link gc-remove" disabled={busy} onClick={() => void act(() => removeDraftContextAction(item.id))}>remove</button>}
        </span>
      )}
    </li>
  );
}

function AddForm({ part, placeholder, onAdd }: {
  part: ContextPart; placeholder: string;
  onAdd: (source: AddSource, title: string, text?: string, file?: File, url?: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<AddSource>("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = () => { setTitle(""); setText(""); setUrl(""); setFile(null); setError(null); };
  const ready = source === "text" ? text.trim().length >= 3 : source === "file" ? !!file : /^https?:\/\/\S+\.\S+/.test(url.trim());
  const add = async () => {
    if (source === "file" && file && file.size > MAX_CONTEXT_UPLOAD_BYTES) { setError("That file is over 4 MB. Paste the text instead."); return; }
    setBusy(true); setError(null);
    const e = await onAdd(source, title, text, file ?? undefined, url);
    setBusy(false);
    if (e) setError(e); else { reset(); setOpen(false); }
  };
  if (!open) return <button type="button" className="btn secondary ap-mini gc-add" onClick={() => setOpen(true)}>＋ Add</button>;
  return (
    <div className="gc-form">
      <div className="ap-tabs" role="tablist" aria-label="What to add">
        {([["text", "Type or paste"], ["file", "PDF, Word or .txt"], ["url", "Web address"]] as [AddSource, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={source === k} className={`chip${source === k ? " active" : ""}`}
            onClick={() => { setSource(k); setError(null); }}>{label}</button>
        ))}
      </div>
      {source === "text" && <textarea rows={5} value={text} placeholder={placeholder} onChange={e => setText(e.target.value)} aria-label="Text" />}
      {source === "file" && <input type="file" aria-label="File"
        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        onChange={e => setFile(e.target.files?.[0] ?? null)} />}
      {source === "url" && <input value={url} placeholder="https://" inputMode="url" aria-label="Web address" onChange={e => setUrl(e.target.value)} />}
      <input value={title} maxLength={160} placeholder={part === "funder" ? "Name (optional), e.g. Gund FAQ" : "Name (optional), e.g. Call with the ED, 8 Oct"}
        aria-label="Name" onChange={e => setTitle(e.target.value)} />
      {error && <div className="ap-error" role="alert">{error}</div>}
      <div className="gc-form-acts">
        <button type="button" className="btn ghost ap-mini" onClick={() => { reset(); setOpen(false); }}>Cancel</button>
        <button type="button" className="btn inline ap-mini" disabled={!ready || busy} onClick={() => void add()}>
          {busy ? (source === "url" ? "Fetching…" : "Adding…") : "Add"}</button>
      </div>
    </div>
  );
}

function TextWindow({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ws-modal-back" role="presentation" onClick={onClose}>
      <div className="ws-modal gc-read" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <pre className="gc-text">{text}</pre>
        <div className="ws-modal-acts"><button type="button" className="btn secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
