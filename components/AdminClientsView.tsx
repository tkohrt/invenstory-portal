"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { switchTenantAction } from "@/lib/server/actions";
import { createClientAction, type NewClientResult } from "@/lib/server/admin-actions";
import Drawer from "./Drawer";
import type { PortfolioStats } from "@/lib/types";
import PlantVisual from "./PlantVisual";
import type { GardenSummary } from "@/lib/server/garden";

const money = (cents: number) => "$" + Math.round(cents / 100).toLocaleString();
const num = (n: number) => n.toLocaleString();

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`stat-card${accent ? " accent" : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function AdminClientsView({ portfolio: p, gardens }: { portfolio: PortfolioStats; gardens: Record<string, GardenSummary> }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const cut = (r: number) => money(Math.round(r * 0.10)) + "–" + money(Math.round(r * 0.15));
  const open = async (id: string) => { await switchTenantAction(id); router.push("/dashboard"); router.refresh(); };

  return (
    <div>
      <div className="page-head">
        <div><h2>All clients</h2><p>Portfolio across every For Granted client. Select a client to open their account.</p></div>
        <div className="spacer" />
        <button className="btn secondary" onClick={() => setAdding(true)}>＋ New client</button>
      </div>

      <div className="stat-grid">
        <Stat label="Grant revenue won" value={money(p.revenueWonCents)} sub={`For Granted share (10–15%): ${cut(p.revenueWonCents)}`} accent />
        <Stat label="Clients" value={num(p.tenants)} />
        <Stat label="Grants won" value={num(p.won)} />
        <Stat label="Applications submitted" value={num(p.applied)} />
        <Stat label="Documents" value={num(p.totalDocs)} />
        <Stat label="Words captured" value={num(p.totalWords)} />
      </div>

      <div className="section-label" style={{ marginTop: 22 }}>By client</div>
      <div className="portfolio-table">
        <div className="pt-row pt-head"><div>Client</div><div>Docs</div><div>Grants won</div><div>Revenue won</div></div>
        {p.perClient.map(c => (
          <div key={c.id} className="pt-row pt-click gh-row" onClick={() => open(c.id)} title={`Open ${c.name}`}>
            <div className="gh-client">
              {gardens[c.id] && <span className={`gh-plant ${gardens[c.id].health}`}><PlantVisual g={{ ...gardens[c.id], bloom: "none" }} width={44} /></span>}
              {c.name}
            </div>
            <div>{num(c.docs)}</div><div>{num(c.won)}</div><div>{money(c.revenueWonCents)}</div>
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
