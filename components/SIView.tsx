"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ArtifactPanel from "./ArtifactPanel";
import { setArtifactVisibilityAction } from "@/lib/server/artifact-actions";
import { DocDrawer } from "./DocBits";
import type { ArtifactBundle, DocumentWithTags } from "@/lib/types";

export default function SIView({ tenantName, bundle, docs, isAdmin }: {
  tenantName: string; bundle: ArtifactBundle; docs: DocumentWithTags[]; isAdmin: boolean;
}) {
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [busyVis, setBusyVis] = useState(false);
  const router = useRouter();
  const openDoc = docs.find(d => d.id === openDocId) ?? null;
  const visible = bundle.set.client_visible;
  const toggleVisibility = async () => { setBusyVis(true); await setArtifactVisibilityAction(bundle.type.slug, !visible); setBusyVis(false); router.refresh(); };
  return (
    <div>
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · viewing {tenantName}</div>}
      <div className="page-head">
        <div><h2>{bundle.type.nav_label}</h2>
          <p>Story Intelligence, generated from {tenantName}&rsquo;s Inven(s)tory and reviewed by For Granted before it reaches you.</p></div>
        <div className="spacer" />
        {isAdmin && (
          <button className={`vis-toggle ${visible ? "on" : "off"}`} onClick={toggleVisibility} disabled={busyVis} title="Controls whether this client sees this Story Intelligence artifact">
            {busyVis ? "…" : visible ? "● Visible to client" : "○ Hidden from client"}
          </button>
        )}
      </div>
      <ArtifactPanel bundle={bundle} isAdmin={isAdmin} onOpenDoc={setOpenDocId} />
      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} isAdmin={isAdmin} />}
    </div>
  );
}
