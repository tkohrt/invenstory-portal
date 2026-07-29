"use client";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { getArtifactSet, getArtifactTypes, getDocument, getDocuments, getTenant } from "@/lib/data";
import { DocCard, DocDrawer, UploadDrawer, LAYER_META } from "@/components/DocBits";
import ArtifactPanel from "@/components/ArtifactPanel";
import type { Layer } from "@/lib/types";

export default function LibraryPage() {
  const { role, tenantId } = useSession();
  const [filter, setFilter] = useState<Layer | "all">("all");
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  if (!tenantId) return null;

  const tenant = getTenant(tenantId)!;
  const docs = getDocuments(tenantId);
  const layers: Layer[] = filter === "all" ? ["I", "II", "III"] : [filter];
  const openDoc = openDocId ? getDocument(tenantId, openDocId) : null;
  const admin = role === "admin";

  return (
    <div>
      {admin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · viewing {tenant.name}</div>}
      <div className="page-head">
        <div><h2>{tenant.name}</h2><p>The complete Inven(s)tory — {docs.length} documents across three layers.</p></div>
        <div className="spacer" />
        <button className="btn secondary" onClick={() => setUploading(true)}>＋ Upload</button>
      </div>

      {getArtifactTypes().map(t => {
        const set = getArtifactSet(tenantId, t.slug);
        return set ? <ArtifactPanel key={t.slug} type={t} set={set} isAdmin={admin} onOpenDoc={setOpenDocId} /> : null;
      })}

      <div className="filters">
        <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All layers</button>
        {(["I", "II", "III"] as Layer[]).map(L => (
          <button key={L} className={`chip ${LAYER_META[L].cls} ${filter === L ? "active" : ""}`} onClick={() => setFilter(L)}>Layer {L}</button>
        ))}
      </div>

      {layers.map(L => {
        const layerDocs = docs.filter(d => d.layer === L);
        const meta = LAYER_META[L];
        return (
          <div key={L} className={`layer-block layer-canvas ${meta.cls}`}>
            <div className="layer-head">
              <span className="layer-badge">LAYER {L}</span>
              <h3>{meta.name}</h3>
              <span className="desc">&ldquo;{meta.desc}&rdquo;</span>
              <span className="count">· {layerDocs.length} {layerDocs.length === 1 ? "document" : "documents"}</span>
            </div>
            {layerDocs.length
              ? <div className="grid">{layerDocs.map(d => <DocCard key={d.id} d={d} onOpen={setOpenDocId} />)}</div>
              : <div className="empty">No documents in this layer yet — this is where your story grows next.</div>}
          </div>
        );
      })}

      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} />}
      {uploading && <UploadDrawer tenantName={tenant.name} onClose={() => setUploading(false)} />}
    </div>
  );
}
