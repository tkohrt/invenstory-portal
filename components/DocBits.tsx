"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Drawer from "./Drawer";
import { updateDocTagsAction, renameDocAction, reprocessDocAction, deleteDocAction } from "@/lib/server/doc-actions";
import type { DocumentWithTags, Layer } from "@/lib/types";
import { ACCEPT_ATTR, ACCEPTED_LABEL, SUPPORT_EMAIL, isAccepted } from "@/lib/uploads";

export const LAYER_META: Record<Layer, { name: string; desc: string; color: string; cls: string }> = {
  I: { name: "Public Story", desc: "Everything the world can see", color: "var(--l1)", cls: "l1" },
  II: { name: "Internal Strategy", desc: "Behind-the-scenes operational truth", color: "var(--l2)", cls: "l2" },
  III: { name: "Living Voice", desc: "The human voice from interviews", color: "var(--l3)", cls: "l3" },
};

export function StatusChip({ status }: { status: DocumentWithTags["status"] }) {
  if (status === "ready") return null;
  return <span className={`status-chip ${status}`}>{status === "failed" ? "needs attention" : status}</span>;
}

export function DocCard({ d, onOpen, isAdmin }: { d: DocumentWithTags; onOpen: (id: string) => void; isAdmin?: boolean }) {
  return (
    <div className="doc-card" onClick={() => onOpen(d.id)}>
      <span className={`ftype ${d.doc_kind}`}>{d.doc_kind.toUpperCase()}</span>
      <h4>{d.title}</h4>
      <div className="dmeta">
        <span>{new Date(d.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
        {isAdmin && <StatusChip status={d.status} />}
        <span className="provenance">{d.source === "for_granted" ? "Added by For Granted" : "Added by you"}</span>
        {isAdmin && <button className="doc-dl" title="Download original" aria-label="Download original"
          onClick={async (e) => { e.stopPropagation();
            const res = await fetch(`/api/file?documentId=${d.id}`);
            if (res.ok) { const { url } = await res.json(); window.open(url, "_blank", "noopener,noreferrer"); }
          }}>⬇</button>}
      </div>
      <div className="tags">{d.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
    </div>
  );
}

export function DocDrawer({ d, onClose, isAdmin }: { d: DocumentWithTags; onClose: () => void; isAdmin?: boolean }) {
  const meta = LAYER_META[d.layer];
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState<string[]>(d.tags);
  const [newTag, setNewTag] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(d.title);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [fullText, setFullText] = useState<{ title: string; text: string } | null>(null);
  const [loadingText, setLoadingText] = useState(false);

  const openFile = async () => {
    setMsg(null);
    const res = await fetch(`/api/file?documentId=${d.id}`);
    if (!res.ok) { setMsg("Couldn't open this file."); return; }
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const openViewer = async () => {
    setViewing(true);
    if (!fullText) {
      setLoadingText(true);
      const res = await fetch(`/api/document/text?documentId=${d.id}`);
      if (res.ok) setFullText(await res.json());
      setLoadingText(false);
    }
  };
  const addTag = () => { const t = newTag.trim(); if (t && !tags.includes(t)) setTags([...tags, t]); setNewTag(""); };
  const saveTags = async () => { setBusy("tags"); await updateDocTagsAction(d.id, tags); setBusy(null); setEditing(false); router.refresh(); };
  const saveTitle = async () => { setBusy("title"); await renameDocAction(d.id, title); setBusy(null); setRenaming(false); router.refresh(); };
  const reprocess = async () => {
    setBusy("reprocess"); setMsg(null);
    try { await reprocessDocAction(d.id); setMsg("Reprocessed — refreshing."); router.refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Reprocess failed"); }
    setBusy(null);
  };
  const del = async () => { setBusy("delete"); await deleteDocAction(d.id); setBusy(null); onClose(); router.refresh(); };

  const failed = d.status === "failed";

  return (
    <Drawer onClose={onClose}>
      <span className={`ftype ${d.doc_kind}`}>{d.doc_kind.toUpperCase()}</span>
      {!renaming
        ? <h3 style={{ marginTop: 10 }}>{d.title}</h3>
        : <div style={{ marginTop: 10 }}>
            <input value={title} onChange={e => setTitle(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn inline" onClick={saveTitle} disabled={busy === "title"}>{busy === "title" ? "Saving…" : "Save name"}</button>
              <button className="btn secondary" onClick={() => { setTitle(d.title); setRenaming(false); }}>Cancel</button>
            </div>
          </div>}
      <div className="kv"><div className="k">Layer</div><div><span className="layer-dot" style={{ background: meta.color }} /> Layer {d.layer} — {meta.name}</div></div>
      <div className="kv"><div className="k">Added</div><div>{new Date(d.created_at).toLocaleDateString()} by {d.uploader_name}</div></div>
      {isAdmin && <div className="kv"><div className="k">Status</div><div>{d.status}{d.error_detail ? ` — ${d.error_detail}` : ""}</div></div>}
      {failed && isAdmin && (
        <div className="metric-gap" style={{ marginTop: 6 }}>
          This document couldn&rsquo;t be read. If the issue has been fixed, reprocess it.
          <div style={{ marginTop: 8 }}><button className="btn inline" onClick={reprocess} disabled={busy === "reprocess"}>{busy === "reprocess" ? "Reprocessing…" : "↻ Reprocess"}</button></div>
        </div>
      )}
      <div className="kv"><div className="k">Tags</div><div>
        {!editing
          ? (tags.length ? tags.map(t => <span key={t} className="tag" style={{ marginRight: 4 }}>{t}</span>) : <span style={{ color: "var(--muted)" }}>none</span>)
          : <div>
              <div className="tagedit">{tags.map((t, i) => <span key={t} className="tag" onClick={() => setTags(tags.filter((_, j) => j !== i))}>{t}</span>)}</div>
              <div className="tag-input-row" style={{ marginTop: 8 }}>
                <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Add a tag, Enter"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
                <button className="btn secondary" onClick={addTag}>Add</button>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>Click a tag to remove it.</p>
            </div>}
      </div></div>
      <div className="kv"><div className="k">Preview</div><div>{d.snippet}</div></div>
      {msg && <div className="metric-gap" style={{ marginTop: 8 }}>{msg}</div>}
      <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={openViewer}>View full text</button>
        <button className="btn secondary" onClick={openFile}>Download original</button>
        {!editing
          ? <button className="btn secondary" onClick={() => { setTags(d.tags); setEditing(true); }}>Edit tags</button>
          : <>
              <button className="btn inline" onClick={saveTags} disabled={busy === "tags"}>{busy === "tags" ? "Saving…" : "Save tags"}</button>
              <button className="btn secondary" onClick={() => setEditing(false)}>Cancel</button>
            </>}
        {!renaming && <button className="btn secondary" onClick={() => { setTitle(d.title); setRenaming(true); }}>Rename</button>}
      </div>
      <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        {!confirmDel
          ? <button className="btn secondary" style={{ color: "#c0492f", borderColor: "#e7c3ba" }} onClick={() => setConfirmDel(true)}>Delete document</button>
          : <div className="metric-gap">
              Permanently delete &ldquo;{d.title}&rdquo; and all its extracted text? This can&rsquo;t be undone.
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn inline" style={{ background: "#c0492f" }} onClick={del} disabled={busy === "delete"}>{busy === "delete" ? "Deleting…" : "Delete permanently"}</button>
                <button className="btn secondary" onClick={() => setConfirmDel(false)}>Keep it</button>
              </div>
            </div>}
      </div>
      {viewing && (
        <div className="doc-viewer-overlay" onClick={() => setViewing(false)}>
          <div className="doc-viewer" onClick={e => e.stopPropagation()}>
            <div className="dv-head">
              <div><span className={`ftype ${d.doc_kind}`}>{d.doc_kind.toUpperCase()}</span> <strong style={{ marginLeft: 8 }}>{d.title}</strong></div>
              <button className="btn ghost" onClick={() => setViewing(false)}>✕ Close</button>
            </div>
            <div className="dv-body">
              {loadingText
                ? <p className="empty">Loading full text…</p>
                : fullText?.text
                  ? <pre className="dv-text">{fullText.text}</pre>
                  : <p className="empty">No extractable text for this document (it may be audio or a spreadsheet, or still processing).</p>}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function UploadDrawer({ tenantName, onClose, onDone }: {
  tenantName: string; onClose: () => void; onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [layer, setLayer] = useState("I");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file) { setError("Choose a file first."); return; }
    if (!isAccepted(file.name)) { setError(`That file type isn\u2019t supported yet. Accepted: ${ACCEPTED_LABEL}. Other types can be emailed to ${SUPPORT_EMAIL}.`); return; }
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("file", file); fd.set("title", title); fd.set("layer", layer); fd.set("tags", tags);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error ?? `Upload failed (${res.status})`); return; }
    onDone(); onClose();
  };

  return (
    <Drawer onClose={onClose}>
      <h3>Upload a document</h3>
      <p style={{ color: "var(--muted)", marginTop: 2 }}>Add a file to {tenantName}&rsquo;s Inven(s)tory.</p>
      <label>File <span className="req">*</span></label>
      <input type="file" accept={ACCEPT_ATTR}
        onChange={e => {
          const f = e.target.files?.[0] ?? null;
          if (f && !isAccepted(f.name)) {
            setError(`That file type isn\u2019t supported yet. Accepted: ${ACCEPTED_LABEL}. Other types can be emailed to ${SUPPORT_EMAIL}.`);
            setFile(null); e.target.value = ""; return;
          }
          setError(null); setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
        }} />
      <div className="hint" style={{ marginTop: 4 }}>
        Accepted: {ACCEPTED_LABEL}. Have an image, slide deck, or another file type? Email it to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&rsquo;ll add it for you.
      </div>
      <label>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Board meeting minutes — June" />
      <label>Layer <span className="req">*</span></label>
      <select value={layer} onChange={e => setLayer(e.target.value)}>
        <option value="I">Layer I — Public Story</option>
        <option value="II">Layer II — Internal Strategy</option>
        <option value="III">Layer III — Living Voice</option>
      </select>
      <label>Tags (comma-separated)</label>
      <input value={tags} onChange={e => setTags(e.target.value)} placeholder="budget, transportation" />
      {error && <div className="metric-gap" style={{ marginTop: 10 }}><b>Problem:</b> {error}</div>}
      <button className="btn" onClick={submit} disabled={busy}>
        {busy ? "Uploading and reading the document…" : "Save to Inven(s)tory"}</button>
      <div className="hint">Text is extracted, chunked, and embedded on upload — the document becomes searchable in seconds.</div>
    </Drawer>
  );
}
