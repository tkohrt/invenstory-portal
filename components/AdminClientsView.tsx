"use client";
import { useRouter } from "next/navigation";
import { switchTenantAction } from "@/lib/server/actions";
import type { TenantSummary } from "@/lib/types";

export default function AdminClientsView({ tenants }: { tenants: TenantSummary[] }) {
  const router = useRouter();
  const open = async (id: string) => { await switchTenantAction(id); router.push("/library"); router.refresh(); };
  return (
    <div>
      <div className="page-head"><div><h2>All clients</h2>
        <p>Pick any client to open their complete account and Inven(s)tory.</p></div></div>
      <div className="client-grid">
        {tenants.map(t => (
          <div key={t.id} className="client-card" onClick={() => open(t.id)}>
            <h4>{t.name}</h4>
            <div className="nums"><span><b>{t.doc_count}</b> docs</span>
              <span>L1 <b>{t.by_layer.I}</b></span><span>L2 <b>{t.by_layer.II}</b></span><span>L3 <b>{t.by_layer.III}</b></span></div>
          </div>
        ))}
      </div>
    </div>
  );
}
