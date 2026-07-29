"use client";
// One page renders EVERY Story Intelligence artifact type — driven entirely
// by the artifact_type registry. Registering a new type adds a sidebar
// entry and a page with zero code here.
import { use, useState } from "react";
import { useSession } from "@/lib/session";
import { getArtifactSet, getArtifactTypes, getDocument, getTenant } from "@/lib/data";
import ArtifactPanel from "@/components/ArtifactPanel";
import { DocDrawer } from "@/components/DocBits";

export default function StoryIntelligencePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { role, tenantId } = useSession();
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  if (!tenantId) return null;

  const type = getArtifactTypes().find(t => t.slug === slug);
  const set = type ? getArtifactSet(tenantId, type.slug) : undefined;
  if (!type || !set) return <div className="empty">This Story Intelligence page doesn&rsquo;t exist.</div>;

  const tenant = getTenant(tenantId)!;
  const openDoc = openDocId ? getDocument(tenantId, openDocId) : null;

  return (
    <div>
      {role === "admin" && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · viewing {tenant.name}</div>}
      <div className="page-head">
        <div><h2>{type.nav_label}</h2>
          <p>Story Intelligence, generated from {tenant.name}&rsquo;s Inven(s)tory and reviewed by For Granted before it reaches you.</p></div>
      </div>
      <ArtifactPanel type={type} set={set} isAdmin={role === "admin"} onOpenDoc={setOpenDocId} />
      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} />}
    </div>
  );
}
