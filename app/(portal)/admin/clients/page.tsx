"use client";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { countDocsByLayer, getDocuments, getTenants } from "@/lib/data";

export default function ClientsPage() {
  const { role, switchTenant } = useSession();
  const router = useRouter();
  if (role !== "admin") return <div className="empty">Admin access required.</div>;
  return (
    <div>
      <div className="page-head"><div><h2>All clients</h2>
        <p>Pick any client to open their complete account and Inven(s)tory.</p></div></div>
      <div className="client-grid">
        {getTenants().map(t => {
          const n = countDocsByLayer(t.id);
          return (
            <div key={t.id} className="client-card" onClick={() => { switchTenant(t.id); router.push("/library"); }}>
              <h4>{t.name}</h4>
              <div className="nums"><span><b>{getDocuments(t.id).length}</b> docs</span>
                <span>L1 <b>{n.I}</b></span><span>L2 <b>{n.II}</b></span><span>L3 <b>{n.III}</b></span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
