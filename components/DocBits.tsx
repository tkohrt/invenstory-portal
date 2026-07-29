"use client";
import Drawer from "./Drawer";
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
  return (
    <Drawer onClose={onClose}>
      <span className={`ftype ${d.doc_kind}`}>{d.doc_kind.toUpperCase()}</span>
      <h3 style={{ marginTop: 10 }}>{d.title}</h3>
      <div className="kv"><div className="k">Layer</div><div><span className="layer-dot" style={{ background: meta.color }} /> Layer {d.layer} — {meta.name}</div></div>
      <div className="kv"><div className="k">Added</div><div>{new Date(d.created_at).toLocaleDateString()} by {d.uploader_name}</div></div>
      <div className="kv"><div className="k">Version</div><div>v{d.current_version}</div></div>
      <div className="kv"><div className="k">Status</div><div>{d.status}{d.error_detail ? ` — ${d.error_detail}` : ""}</div></div>
      <div className="kv"><div className="k">Tags</div><div>{d.tags.map(t => <span key={t} className="tag" style={{ marginRight: 4 }}>{t}</span>)}</div></div>
      <div className="kv"><div className="k">Preview</div><div>{d.snippet}</div></div>
      {d.doc_kind === "audio" && (
        <div className="kv"><div className="k">Audio</div><div className="empty">Player + transcript land with file ingestion (Phase 3b).</div></div>
      )}
      <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
        <button className="btn secondary">Open file</button>
        <button className="btn secondary">Edit tags</button>
      </div>
    </Drawer>
  );
}

export function UploadDrawer({ tenantName, onClose }: { tenantName: string; onClose: () => void }) {
  return (
    <Drawer onClose={onClose}>
      <h3>Upload a document</h3>
      <p style={{ color: "var(--muted)", marginTop: 2 }}>Add a file to {tenantName}&rsquo;s Inven(s)tory.</p>
      <div className="dropzone"><strong>Drop a file here</strong><br />or click to browse (PDF, Word, text, audio…)</div>
      <label>Title</label><input placeholder="e.g. Board meeting minutes — June" />
      <label>Layer <span className="req">*</span></label>
      <select defaultValue="I">
        <option value="I">Layer I — Public Story</option>
        <option value="II">Layer II — Internal Strategy</option>
        <option value="III">Layer III — Living Voice</option>
      </select>
      <label>Tags</label>
      <div className="tag-input-row"><input placeholder="Add a tag and press Enter" /><button className="btn secondary">Add</button></div>
      <button className="btn" onClick={onClose}>Save to Inven(s)tory</button>
      <div className="hint">Real uploads and ingestion arrive in Phase 3b.</div>
    </Drawer>
  );
}
