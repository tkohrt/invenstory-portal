"use client";
import { useRouter } from "next/navigation";
import { switchTenantAction } from "@/lib/server/actions";
import type { PendingReview } from "@/lib/server/data";

export default function AdminReviewsView({ pending }: { pending: PendingReview[] }) {
  const router = useRouter();
  const open = async (tenantId: string, slug: string) => {
    await switchTenantAction(tenantId);
    router.push(`/story-intelligence/${slug}`); router.refresh();
  };
  return (
    <div>
      <div className="page-head"><div><h2>Story Intelligence reviews</h2>
        <p>Story Intelligence drafts across all clients, waiting for For Granted approval before they reach a client.</p></div></div>
      {pending.length === 0 && <div className="empty">No drafts awaiting review.</div>}
      <div className="client-grid">
        {pending.map(p => (
          <div key={p.set.id} className="client-card" onClick={() => open(p.tenant.id, p.type.slug)}>
            <h4>{p.tenant.name}</h4>
            <div className="nums"><span><b>{p.type.name}</b></span></div>
            <div className="nums" style={{ marginTop: 6 }}>
              <span>generated {p.set.generated_at ? new Date(p.set.generated_at).toLocaleDateString() : "—"}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
