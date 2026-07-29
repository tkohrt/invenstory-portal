"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Drawer from "./Drawer";
import { updateDocTagsAction } from "@/lib/server/doc-actions";
import type { DocumentWithTags, Layer } from "@/lib/types";

export const LAYER_META: Record<Layer, { name: string; desc: string; color: string; cls: string }> = {
  I: { name: "Public Story", desc: "Everything the world can see", color: "var(--l1)", cls: "l1" },
  II: { name: "Internal Strategy", desc: "Behind-the-scenes operational truth", color: "var(--l2)", cls: "l2" },
  III: { name: "Living Voice", desc: "The human voice from interviews", color: "var(--l3)", cls: "l3" },
};

export function StatusChip({ status }: { status: DocumentWithTags["status"] }) {
  if (status === "ready") return null;
  return <span className={`status-chip ${status}`}>{status === "failed" ? "needs attention" : status}</span>;
}

export function DocCard({ d, onOpen }: { d: DocumentWithTags; onOpen: (id: string) => void }) {
  return (
    <div className="doc-card" onClick={() => onOpen(d.id)}>
      <span className={`ftype ${d.doc_kind}`}>{d.doc_kind.toUpperCase()}</span>
      <h4>{d.title}</h4>
      <div className="dmeta">
        <span>{new Date(d.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
        <StatusChip status={d.status} />
        <span className="provenance">{d.source === "for_granted" ? "Added by For Granted" : "Added by you"}</span>
      </div>
      <div className="tags">{d.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
    </div>
  );
}

export function DocDrawer({ d, onClose }: { d: DocumentWithTags; onClose: () => void }) {
  const meta = LAYER_META[d.layer];
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState<string[]>(d.tags);
  const [newTag, setNewTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);

  const openFile = async () => {
    setFileErr(null);
    const res = await fetch(`/api/file?documentId=${d.id}`);
    if (!res.ok) { setFileErr("Couldn't open this file."); return; }
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const addTag = () => { const t = newTag.trim(); if (t && !tags.includes(t)) setTags([...tags, t]); setNewTag(""); };
  const saveTags = async () => { setBusy(true); await updateDocTagsAction(d.id, tags); setBusy(false); setEditing(false); router.refresh(); };

  return (
    <Drawer onClose={onClose}>
      <span className={`ftype ${d.doc_kind}`}>{d.doc_kind.toUpperCase()}</span>
      <h3 style={{ marginTop: 10 }}>{d.title}</h3>
      <div className="kv"><div className="k">Layer</div><div><span className="layer-dot" style={{ background: meta.color }} /> Layer {d.layer} — {meta.name}</div></div>
      <div className="kv"><div className="k">Added</div><div>{new Date(d.created_at).toLocaleDateString()} by {d.uploader_name}</div></div>
      <div className="kv"><div className="k">Version</div><div>v{d.current_version}</div></div>
      <div className="kv"><div className="k">Status</div><div>{d.status}{d.error_detail ? ` — ${d.error_detail}` : ""}</div></div>
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
      {d.doc_kind === "audio" && (
        <div className="kv"><div className="k">Audio</div><div className="empty">Player + transcript land with file ingestion.</div></div>
      )}
      {fileErr && <div className="metric-gap" style={{ marginTop: 8 }}>{fileErr}</div>}
      <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
        <button className="btn secondary" onClick={openFile}>Open file</button>
        {!editing
          ? <button className="btn secondary" onClick={() => { setTags(d.tags); setEditing(true); }}>Edit tags</button>
          : <>
              <button className="btn inline" onClick={saveTags} disabled={busy}>{busy ? "Saving…" : "Save tags"}</button>
              <button className="btn secondary" onClick={() => setEditing(false)}>Cancel</button>
            </>}
      </div>
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
      <input type="file" accept=".pdf,.docx,.doc,.txt,.md,.html,.xlsx,.mp3,.m4a,.wav"
        onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "")); }} />
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
