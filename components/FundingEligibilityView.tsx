"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveEligibilityProfileAction } from "@/lib/server/eligibility-actions";
import { ORG_TYPES, TAX_STATUS, BUDGET_BANDS, FEDERAL_REG, MATCH_CAPACITY, US_STATES, computeCompleteness, type EligibilityProfile } from "@/lib/eligibility-fields";

function TagField({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (v && !values.includes(v)) onChange([...values, v]); setDraft(""); };
  return (
    <div className="fe-field">
      <label>{label}</label>
      <div className="tag-input-row">
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} />
        <button type="button" className="btn inline" onClick={add}>Add</button>
      </div>
      {values.length > 0 && <div className="fe-tags">{values.map(v => (
        <span key={v} className="fe-tag">{v}<button type="button" onClick={() => onChange(values.filter(x => x !== v))}>×</button></span>
      ))}</div>}
    </div>
  );
}

export default function FundingEligibilityView({ profile, orgName, adminViewing }: {
  profile: EligibilityProfile; orgName: string; adminViewing: boolean;
}) {
  const router = useRouter();
  const [p, setP] = useState<EligibilityProfile>(profile);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<EligibilityProfile>) => setP({ ...p, ...patch });
  const completeness = computeCompleteness(p);
  const toggleState = (st: string) => set({ service_area: p.service_area.includes(st) ? p.service_area.filter(x => x !== st) : [...p.service_area, st] });

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await saveEligibilityProfileAction(p);
    setBusy(false); setMsg(`Saved — ${r.completeness}% complete.`);
    router.refresh();
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-head"><div>
        {adminViewing && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · editing {orgName}&rsquo;s eligibility</div>}
        <h2>Funding Eligibility</h2>
        <p>Answer once. We use these facts to screen out grants you can&rsquo;t win — so you only see opportunities you&rsquo;re actually eligible for.</p>
      </div></div>

      <div className="fe-progress"><div className="fe-bar"><span style={{ width: `${completeness}%` }} /></div><b>{completeness}% complete</b></div>

      <section className="acct-card">
        <h3>Identity</h3>
        <div className="fe-field"><label>Applicant type</label>
          <div className="fe-choice">{[["organization","Organization"],["individual","Individual"]].map(([v,l]) => (
            <button key={v} type="button" className={`chip ${p.applicant_type === v ? "active" : ""}`} onClick={() => set({ applicant_type: v })}>{l}</button>))}
          </div>
        </div>
        <div className="fe-field"><label>Organization type</label>
          <select value={p.org_type ?? ""} onChange={e => set({ org_type: e.target.value || null })}>
            <option value="">Select…</option>{ORG_TYPES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
      </section>

      <section className="acct-card">
        <h3>Tax status</h3>
        <div className="fe-field"><label>Tax-exempt status</label>
          <select value={p.tax_status ?? ""} onChange={e => set({ tax_status: e.target.value || null })}>
            <option value="">Select…</option>{TAX_STATUS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
        <div className="fe-row">
          <div className="fe-field"><label>EIN (optional)</label><input value={p.ein ?? ""} onChange={e => set({ ein: e.target.value })} placeholder="12-3456789" /></div>
          <div className="fe-field"><label>Fiscal sponsor (if any)</label><input value={p.fiscal_sponsor ?? ""} onChange={e => set({ fiscal_sponsor: e.target.value })} /></div>
        </div>
      </section>

      <section className="acct-card">
        <h3>Location &amp; reach</h3>
        <div className="fe-row">
          <div className="fe-field"><label>Primary state</label>
            <select value={p.state_code ?? ""} onChange={e => set({ state_code: e.target.value || null })}>
              <option value="">Select…</option>{US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fe-field"><label>County (optional)</label><input value={p.county ?? ""} onChange={e => set({ county: e.target.value })} /></div>
        </div>
        <div className="fe-field"><label>States you serve</label>
          <div className="fe-states">{US_STATES.map(s => (
            <button key={s} type="button" className={`fe-state ${p.service_area.includes(s) ? "on" : ""}`} onClick={() => toggleState(s)}>{s}</button>))}
          </div>
        </div>
      </section>

      <section className="acct-card">
        <h3>Profile</h3>
        <div className="fe-field"><label>Annual operating budget</label>
          <select value={p.budget_band ?? ""} onChange={e => set({ budget_band: e.target.value || null })}>
            <option value="">Select…</option>{BUDGET_BANDS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
        <TagField label="Populations you serve" values={p.populations} onChange={v => set({ populations: v })} placeholder="e.g. youth, veterans, rural" />
        <TagField label="Cause areas" values={p.cause_areas} onChange={v => set({ cause_areas: v })} placeholder="e.g. education, workforce, health" />
      </section>

      <section className="acct-card">
        <h3>Compliance</h3>
        <div className="fe-field"><label>Federal registration</label>
          <select value={p.federal_registration} onChange={e => set({ federal_registration: e.target.value })}>
            {FEDERAL_REG.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
        <div className="fe-field"><label>Matching / cost-share capacity</label>
          <select value={p.match_capacity_pct ?? ""} onChange={e => set({ match_capacity_pct: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Select…</option>{MATCH_CAPACITY.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
      </section>

      <div className="fe-save">
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save eligibility profile"}</button>
        {msg && <span className="gap-note">{msg}</span>}
      </div>
      <p className="acct-note" style={{ marginTop: 14 }}>Grant matching against these facts arrives with the funder database. Everything surfaced will be a lead to verify at the funder&rsquo;s site — a June 2026 snapshot, not a guarantee.</p>
    </div>
  );
}
