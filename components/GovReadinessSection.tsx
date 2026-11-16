"use client";
// Government readiness on the Funding Eligibility page (patch 53, 16 Nov 2026):
// the six gates a government buyer screens on, shown only while For Granted has
// the RFP Engine switched on for this client. Saved on its own, apart from the
// eligibility profile, so saving one never touches the other.
//
// Rules: lib/gov-readiness.ts. An unanswered gate, or one marked "To be
// confirmed", is checked by a person later and never counted against the client.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveGovReadinessAction } from "@/lib/server/gov-readiness-actions";
import {
  SAM_STATUS, CLEARANCE_LEVELS, CMMC_LEVELS, FEDRAMP_POSTURES, GSA_STATUS, SET_ASIDES, YES_NO_TBC,
  toGovInput, gatesAnswered, samDaysLeft, GATES,
  type GovAnswers, type GovInput, type GateKey, type YesNoTbc,
} from "@/lib/gov-readiness";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });

export default function GovReadinessSection({ answers: initial, adminViewing }: { answers: GovAnswers; adminViewing: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState<GovAnswers>(initial);
  const [form, setForm] = useState<GovInput>(() => toGovInput(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const dirty = JSON.stringify(form) !== JSON.stringify(toGovInput(saved));
  const answered = gatesAnswered(saved);

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null); setProblems([]);
    const r = await saveGovReadinessAction(form).catch(() => ({ ok: false as const, error: "That did not save. Reload the page and try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setSaved(r.answers); setForm(toGovInput(r.answers)); setProblems(r.problems);
    setMsg("Saved.");
    router.refresh();
  };

  // A select whose blank choice means "not answered yet" (the gate is left out).
  const pick = (id: string, value: string, options: { v: string; l: string }[], onChange: (v: string) => void) => (
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Not answered yet</option>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
  const stamp = (key: GateKey) => {
    const g = saved[key];
    if (!g) return null;
    return <div className="gov-stamp">Answered by {g.role === "admin" ? "For Granted" : adminViewing ? "the client" : "your team"} on {day(g.at)}</div>;
  };

  const sam = form.sam;
  const left = samDaysLeft(saved);
  const setAside = (k: string, v: YesNoTbc) => {
    const cur = { ...(form.set_asides?.statuses ?? {}) };
    if (cur[k] === v) delete cur[k]; else cur[k] = v;
    const { set_asides: _drop, ...rest } = form;
    void _drop;
    setForm(Object.keys(cur).length ? { ...rest, set_asides: { statuses: cur } } : rest);
  };
  const setGate = <K extends keyof GovInput>(key: K, value: GovInput[K] | null) => {
    const { [key]: _drop, ...rest } = form;
    void _drop;
    setForm(value ? { ...rest, [key]: value } as GovInput : rest as GovInput);
  };

  return (
    <section className={`acct-card gov-card ${answered === GATES.length ? "ok" : ""}`} id="government-readiness">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Government readiness</h3>
        <div className="spacer" style={{ flex: 1 }} />
        <span className={`su-badge ${answered === GATES.length ? "ok" : ""}`}>{answered} of {GATES.length} answered</span>
      </div>
      <p className="acct-note" style={{ marginTop: 8 }}>
        Government buyers check these before they read a proposal, so we use them to screen every contract opportunity for you.
        Answer what you know and choose <b>To be confirmed</b> for anything you are unsure of. A question left open is never counted
        against you: we mark that opportunity to check, not to rule out.
      </p>
      {adminViewing && <p className="acct-note">You are answering for this client. Each answer you change is recorded under For Granted, with today&rsquo;s date.</p>}

      <div className="fe-field"><label htmlFor="gov-sam">SAM.gov registration</label>
        {pick("gov-sam", sam?.status ?? "", SAM_STATUS, v => setGate("sam", v ? { ...sam, status: v } : null))}
        {sam?.status === "active" && (
          <div className="fe-row gov-sub">
            <div className="fe-field"><label htmlFor="gov-uei">UEI (optional)</label>
              <input id="gov-uei" value={sam.uei ?? ""} maxLength={20} placeholder="12 letters and numbers" onChange={e => setGate("sam", { ...sam, uei: e.target.value })} /></div>
            <div className="fe-field"><label htmlFor="gov-cage">CAGE code (optional)</label>
              <input id="gov-cage" value={sam.cage ?? ""} maxLength={12} placeholder="5 letters and numbers" onChange={e => setGate("sam", { ...sam, cage: e.target.value })} /></div>
            <div className="fe-field"><label htmlFor="gov-exp">Registration expires</label>
              <input id="gov-exp" type="date" value={sam.expires ?? ""} onChange={e => setGate("sam", { ...sam, expires: e.target.value || null })} /></div>
          </div>
        )}
        {left !== null && left < 0 && <div className="gov-warn">This registration&rsquo;s expiry date has passed. An expired registration blocks federal bids until it is renewed; update the date once it is.</div>}
        {left !== null && left >= 0 && left <= 60 && <div className="gov-warn soft">This registration expires in {left} {left === 1 ? "day" : "days"}. Renewal can take weeks, so it is worth starting now.</div>}
        {stamp("sam")}
      </div>

      <div className="fe-row">
        <div className="fe-field"><label htmlFor="gov-fcl">Facility clearance</label>
          {pick("gov-fcl", form.clearance?.level ?? "", CLEARANCE_LEVELS, v => setGate("clearance", v ? { level: v } : null))}
          {stamp("clearance")}
        </div>
        <div className="fe-field"><label htmlFor="gov-cmmc">CMMC level</label>
          {pick("gov-cmmc", form.cmmc?.level ?? "", CMMC_LEVELS, v => setGate("cmmc", v ? { level: v } : null))}
          {stamp("cmmc")}
        </div>
      </div>

      <div className="fe-row">
        <div className="fe-field"><label htmlFor="gov-fedramp">FedRAMP posture</label>
          {pick("gov-fedramp", form.fedramp?.posture ?? "", FEDRAMP_POSTURES, v => setGate("fedramp", v ? { posture: v } : null))}
          {stamp("fedramp")}
        </div>
        <div className="fe-field"><label htmlFor="gov-gsa">GSA Schedule</label>
          {pick("gov-gsa", form.gsa_schedule?.status ?? "", GSA_STATUS, v => setGate("gsa_schedule", v ? { ...form.gsa_schedule, status: v } : null))}
          {form.gsa_schedule?.status === "held" && (
            <input className="gov-sub" aria-label="GSA Schedule contract number (optional)" value={form.gsa_schedule.contract ?? ""} maxLength={40}
              placeholder="Contract number (optional)" onChange={e => setGate("gsa_schedule", { ...form.gsa_schedule, contract: e.target.value })} />
          )}
          {stamp("gsa_schedule")}
        </div>
      </div>

      <div className="fe-field">
        <label id="gov-sa-label">Set-aside statuses</label>
        <p className="acct-note" style={{ margin: "2px 0 0" }}>Some contracts are reserved for businesses holding one of these. Answer each one you know.</p>
        <div className="gov-sa" role="group" aria-labelledby="gov-sa-label">
          {SET_ASIDES.map(s => {
            const cur = form.set_asides?.statuses?.[s.v];
            return (
              <div key={s.v} className="gov-sa-row" role="group" aria-label={s.l}>
                <span className="gov-sa-name">{s.l}</span>
                <span className="fe-choice">
                  {YES_NO_TBC.map(o => (
                    <button key={o.v} type="button" aria-pressed={cur === o.v} className={`chip ${cur === o.v ? "active" : ""}`}
                      onClick={() => setAside(s.v, o.v)}>{o.l}</button>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        {stamp("set_asides")}
      </div>

      {problems.length > 0 && <div className="gov-warn soft" role="status">{problems.map(p => <div key={p}>{p}</div>)}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn inline" onClick={save} disabled={busy || !dirty}
          title={!dirty ? "Nothing has changed since the last save." : undefined}>
          {busy ? "Saving…" : !dirty && Object.keys(saved).length > 0 ? "✓ Government readiness saved" : "Save government readiness"}
        </button>
        {msg && !dirty && <span className="acct-note" role="status" style={{ margin: 0 }}>{msg}</span>}
        {err && <span className="cl-error" role="alert">{err}</span>}
      </div>
    </section>
  );
}
