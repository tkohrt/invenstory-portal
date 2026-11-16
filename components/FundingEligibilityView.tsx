"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveEligibilityProfileAction } from "@/lib/server/eligibility-actions";
import { runGapAnalysisAction } from "@/lib/server/gap-actions";
import { addInvenstoryNoteAction } from "@/lib/server/note-actions";
import { sourcesForKind } from "@/lib/sources";
import { ORG_TYPES, TAX_STATUS, BUDGET_BANDS, FEDERAL_REG, MATCH_CAPACITY, US_STATES, FUNDING_KINDS, computeCompleteness, splitGaps, analysisAgeDays, ANALYSIS_STALE_DAYS, homeCountry, wantsInternational, kindsSought, type EligibilityProfile, type Gap } from "@/lib/eligibility-fields";
import { COUNTRY_OPTIONS, COUNTRY_NAME, REGIONS } from "@/lib/countries";
import Busy from "./Busy";
import PeerOrgsField from "./PeerOrgsField";
import FoundInDocuments from "./FoundInDocuments";
import { applySuggestion, type OpenSuggestion } from "@/lib/analysis-client";
import type { EligField } from "@/lib/analysis-derive";
import { savePeerOrgsAction } from "@/lib/server/peer-actions";
import { cleanPeerOrgs, peersChanged, PEER_ASK } from "@/lib/peers";
import AllowanceRequest from "./AllowanceRequest";
import GovReadinessSection from "./GovReadinessSection";
import GovInterestCard from "./GovInterestCard";
import type { GovAnswers } from "@/lib/gov-readiness";

export function TagField({ label, values, onChange, placeholder, hint }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; hint?: string }) {
  const [draft, setDraft] = useState("");
  // "storytelling, education, youth" is three tags, not one (9 Nov 2026, from
  // the 7 Nov walkthrough, where four comma-separated cause areas were saved
  // as one amalgamated tag). Split on commas and semicolons, trim, drop
  // duplicates; typing one at a time still works exactly as before. Blur also
  // commits, so clicking Save without pressing Enter loses nothing.
  const add = () => {
    const parts = draft.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length) {
      const next = [...values];
      for (const p of parts) if (!next.includes(p)) next.push(p);
      if (next.length !== values.length) onChange(next);
    }
    setDraft("");
  };
  return (
    <div className="fe-field">
      <label>{label}</label>
      <div className="tag-input-row">
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={() => { if (draft.trim()) add(); }} placeholder={placeholder} />
        <button type="button" className="btn inline" onClick={add}>Add</button>
      </div>
      {hint && <div className="hint">{hint}</div>}
      {values.length > 0 && <div className="fe-tags">{values.map(v => (
        <span key={v} className="fe-tag">{v}<button type="button" onClick={() => onChange(values.filter(x => x !== v))}>×</button></span>
      ))}</div>}
    </div>
  );
}

/**
 * Countries as removable chips, added by typing a name (international
 * eligibility, 1 Nov 2026). A datalist rather than 250 buttons: the list is
 * long and people know the name they want.
 */
export function CountryField({ label, values, onChange, exclude }: { label: string; values: string[]; onChange: (v: string[]) => void; exclude?: string }) {
  const [draft, setDraft] = useState("");
  const [miss, setMiss] = useState(false);
  const add = () => {
    const t = draft.trim().toLowerCase();
    if (!t) return;
    const hit = COUNTRY_OPTIONS.find(o => o.l.toLowerCase() === t || o.v.toLowerCase() === t);
    if (!hit) { setMiss(true); return; }
    setMiss(false);
    if (hit.v !== exclude && !values.includes(hit.v)) onChange([...values, hit.v]);
    setDraft("");
  };
  return (
    <div className="fe-field">
      <label>{label}</label>
      <div className="tag-input-row">
        <input list="fe-country-list" value={draft} onChange={e => { setDraft(e.target.value); setMiss(false); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Start typing a country, e.g. Kenya" />
        <button type="button" className="btn inline" onClick={add}>Add</button>
      </div>
      <datalist id="fe-country-list">{COUNTRY_OPTIONS.map(o => <option key={o.v} value={o.l} />)}</datalist>
      {miss && <div className="acct-note" style={{ marginTop: 4 }}>Pick a country from the list, so it can be matched against funders&rsquo; own wording.</div>}
      {values.length > 0 && <div className="fe-tags">{values.map(v => (
        <span key={v} className="fe-tag">{COUNTRY_NAME[v] ?? v}<button type="button" aria-label={`Remove ${COUNTRY_NAME[v] ?? v}`} onClick={() => onChange(values.filter(x => x !== v))}>×</button></span>
      ))}</div>}
    </div>
  );
}

export default function FundingEligibilityView({ profile, orgName, adminViewing, gaps, gapsComputedAt, peerOrgs = [], readinessPct, suggestions = [], gov = null }: {
  profile: EligibilityProfile; orgName: string; adminViewing: boolean; gaps: Gap[]; gapsComputedAt: string | null; peerOrgs?: string[]; readinessPct?: number; suggestions?: OpenSuggestion[];
  /** The RFP Engine (patch 53): null before migration 0094. Switch off shows the one interest question; on shows the six gates. */
  gov?: { engineOn: boolean; interest: "yes" | "no" | null; answers: GovAnswers } | null;
}) {
  const router = useRouter();
  // Peer organizations (patch 48). Saved on their own: they are not part of
  // the eligibility screen, so saving them clears no cached match.
  const [peers, setPeers] = useState<string[]>(peerOrgs);
  // What is stored now. The button only wakes when the boxes differ from it
  // (patch 51), so a client is never left wondering whether to press Save.
  const [savedPeers, setSavedPeers] = useState<string[]>(peerOrgs);
  const peersDirty = peersChanged(peers, savedPeers);
  const [peerBusy, setPeerBusy] = useState(false);
  const [peerMsg, setPeerMsg] = useState<string | null>(null);
  const named = cleanPeerOrgs(peers).length;
  const savePeers = async () => {
    setPeerBusy(true); setPeerMsg(null);
    const r = await savePeerOrgsAction(peers);
    setPeerBusy(false);
    if (!r.ok) { setPeerMsg(r.error); return; }
    setPeers(r.peers);
    setSavedPeers(r.peers);
    setPeerMsg(r.peers.length ? "Saved. Your next funder search will use them." : "Saved.");
    router.refresh();
  };
  const [p, setP] = useState<EligibilityProfile>(profile);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<EligibilityProfile>) => setP({ ...p, ...patch });
  const completeness = computeCompleteness(p);
  const toggleState = (st: string) => set({ service_area: p.service_area.includes(st) ? p.service_area.filter(x => x !== st) : [...p.service_area, st] });

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await saveEligibilityProfileAction(p);
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(`Saved. ${r.completeness}% complete.`);
    router.refresh();
  };
  const [analyzing, setAnalyzing] = useState(false);
  // Phase D: past the monthly AI allowance a client is offered Request more instead.
  const [allowance, setAllowance] = useState<string | null>(null);
  const analyze = async () => {
    setAnalyzing(true);
    try {
      const r = await runGapAnalysisAction();
      if (!r.ok) setAllowance(r.allowance); else router.refresh();
    }
    finally { setAnalyzing(false); }
  };
  // Two lists, not one (patch 50): answers on this page, and documents the
  // Inven(s)tory does not cover yet. The percentage above measures the first.
  const { profile: profileGaps, documents: documentGaps } = splitGaps(gaps);
  const blocked = profileGaps.some(g => g.tier === "critical");
  const ageDays = analysisAgeDays(gapsComputedAt);
  const analyzedOn = gapsComputedAt && ageDays !== null
    ? new Date(gapsComputedAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : null;
  const gapRow = (g: Gap) => (
    <div key={g.key} className={`gap-item ${g.tier}`}>
      <span className={`tier-dot ${g.tier}`} aria-hidden />
      <span className="gap-text">{g.label}</span>
      <a className="gap-fix" href={g.fix === "profile" ? "#top" : "/invenstory"}>{g.fix === "profile" ? "Fill in" : "Upload"} →</a>
    </div>
  );

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-head"><div>
        {adminViewing && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · editing {orgName}&rsquo;s eligibility</div>}
        <h2>Funding Eligibility</h2>
        <p>Answer once. We use these facts to screen out grants you can&rsquo;t win — so you only see opportunities you&rsquo;re actually eligible for.</p>
      </div></div>

      <div className="fe-progress"><div className="fe-bar"><span style={{ width: `${completeness}%` }} /></div><b>Profile {completeness}% complete</b>
        {gapsComputedAt && typeof readinessPct === "number" && <a className="fe-ready" href="/readiness">Document readiness {readinessPct}%</a>}</div>

      {/* Answers found in the client's documents (patch 52). Confirming one
          saves it through the profile's own save; the form is told too, so the
          field shows it and a later Save cannot put the old value back. */}
      <FoundInDocuments suggestions={suggestions} adminViewing={adminViewing}
        onConfirmed={(field, value) => setP(cur => applySuggestion(cur, field as EligField, value))} />

      <section className={`acct-card peer-card ${named >= PEER_ASK ? "ok" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Organizations like yours</h3>
          <div className="spacer" style={{ flex: 1 }} />
          <span className={`su-badge ${named >= PEER_ASK ? "ok" : "star"}`}>{named >= PEER_ASK ? `✓ ${named} named` : "Helps the most"}</span>
        </div>
        <p className="peer-lede"><b>This is the answer that helps us most.</b> Nothing else on this page does more to find your strongest funder matches and point your fund seeking at funders likely to say yes.</p>
        <p className="acct-note">Name two or three organizations doing work like yours, and more if you can: a similar mission, a similar size or the size you are growing toward, in your region if possible. We look up who already funds them. Those funders lead your matches, each shown with the grants it actually made.</p>
        <PeerOrgsField values={peers} onChange={setPeers} />
        <p className="acct-note">Full names work best, and a US tax ID (EIN) works too. Peers outside the United States count when US foundations have funded them.</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <button type="button" className="btn inline peer-save" onClick={savePeers} disabled={peerBusy || !peersDirty}>
            {peerBusy ? "Saving…" : !peersDirty && savedPeers.length > 0 ? "✓ Peer organizations saved" : "Save peer organizations"}
          </button>
          {peerMsg && !peersDirty && <span className="acct-note" role="status" style={{ margin: 0 }}>{peerMsg}</span>}
        </div>
      </section>

      <section className="acct-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0 }}>What&rsquo;s missing</h3>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost" onClick={analyze} disabled={analyzing}>{analyzing ? "Reading…" : gapsComputedAt ? "Re-analyze Inven(s)tory" : "Analyze my Inven(s)tory"}</button>
          {analyzing && (
            <Busy
              label="Reading every document in your Inven(s)tory"
              hint="Each one is read in full, so this takes longer the more you have added. You can leave this page open."
              slowAfterMs={30000}
              slowHint="Still going. Larger Inven(s)tories can take a couple of minutes."
            />
          )}
        </div>
        {allowance && <AllowanceRequest message={allowance} />}
        <p className="acct-note" style={{ marginTop: 10 }}>{blocked
          ? "Funder matching cannot run until the items marked in red are answered."
          : "Nothing here blocks funder matching. Each item below makes your matches and applications stronger."}</p>

        <h4 className="gap-head">Profile answers <span>the percentage above</span></h4>
        {profileGaps.length === 0
          ? <p className="gap-done">✓ Every profile answer is filled in.</p>
          : <div className="gap-list">{profileGaps.map(gapRow)}</div>}

        <h4 className="gap-head">Documents funders ask for <span>from your Inven(s)tory</span></h4>
        {!gapsComputedAt
          ? <p className="gap-done muted">Not analyzed yet. Choose Analyze my Inven(s)tory to check your documents.</p>
          : documentGaps.length === 0
            ? <p className="gap-done">✓ Your documents cover everything on the list.</p>
            : <div className="gap-list">{documentGaps.map(gapRow)}</div>}
        {analyzedOn && <p className={`gap-asof ${ageDays! >= ANALYSIS_STALE_DAYS ? "stale" : ""}`}>
          Documents last analyzed {analyzedOn}.{ageDays! >= ANALYSIS_STALE_DAYS ? " That was a while ago, so this list may be out of date. Re-analyze to refresh it." : ""}
        </p>}

        <p className="gap-key">
          <span><span className="tier-dot critical" aria-hidden /> Blocks matching</span>
          <span><span className="tier-dot essential" aria-hidden /> Essential</span>
          <span><span className="tier-dot important" aria-hidden /> Important</span>
          <span><span className="tier-dot enriching" aria-hidden /> Nice to have</span>
        </p>
        <p className="acct-note" style={{ marginTop: 4 }}>Profile answers update as you edit. Documents update when you re-analyze.</p>
      </section>

      <section className="acct-card">
        <h3>What you&rsquo;re looking for</h3>
        <p className="acct-note" style={{ marginTop: 0 }}>Choose every kind that fits. This decides where we search, not what you are eligible for.</p>
        <div className="fe-kinds">{FUNDING_KINDS.map(k => {
          const on = kindsSought(p).includes(k.v);
          const only = on && kindsSought(p).length === 1;
          return (
            <button key={k.v} type="button" aria-pressed={on} disabled={only}
              title={only ? "Keep at least one kind: choose another first, then turn this off." : undefined}
              className={`fe-kind ${on ? "on" : ""}`}
              onClick={() => set({ funding_kinds: on ? kindsSought(p).filter(x => x !== k.v) : [...kindsSought(p), k.v] })}>
              <b>{k.l}</b><span>{k.hint}</span>
              {/* Patch 11: which public sources this choice switches on, outside the US. */}
              {sourcesForKind(k.v).length > 0 && (
                <span className="fe-kind-src">Outside the US, also searches {sourcesForKind(k.v).join(", ")}.</span>
              )}
            </button>
          );
        })}</div>
      </section>

      {/* Asked of every client while the RFP Engine is off (patch 53). A yes
          tells For Granted; only For Granted turns the engine on. */}
      {gov && !gov.engineOn && <GovInterestCard interest={gov.interest} adminViewing={adminViewing} />}

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
          <div className="fe-field"><label>{homeCountry(p) === "US" ? "Fiscal sponsor (if any)" : "US fiscal sponsor (if any)"}</label><input value={p.fiscal_sponsor ?? ""} onChange={e => set({ fiscal_sponsor: e.target.value })} /></div>
        </div>
      </section>

      <section className="acct-card">
        <h3>Location &amp; reach</h3>
        <div className="fe-field"><label>Country where you are registered</label>
          <select value={homeCountry(p)} onChange={e => {
            const c = e.target.value;
            // Leaving the US clears the state (it means nothing elsewhere) and
            // turns on the wider search, since US-only money mostly cannot be used.
            set(c === "US"
              ? { country_code: "US" }
              : { country_code: c, state_code: null, international: true, countries_served: p.countries_served.filter(x => x !== c) });
          }}>
            {COUNTRY_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
        {homeCountry(p) === "US" ? (
          <>
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
          </>
        ) : (
          <div className="fe-field"><label>Region, province or county (optional)</label><input value={p.county ?? ""} onChange={e => set({ county: e.target.value })} placeholder="e.g. Nairobi County" /></div>
        )}
        <CountryField
          label={homeCountry(p) === "US" ? "Other countries you work in (optional)" : "Other countries you work in"}
          values={p.countries_served} exclude={homeCountry(p)}
          onChange={v => set({ countries_served: v, international: p.international || v.some(c => c !== "US") })} />
        <div className="fe-field"><label>Regions you work across (optional)</label>
          <div className="fe-choice">{REGIONS.map(r => {
            const on = p.regions_served.includes(r.key);
            return (
              <button key={r.key} type="button" aria-pressed={on} className={`chip ${on ? "active" : ""}`}
                onClick={() => set({ regions_served: on ? p.regions_served.filter(x => x !== r.key) : [...p.regions_served, r.key] })}>{r.label}</button>
            );
          })}</div>
        </div>
        <label className="fe-check">
          <input type="checkbox" checked={wantsInternational(p)} disabled={wantsInternational({ ...p, international: false })}
            onChange={e => set({ international: e.target.checked })} />
          <span>Include funding from outside the United States
            {wantsInternational({ ...p, international: false })
              ? " (on, because you are registered or work outside the US)"
              : " (international foundations, development banks, the UN and the EU)"}</span>
        </label>
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
      <p className="acct-note" style={{ marginTop: 14 }}>Funder Matches screens funders against these facts, so keeping them current keeps the matches right.</p>

      {/* The six government gates (patch 53), saved on their own below the
          profile's Save so the two never look like one form. */}
      {gov?.engineOn && <GovReadinessSection answers={gov.answers} adminViewing={adminViewing} />}
    </div>
  );
}
