"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DocCard, DocDrawer, UploadDrawer, LAYER_META } from "./DocBits";
import type { DocumentWithTags, Layer } from "@/lib/types";

function normalizeUrl(u: string) { return /^https?:\/\//i.test(u) ? u : `https://${u}`; }

export default function LibraryView({ tenantName, orgType, website, contactName, docs, isAdmin }: {
  tenantName: string; orgType: "nonprofit" | "startup" | null; website: string | null;
  contactName: string | null; docs: DocumentWithTags[]; isAdmin: boolean;
}) {
  const contactLabel = orgType === "startup" ? "Founder" : "Executive Director";
  const [filter, setFilter] = useState<Layer | "all">("all");
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const layers: Layer[] = filter === "all" ? ["I", "II", "III"] : [filter];
  const openDoc = docs.find(d => d.id === openDocId) ?? null;

  return (
    <div>
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · viewing {tenantName}</div>}
      <div className="page-head">
        <div>
          <h2>{tenantName}</h2>
          <p>The complete Inven(s)tory — {docs.length} documents across three layers.</p>
          {(contactName || website) && (
            <p className="profile-line">
              {contactName && <span>{contactLabel}: {contactName}</span>}
              {contactName && website && <span className="sep"> | </span>}
              {website && <span>Website: <a href={normalizeUrl(website)} target="_blank" rel="noopener noreferrer">{website}</a></span>}
            </p>
          )}
        </div>
        <div className="spacer" />
        <button className="btn secondary" onClick={() => setUploading(true)}>＋ Upload</button>
      </div>
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
      {uploading && <UploadDrawer tenantName={tenantName} onClose={() => setUploading(false)} onDone={() => router.refresh()} />}
    </div>
  );
}
