"use client";
// All Clients, the month's activity: one row per client, against the limits.
// A row opens that client's activity page for the same month.
import Link from "next/link";
import MonthPicker from "./MonthPicker";
import type { PortfolioActivity as Data } from "@/lib/server/activity-read";
import { monthLabel, MILESTONES } from "@/lib/activity";
import { LIMITS } from "@/lib/usage-limits";

const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const ago = (iso: string | null) => {
  if (!iso) return "No client activity yet";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
};

export default function PortfolioActivity({ data }: { data: Data }) {
  const pending = data.rows.reduce((n, r) => n + r.pendingRequests, 0);
  const stalled = data.rows.reduce((n, r) => n + r.stalled, 0);
  return (
    <section className="pa">
      <div className="pa-head">
        <div className="section-label" style={{ margin: 0 }}>Activity, {monthLabel(data.month)}</div>
        <div className="spacer" />
        <Link className="btn secondary" href="/admin/clients/digest">Monday digest</Link>
        <MonthPicker month={data.month} months={data.months} />
      </div>
      <div className="cl-summary">
        <span><b>{usd(data.spendTotal)}</b> AI spend</span>
        <span className={stalled ? "an-warn" : ""}><b>{stalled}</b> stalled draft{stalled === 1 ? "" : "s"} near a deadline</span>
        <span><b>{pending}</b> request{pending === 1 ? "" : "s"} for more questions</span>
      </div>
      <div className="pa-scroll">
        <table className="an-table pa-table">
          <thead><tr>
            <th>Client</th><th>People</th><th>Last client activity</th>
            <th>Chat questions</th><th>AI spend (client / all)</th><th>Documents added</th><th>Drafts</th><th>Getting started</th><th />
          </tr></thead>
          <tbody>{data.rows.map(r => {
            const nearChat = r.chat >= r.chatLimit * LIMITS.warnAt;
            const nearSpend = r.spendClient >= r.allowance * LIMITS.warnAt;
            return (
              <tr key={r.tenantId} className={r.stalled || r.pendingRequests ? "an-conflict" : ""}>
                <td><Link href={`/admin/clients/${r.tenantId}?m=${data.month}`}><b>{r.name}</b></Link></td>
                <td>{r.activePeople} of {r.people}<div className="ov-muted">used the portal</div></td>
                <td>{ago(r.lastClientActivity)}</td>
                <td className={nearChat ? "an-warn" : ""}>{r.chat} of {r.chatLimit}</td>
                <td className={nearSpend ? "an-warn" : ""}>{usd(r.spendClient)} of {usd(r.allowance)}<div className="ov-muted">hard limit {usd(r.ceiling)}</div><div className="ov-muted">{usd(r.spendTotal)} all</div></td>
                <td>{r.docsClient} by client<div className="ov-muted">{r.docsFG} by For Granted</div></td>
                <td>{r.draftsOpen} open{r.stalled ? <div className="an-bad">{r.stalled} stalled</div> : null}</td>
                <td>{r.milestonesDone} of {MILESTONES.length}<div className="ov-muted">milestones</div></td>
                <td><Link className="fc-link" href={`/admin/clients/${r.tenantId}?m=${data.month}`}>Activity</Link></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <p className="cl-note">Months are Eastern time. Each client&rsquo;s monthly AI allowance ($20 unless changed, plus anything granted this month) is a soft line on the AI spend the client causes: past it nothing stops and you are alerted. The hard limit (twice the allowance unless changed) stops only chat, readiness re-runs and Story Intelligence.
        {data.meterSince ? ` AI spend is measured from ${new Date(data.meterSince).toLocaleDateString()}.` : " AI spend is measured from the first AI call after the usage update."}
        {" "}&ldquo;People&rdquo; counts client logins that used the portal this month (a recorded visit or a question).
        {" "}&ldquo;Getting started&rdquo; counts the milestones reached so far, from first document to first application submitted; each client&rsquo;s page shows the days to each.</p>
    </section>
  );
}
