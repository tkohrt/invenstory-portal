"use client";
// One client's RFP Engine results, For Granted's view (patch 58): the five
// buckets in the retrospective's order, soonest deadline first, with fit,
// gates, lift and the quotes the fit rests on. Everything here is untrusted
// procurement text, rendered as text (React escapes it).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { triageRfpAction, toggleRfpFollowAction } from "@/lib/server/rfp-actions";
import { ACTION_LABEL, BUCKET_LABEL, type Action, type Bucket } from "@/lib/rfp-rubric";

export interface RfpResultRow {
  notice_id: string; action: Action; bucket: Bucket; fit: string | null; rationale: string | null;
  evidence: { from: string; text: string }[] | null;
  gate_result: string; gate_blockers: { gate: string; reason: string }[]; gate_checks: { gate: string; reason: string }[];
  lift_class: string | null; lift_hours: string | null; deal_breaker: string | null; strategic_note: string | null;
  admin_triage: string | null; first_seen_at: string; verified_at: string;
  rfp_notice: { title: string; agency: string | null; notice_type_raw: string | null; set_aside: string | null; naics: string[]; due_at: string | null; due_date_only: boolean; description_url: string | null; solicitation_number: string | null } | null;
}
const ORDER: Bucket[] = ["draft_submit", "open_response", "upcoming", "no_source", "spend_nothing"];
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const daysTo = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
const safeUrl = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

export default function RfpResultsView({ tenantId, orgName, rows, missing, lastRun, following = [] }: {
  tenantId: string; orgName: string; rows: RfpResultRow[]; missing: boolean;
  /** Notice ids already on this client's Following list (patch 66). */
  following?: string[];
  lastRun: { started_at: string; status: string; trigger: string; candidates: number; scored: number; new_ids: string[] } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const newSet = new Set(lastRun?.new_ids ?? []);
  const followSet = new Set(following);
  const [err, setErr] = useState<string | null>(null);
  // Patch 66: the one way a client comes to see an RFP result for now, chosen here by a person.
  const follow = async (id: string) => {
    setBusy(id); setErr(null);
    const r = await toggleRfpFollowAction(tenantId, id).catch(() => ({ ok: false as const, error: "That did not save. Try again." }));
    setBusy(null);
    if (!r.ok) setErr(r.error);
    router.refresh();
  };
  const triage = async (id: string, state: "pinned" | "under_review" | "rejected" | null) => {
    setBusy(id); await triageRfpAction(tenantId, id, state).catch(() => null); setBusy(null); router.refresh();
  };
  const sorted = (b: Bucket) => rows.filter(r => r.bucket === b).sort((x, y) => {
    const dx = x.rfp_notice?.due_at ? Date.parse(x.rfp_notice.due_at) : Infinity;
    const dy = y.rfp_notice?.due_at ? Date.parse(y.rfp_notice.due_at) : Infinity;
    return (x.admin_triage === "pinned" ? -1 : 0) - (y.admin_triage === "pinned" ? -1 : 0) || dx - dy;
  });

  return (
    <div>
      <div className="page-head">
        <div><h2>RFP Engine results: {orgName}</h2>
          <p>{lastRun ? `Last scan ${day(lastRun.started_at)} (${lastRun.trigger === "cron" ? "weekly" : "by hand"}, ${lastRun.status}): ${lastRun.candidates} notices pulled, ${lastRun.scored} judged for fit.` : "No scan yet."} For Granted only; nothing here is shown to the client yet.</p></div>
        <div className="spacer" />
        <a className="sb-btn sb-quiet sb-sm" href={`/admin/clients/${tenantId}`}>Back to the client</a>
      </div>
      {err && <p className="cl-error" role="alert">{err}</p>}
      {missing && <p className="cl-error">The results tables are not in the database yet (migrations 0095 and 0096).</p>}
      {!missing && rows.length === 0 && <p className="acct-note">No results. Run the scan from the client&rsquo;s page.</p>}
      {ORDER.map(b => {
        const list = sorted(b);
        if (!list.length) return null;
        return (
          <section key={b} className="wc-card" style={{ marginTop: 14 }}>
            <h3 style={{ marginTop: 0 }}>{BUCKET_LABEL[b]} <span className="gov-gate-state">({list.length})</span></h3>
            {list.map(r => {
              const n = r.rfp_notice;
              const due = n?.due_at ? daysTo(n.due_at) : null;
              const url = safeUrl(n?.description_url ?? null);
              return (
                <div key={r.notice_id} className="rfp-row" style={{ borderTop: "1px solid var(--line)", padding: "10px 0", opacity: r.admin_triage === "rejected" ? 0.55 : 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    {newSet.has(r.notice_id) && <span className="su-badge">New</span>}
                    {r.admin_triage === "pinned" && <span className="su-badge ok">Pinned</span>}
                    {due !== null && due <= 14 && due >= 0 && <span className="su-badge">Due in {due} {due === 1 ? "day" : "days"}</span>}
                    <b>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{n?.title ?? "(notice missing)"}</a> : (n?.title ?? "(notice missing)")}</b>
                  </div>
                  <div className="wc-sub" style={{ margin: "2px 0" }}>
                    {[n?.agency, n?.notice_type_raw, n?.solicitation_number, n?.set_aside ? `Set-aside ${n.set_aside}` : null,
                      n?.due_at ? `Due ${day(n.due_at)}` : "No due date"].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ fontSize: 14 }}>
                    <b>{ACTION_LABEL[r.action]}</b>
                    {r.fit && <> · Fit {r.fit}</>}
                    {r.lift_hours && <> · Lift {r.lift_hours}</>}
                    {r.gate_result !== "open" && <> · Gates: {r.gate_result}</>}
                  </div>
                  {r.rationale && <div className="wc-sub" style={{ margin: "2px 0" }}>{r.rationale}</div>}
                  {r.gate_blockers.map((g, i) => <div key={`b${i}`} className="gov-warn" style={{ marginTop: 4 }}>{g.reason}</div>)}
                  {r.gate_checks.map((g, i) => <div key={`c${i}`} className="gov-stamp">{g.gate === "note" ? "" : "Check: "}{g.reason}</div>)}
                  {r.deal_breaker && <div className="gov-stamp">Deal-breaker: {r.deal_breaker}</div>}
                  {r.strategic_note && <div className="gov-stamp">Strategic: {r.strategic_note}</div>}
                  {(r.evidence ?? []).length > 0 && <div className="gov-stamp">{(r.evidence ?? []).map(e => `${e.from === "client" ? "Profile" : "Notice"}: “${e.text}”`).join(" · ")}</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    {(["pinned", "under_review", "rejected"] as const).map(s => (
                      <button key={s} type="button" className={`chip ${r.admin_triage === s ? "active" : ""}`} aria-pressed={r.admin_triage === s}
                        disabled={busy === r.notice_id} onClick={() => triage(r.notice_id, r.admin_triage === s ? null : s)}>
                        {s === "pinned" ? "Pin" : s === "under_review" ? "Review" : "Reject"}
                      </button>
                    ))}
                    <span style={{ flex: 1 }} />
                    <button type="button" className={`chip ${followSet.has(r.notice_id) ? "active" : ""}`} aria-pressed={followSet.has(r.notice_id)}
                      disabled={busy === r.notice_id} onClick={() => void follow(r.notice_id)}
                      title={followSet.has(r.notice_id)
                        ? `On ${orgName}'s Following list: they can see this notice's title, agency, due date and link. Click to take it off.`
                        : `Add to ${orgName}'s Following list. They will see the notice's title, agency, due date and link there, with none of the scoring.`}>
                      {followSet.has(r.notice_id) ? "★ On their Following list" : "☆ Add to their Following list"}
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
