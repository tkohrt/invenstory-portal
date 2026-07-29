"use client";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { getPendingReviews } from "@/lib/data";

export default function ReviewsPage() {
  const { role, switchTenant } = useSession();
  const router = useRouter();
  if (role !== "admin") return <div className="empty">Admin access required.</div>;
  const pending = getPendingReviews();
  return (
    <div>
      <div className="page-head"><div><h2>Story Intelligence reviews</h2>
        <p>Story Intelligence drafts across all clients, waiting for For Granted approval before they reach a client.</p></div></div>
      {pending.length === 0 && <div className="empty">No drafts awaiting review.</div>}
      <div className="client-grid">
        {pending.map(({ set, tenant, type, cards }) => (
          <div key={set.id} className="client-card" onClick={() => { switchTenant(tenant.id); router.push("/library"); }}>
            <h4>{tenant.name}</h4>
            <div className="nums"><span><b>{type.name}</b></span></div>
            <div className="nums" style={{ marginTop: 6 }}><span><b>{cards.length}</b> draft cards</span>
              <span>generated {set.generated_at ? new Date(set.generated_at).toLocaleDateString() : "—"}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
