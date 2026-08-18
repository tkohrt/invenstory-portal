"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveEligibilityProfileAction } from "@/lib/server/eligibility-actions";
import { runGapAnalysisAction } from "@/lib/server/gap-actions";
import { ORG_TYPES, TAX_STATUS, BUDGET_BANDS, FEDERAL_REG, MATCH_CAPACITY, US_STATES, computeCompleteness, type EligibilityProfile, type Gap } from "@/lib/eligibility-fields";

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

export default function FundingEligibilityView({ profile, orgName, adminViewing, gaps, gapsComputedAt, readiness }: {
  profile: EligibilityProfile; orgName: string; adminViewing: boolean; gaps: Gap[]; gapsComputedAt: string | null;
  readiness: { pct: number; items: { key: string; label: string; tier: "essential"|"important"|"enriching"; layer: string; present: boolean }[] };
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
  const [analyzing, setAnalyzing] = useState(false);
  const analyze = async () => { setAnalyzing(true); await runGapAnalysisAction(); setAnalyzing(false); router.refresh(); };
  const TIER = { critical: "🔴", essential: "🟠", important: "🟡", enriching: "⚪" } as const;
  const order = { critical: 0, essential: 1, important: 2, enriching: 3 } as const;
  const sortedGaps = [...gaps].sort((a, b) => order[a.tier] - order[b.tier]);

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-head"><div>
        {adminViewing && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · editing {orgName}&rsquo;s eligibility</div>}
        <h2>Funding Eligibility</h2>
        <p>Answer once. We use these facts to screen out grants you can&rsquo;t win — so you only see opportunities you&rsquo;re actually eligible for.</p>
      </div></div>

      <div className="fe-progress"><div className="fe-bar"><span style={{ width: `${completeness}%` }} /></div><b>{completeness}% complete</b></div>

      <section className="acct-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0 }}>What&rsquo;s missing</h3>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost" onClick={analyze} disabled={analyzing}>{analyzing ? "Analyzing…" : gapsComputedAt ? "Re-analyze Inven(s)tory" : "Analyze my Inven(s)tory"}</button>
        </div>
        {sortedGaps.length === 0
          ? <p className="gap-note" style={{ marginTop: 10 }}>Nothing flagged — your profile and Inven(s)tory look complete. {gapsComputedAt ? "" : "Run an analysis to check your documents."}</p>
          : <div className="gap-list">{sortedGaps.map(g => (
              <div key={g.key} className={`gap-item ${g.tier}`}>
                <span className="gap-ic">{TIER[g.tier]}</span>
                <span className="gap-text">{g.label}</span>
                <a className="gap-fix" href={g.fix === "profile" ? "#top" : "/invenstory"}>{g.fix === "profile" ? "Fill in" : "Upload"} →</a>
              </div>))}
          </div>}
        <p className="acct-note" style={{ marginTop: 8 }}>🔴 blocks matching · 🟡 important · ⚪ nice to have. Structural gaps update as you edit; document gaps update when you re-analyze.</p>
      </section>

      <section className="acct-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Inven(s)tory readiness</h3>
          <div style={{ flex: 1 }} />
          <b style={{ fontSize: 18, color: readiness.pct >= 80 ? "#3a7d44" : readiness.pct >= 50 ? "#b08a2e" : "#b06a2e" }}>{readiness.pct}%</b>
        </div>
        <div className="fe-bar" style={{ maxWidth: "none", margin: "8px 0 14px" }}><span style={{ width: `${readiness.pct}%` }} /></div>
        {(["essential","important","enriching"] as const).map(tier => {
          const rows = readiness.items.filter(i => i.tier === tier);
          if (!rows.length) return null;
          const T = { essential: "🟠 Essential", important: "🟡 Important", enriching: "⚪ Enriching" }[tier];
          return (
            <div key={tier} style={{ marginBottom: 10 }}>
              <div className="section-label">{T}</div>
              <div className="ck-grid">
                {rows.map(i => (
                  <div key={i.key} className={`ck-item ${i.present ? "on" : ""}`} title={`Layer ${i.layer}`}>
                    <span className="ck-mark">{i.present ? "✓" : "○"}</span> {i.label}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <p className="acct-note">A robust Inven(s)tory is what turns grant-writing from invention into assembly. Document coverage updates when you re-analyze.</p>
      </section>

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
