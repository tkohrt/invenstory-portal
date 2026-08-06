"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { switchTenantAction } from "@/lib/server/actions";
import { createClientAction, type NewClientResult } from "@/lib/server/admin-actions";
import Drawer from "./Drawer";
import type { TenantSummary } from "@/lib/types";

export default function AdminClientsView({ tenants }: { tenants: TenantSummary[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const open = async (id: string) => { await switchTenantAction(id); router.push("/library"); router.refresh(); };
  return (
    <div>
      <div className="page-head">
        <div><h2>All clients</h2><p>Pick any client to open their complete account and Inven(s)tory.</p></div>
        <div className="spacer" />
        <button className="btn secondary" onClick={() => setAdding(true)}>＋ New client</button>
      </div>
      <div className="client-grid">
        {tenants.map(t => (
          <div key={t.id} className="client-card" onClick={() => open(t.id)}>
            <h4>{t.name}</h4>
            <div className="nums"><span><b>{t.doc_count}</b> docs</span>
              <span>L1 <b>{t.by_layer.I}</b></span><span>L2 <b>{t.by_layer.II}</b></span><span>L3 <b>{t.by_layer.III}</b></span></div>
          </div>
        ))}
      </div>
      {adding && <NewClientDrawer onClose={() => setAdding(false)} onCreated={() => router.refresh()} />}
    </div>
  );
}

function NewClientDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ orgName: "", orgType: "nonprofit" as "nonprofit" | "startup", contactName: "", email: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NewClientResult | null>(null);

  const submit = async () => {
    setBusy(true); setResult(null);
    const r = await createClientAction(f);
    setBusy(false); setResult(r);
    if (r.ok) onCreated();
  };

  if (result?.ok) {
    return (
      <Drawer onClose={onClose}>
        <h3>Client created ✓</h3>
        <p style={{ color: "var(--muted)", marginTop: 2 }}>{f.orgName} is ready. Share these sign-in details with the client.</p>
        <div className="kv"><div className="k">Email</div><div>{result.email}</div></div>
        <div className="kv"><div className="k">Temp password</div><div><code style={{ background: "#f1f2f4", padding: "2px 6px", borderRadius: 6 }}>{result.tempPassword}</code></div></div>
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>Ask the client to change their password after first sign-in. This is shown once.</p>
        <button className="btn" onClick={onClose}>Done</button>
      </Drawer>
    );
  }

  return (
    <Drawer onClose={onClose}>
      <h3>New client</h3>
      <p style={{ color: "var(--muted)", marginTop: 2 }}>Creates the client&rsquo;s account and login. You&rsquo;ll get a temporary password to share.</p>
      <label>Organization name <span className="req">*</span></label>
      <input value={f.orgName} onChange={e => setF({ ...f, orgName: e.target.value })} placeholder="e.g. RE-Assist" />
      <label>Organization type <span className="req">*</span></label>
      <div className="role-toggle">
        <button type="button" className={f.orgType === "nonprofit" ? "active" : ""} onClick={() => setF({ ...f, orgType: "nonprofit" })}>Nonprofit</button>
        <button type="button" className={f.orgType === "startup" ? "active" : ""} onClick={() => setF({ ...f, orgType: "startup" })}>Startup / for-profit</button>
      </div>
      <label>Primary contact name</label>
      <input value={f.contactName} onChange={e => setF({ ...f, contactName: e.target.value })} placeholder="e.g. Ashley Barrow" />
      <label>Contact email <span className="req">*</span></label>
      <input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="name@org.com" />
      <label>Website</label>
      <input value={f.website} onChange={e => setF({ ...f, website: e.target.value })} placeholder="www.org.com" />
      {result && !result.ok && <div className="metric-gap" style={{ marginTop: 10 }}><b>Problem:</b> {result.error}</div>}
      <button className="btn" onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create client & login"}</button>
    </Drawer>
  );
}
