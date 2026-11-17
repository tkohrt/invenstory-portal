"use client";
// The RFP scan for one client, For Granted's controls (patch 58): the RFP
// profile the scan reads, Run the scan now, and the last run. Shown on the
// client's admin page while the RFP Engine is on. Results: /admin/clients/[id]/rfp.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRfpProfileAction } from "@/lib/server/rfp-actions";
import { profileProblem, cleanRfpProfile, type RfpProfile } from "@/lib/rfp-profile";
import { BUCKET_LABEL, type Bucket } from "@/lib/rfp-rubric";
import type { RfpRunResult } from "@/lib/server/rfp-run";

export interface LastRun { started_at: string; status: string; trigger: string; candidates: number; scored: number; counts: Partial<Record<Bucket, number>>; new_count: number }
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ORDER: Bucket[] = ["draft_submit", "open_response", "upcoming", "no_source", "spend_nothing"];

export default function RfpScanCard({ tenantId, profile, available, lastRun }: {
  tenantId: string; profile: RfpProfile; available: boolean; lastRun: LastRun | null;
}) {
  const router = useRouter();
  const [cap, setCap] = useState(profile.capabilities);
  const [naics, setNaics] = useState(profile.naics.join(", "));
  const [kw, setKw] = useState(profile.keywords.join("\n"));
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const draft = cleanRfpProfile({ capabilities: cap, naics, keywords: kw });
  const saved = cleanRfpProfile(profile);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const problem = profileProblem(saved);

  const save = async () => {
    setSaving(true); setErr(null); setMsg(null);
    const r = await saveRfpProfileAction(tenantId, { capabilities: cap, naics, keywords: kw }).catch(() => ({ ok: false as const, error: "That did not save." }));
    setSaving(false);
    if (!r.ok) setErr(r.error); else { setMsg("Saved."); router.refresh(); }
  };
  const run = async () => {
    setRunning(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/admin/rfp-run?tenant=${tenantId}`, { method: "POST" });
      const r = (await res.json()) as RfpRunResult;
      if (!r.ok) setErr(r.error ?? "The scan did not finish.");
      else setMsg(`Scanned ${r.candidates} notices: ${r.scored} judged for fit, ${r.reused} reused from last time${r.deferred ? `, ${r.deferred} left for next week (the cap)` : ""}; ${r.newCount} new.`);
      router.refresh();
    } catch { setErr("The scan did not finish. Reload and look at the last run."); }
    setRunning(false);
  };

  if (!available) return <section className="wc-card gov-admin"><h3>RFP scan</h3><p className="wc-sub">Migration 0096 has not been applied yet.</p></section>;
  return (
    <section className="wc-card gov-admin">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>RFP scan</h3>
        <div style={{ flex: 1 }} />
        <a className="sb-btn sb-quiet sb-sm" href={`/admin/clients/${tenantId}/rfp`}>Results</a>
        <button type="button" className="sb-btn sb-secondary" onClick={run} disabled={running || !!problem || dirty}
          title={dirty ? "Save the profile first." : problem ?? "Up to 15 model calls."}>
          {running ? "Scanning… (up to a few minutes)" : "Run the scan now"}
        </button>
      </div>
      <p className="wc-sub">Runs on its own every Monday morning. It pulls open federal notices matching the codes and keywords, applies Rubric v1.1, and judges fit for up to 15 a week against the capabilities below.</p>
      {lastRun ? (
        <p className="wc-sub"><b>Last run {when(lastRun.started_at)}</b> ({lastRun.trigger === "cron" ? "weekly" : "by hand"}, {lastRun.status}): {lastRun.candidates} notices, {lastRun.scored} judged, {lastRun.new_count} new. {ORDER.filter(b => lastRun.counts[b]).map(b => `${BUCKET_LABEL[b]} ${lastRun.counts[b]}`).join(" · ")}</p>
      ) : <p className="wc-sub">No scan yet.</p>}

      <div className="fe-field"><label htmlFor="rfp-cap">What the client sells and has shipped</label>
        <textarea id="rfp-cap" rows={7} value={cap} onChange={e => setCap(e.target.value)}
          placeholder="Plain sentences: services, products, verticals actually shipped in, delivery model, what they do not do. The fit judgment quotes this text." />
      </div>
      <div className="fe-row">
        <div className="fe-field"><label htmlFor="rfp-naics">NAICS codes</label>
          <input id="rfp-naics" value={naics} onChange={e => setNaics(e.target.value)} placeholder="541511, 541512" />
          <div className="gov-stamp">{draft.naics.length} code{draft.naics.length === 1 ? "" : "s"}</div>
        </div>
        <div className="fe-field"><label htmlFor="rfp-kw">Keywords (one per line)</label>
          <textarea id="rfp-kw" rows={3} value={kw} onChange={e => setKw(e.target.value)} placeholder={"artificial intelligence\nsoftware development"} />
          <div className="gov-stamp">{draft.keywords.length} keyword{draft.keywords.length === 1 ? "" : "s"}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn inline" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save the RFP profile" : "✓ RFP profile saved"}</button>
        {problem && !dirty && <span className="acct-note" style={{ margin: 0 }}>{problem}</span>}
        {msg && <span className="acct-note" role="status" style={{ margin: 0 }}>{msg}</span>}
        {err && <span className="cl-error" role="alert">{err}</span>}
      </div>
    </section>
  );
}
