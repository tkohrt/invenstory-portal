"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DocCard, DocDrawer, UploadDrawer, LAYER_META } from "./DocBits";
import { updateClientProfileAction } from "@/lib/server/admin-actions";
import { changeDocLayerAction } from "@/lib/server/doc-actions";
import GardenHeader from "./GardenHeader";
import ReadinessCard from "./ReadinessCard";
import type { ReadinessItem } from "@/lib/checklist";
import type { GardenState } from "@/lib/types";
import type { DocumentWithTags, Layer } from "@/lib/types";

function normalizeUrl(u: string) { return /^https?:\/\//i.test(u) ? u : `https://${u}`; }

export default function InvenstoryView({ tenantId, tenantName, orgType, website, contactName, docs, garden, readiness, readinessComputedAt, isAdmin }: {
  tenantId: string; tenantName: string; orgType: "nonprofit" | "startup" | null; website: string | null;
  contactName: string | null; docs: DocumentWithTags[]; garden: GardenState; readiness?: { pct: number; items: ReadinessItem[] }; readinessComputedAt?: string | null; isAdmin: boolean;
}) {
  const contactLabel = (t: string | null) => (t === "startup" ? "Founder" : "Executive Director");
  const [editingProfile, setEditingProfile] = useState(false);
  const [pf, setPf] = useState({ website: website ?? "", contactName: contactName ?? "", orgType: (orgType ?? "nonprofit") as "nonprofit" | "startup" });
  const [savingPf, setSavingPf] = useState(false);
  const saveProfile = async () => { setSavingPf(true); await updateClientProfileAction({ tenantId, ...pf }); setSavingPf(false); setEditingProfile(false); router.refresh(); };
  const [filter, setFilter] = useState<Layer | "all">("all");
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadLayer, setUploadLayer] = useState<"I"|"II"|"III"|null>(null);
  const [dragOverLayer, setDragOverLayer] = useState<Layer | null>(null);
  const router = useRouter();
  const layers: Layer[] = filter === "all" ? ["I", "II", "III"] : [filter];
  const openDoc = docs.find(d => d.id === openDocId) ?? null;

  return (
    <div style={{ position: "relative" }}>
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · viewing {tenantName}</div>}
      <div className="page-head">
        <div>
          <h2>{tenantName}</h2>
          <p>The complete Inven(s)tory — {docs.length} documents across three layers.</p>
          {!editingProfile && (
            <p className="profile-line">
              {contactName && <span>{contactLabel(orgType)}: {contactName}</span>}
              {contactName && website && <span className="sep"> | </span>}
              {website && <span>Website: <a href={normalizeUrl(website)} target="_blank" rel="noopener noreferrer">{website}</a></span>}
              {!contactName && !website && isAdmin && <span style={{ fontStyle: "italic" }}>No contact or website set</span>}
              {isAdmin && <button className="btn ghost" style={{ fontSize: 12, padding: "0 6px" }} onClick={() => setEditingProfile(true)}>Edit</button>}
            </p>
          )}
          {editingProfile && isAdmin && (
            <div className="profile-edit">
              <div className="pe-row">
                <div className="role-toggle" style={{ margin: 0 }}>
                  <button type="button" className={pf.orgType === "nonprofit" ? "active" : ""} onClick={() => setPf({ ...pf, orgType: "nonprofit" })}>Nonprofit</button>
                  <button type="button" className={pf.orgType === "startup" ? "active" : ""} onClick={() => setPf({ ...pf, orgType: "startup" })}>Startup</button>
                </div>
              </div>
              <div className="pe-row">
                <input value={pf.contactName} onChange={e => setPf({ ...pf, contactName: e.target.value })} placeholder={`${contactLabel(pf.orgType)} name`} />
                <input value={pf.website} onChange={e => setPf({ ...pf, website: e.target.value })} placeholder="Website" />
              </div>
              <div className="pe-row">
                <button className="btn inline" onClick={saveProfile} disabled={savingPf}>{savingPf ? "Saving…" : "Save"}</button>
                <button className="btn secondary" onClick={() => { setPf({ website: website ?? "", contactName: contactName ?? "", orgType: (orgType ?? "nonprofit") }); setEditingProfile(false); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
        <div className="spacer" />
      </div>
      <GardenHeader garden={garden} onPrompt={(layer) => { setUploadLayer(layer); setUploading(true); }} rightSlot={readiness ? <ReadinessCard readiness={readiness} computedAt={readinessComputedAt ?? null} onUpload={(layer) => { setUploadLayer(layer); setUploading(true); }} onOpenDoc={setOpenDocId} /> : undefined} />
      <div className="layers-zone">
      <div className="filters">
        <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All layers</button>
        {(["I", "II", "III"] as Layer[]).map(L => (
          <button key={L} className={`chip ${LAYER_META[L].cls} ${filter === L ? "active" : ""}`} onClick={() => setFilter(L)}>Layer {L}</button>
        ))}
        <div className="spacer" />
        {isAdmin && <a className="btn ghost" href="/api/export" title="Download all originals as a .zip">⬇ Download all (.zip)</a>}
        <button className="btn secondary" onClick={() => setUploading(true)}>＋ Upload</button>
      </div>
      {layers.map(L => {
        const layerDocs = docs.filter(d => d.layer === L);
        const meta = LAYER_META[L];
        return (
          <div key={L} className={`layer-block layer-canvas ${meta.cls}${dragOverLayer === L ? " drag-over" : ""}`}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOverLayer !== L) setDragOverLayer(L); }}
            onDragLeave={e => { if (e.currentTarget === e.target) setDragOverLayer(null); }}
            onDrop={async e => {
              e.preventDefault(); setDragOverLayer(null);
              const id = e.dataTransfer.getData("text/doc-id");
              const doc = docs.find(x => x.id === id);
              if (id && doc && doc.layer !== L) { await changeDocLayerAction(id, L); router.refresh(); }
            }}>
            <div className="layer-head">
              <span className="layer-badge">LAYER {L}</span>
              <h3>{meta.name}</h3>
              <span className="desc">&ldquo;{meta.desc}&rdquo;</span>
              <span className="count">· {layerDocs.length} {layerDocs.length === 1 ? "document" : "documents"}</span>
            </div>
            {layerDocs.length
              ? <div className="grid">{layerDocs.map(d => <DocCard key={d.id} d={d} onOpen={setOpenDocId} isAdmin={isAdmin} />)}</div>
              : <div className="empty">No documents in this layer yet — this is where your story grows next.</div>}
          </div>
        );
      })}
      </div>
      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} isAdmin={isAdmin} />}
      {uploading && <UploadDrawer tenantName={tenantName} initialLayer={uploadLayer ?? undefined} onClose={() => { setUploading(false); setUploadLayer(null); }} onDone={() => router.refresh()} />}
    </div>
  );
}
