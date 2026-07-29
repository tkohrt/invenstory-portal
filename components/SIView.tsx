"use client";
import { useState } from "react";
import ArtifactPanel from "./ArtifactPanel";
import { DocDrawer } from "./DocBits";
import type { ArtifactBundle, DocumentWithTags } from "@/lib/types";

export default function SIView({ tenantName, bundle, docs, isAdmin }: {
  tenantName: string; bundle: ArtifactBundle; docs: DocumentWithTags[]; isAdmin: boolean;
}) {
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const openDoc = docs.find(d => d.id === openDocId) ?? null;
  return (
    <div>
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · viewing {tenantName}</div>}
      <div className="page-head">
        <div><h2>{bundle.type.nav_label}</h2>
          <p>Story Intelligence, generated from {tenantName}&rsquo;s Inven(s)tory and reviewed by For Granted before it reaches you.</p></div>
      </div>
      <ArtifactPanel bundle={bundle} isAdmin={isAdmin} onOpenDoc={setOpenDocId} />
      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} />}
    </div>
  );
}
