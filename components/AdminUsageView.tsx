"use client";
// Admin, AI usage: every client's chat questions against this month's limit,
// what their AI use cost (theirs, For Granted's, and background steps kept
// apart), the spend by feature, and requests for more questions to answer.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UsageOverview, ClientUsageRow } from "@/lib/server/usage-read";
import { grantChatAction, dismissUsageRequestAction } from "@/lib/server/usage-actions";
import { LIMITS } from "@/lib/usage-limits";

const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const FEATURE_LABEL: Record<string, string> = {
  chat: "Ask your Inven(s)tory", upload_readiness: "Readiness read on upload", story_intelligence: "Story Intelligence",
  analysis: "Inven(s)tory Analysis", card_library: "Card Library build", search_profile: "Search profile",
  match_rationale: "Funder match explanations", parse_application: "Reading a funder's application", tidy: "Tidy",
  readiness_audit: "Readiness audit", readiness_refresh: "Readiness refresh", unattributed: "Not attributed",
};

export default function AdminUsageView({ data }: { data: UsageOverview | { error: string } }) {
  if ("error" in data) {
    return (
      <div className="cl">
        <div className="page-head"><div><h2>AI usage</h2></div></div>
        <div className="cl-error">Usage could not be read: {data.error}. If migration 0051 has not been run yet, run it first.</div>
      </div>
    );
  }
  const pendingCount = data.clients.reduce((n, c) => n + c.pending.length, 0);
  return (
    <div className="cl">
      <div className="page-head">
        <div>
          <h2>AI usage</h2>
          <p>This month ({data.period}), every client. Clients may ask {LIMITS.chatPerDayPerPerson} questions a day per person and{" "}
            {LIMITS.chatPerMonthPerClient} a month per client; For Granted is never limited.
            {data.meterSince ? ` Spend is measured from ${new Date(data.meterSince).toLocaleDateString()}.` : " Spend is measured from the first call after this update."}</p>
        </div>
      </div>

      <div className="cl-summary">
        <span><b>{usd(data.total)}</b> AI spend this month</span>
        <span><b>{pendingCount}</b> request{pendingCount === 1 ? "" : "s"} for more</span>
      </div>

      <table className="an-table">
        <thead><tr><th>Client</th><th>Chat questions</th><th>Spend: client</th><th>Spend: For Granted</th><th>Spend: background</th><th>Requests</th></tr></thead>
        <tbody>{data.clients.map(c => <ClientRow key={c.tenantId} c={c} />)}</tbody>
      </table>

      <h3>By feature</h3>
      {data.byFeature.length === 0 ? <p className="cl-note">No calls measured yet this month.</p> : (
        <table className="an-table">
          <thead><tr><th>Feature</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Spend</th></tr></thead>
          <tbody>{data.byFeature.map(f => (
            <tr key={f.feature}><td>{FEATURE_LABEL[f.feature] ?? f.feature}</td><td>{f.calls.toLocaleString()}</td>
              <td>{f.inputTokens.toLocaleString()}</td><td>{f.outputTokens.toLocaleString()}</td><td>{usd(f.cost)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <p className="cl-note">Background is work no one pressed a button for at that moment, such as a step of a long run whose starter is not known.
        Costs are list prices for the model each call used, including the 10% premium on US-only endpoints.</p>
    </div>
  );
}

function ClientRow({ c }: { c: ClientUsageRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(250);
  const act = (fn: () => Promise<unknown>) => start(async () => {
    setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not save."); }
  });
  const near = c.chatMonth >= c.chatLimit * LIMITS.warnAt;
  return (
    <tr className={c.pending.length ? "an-conflict" : ""}>
      <td>{c.name}</td>
      <td className={near ? "an-warn" : ""}>{c.chatMonth.toLocaleString()} of {c.chatLimit.toLocaleString()}{c.extra ? <div className="ov-muted">includes {c.extra} granted</div> : null}</td>
      <td>{usd(c.costClient)}</td><td>{usd(c.costAdmin)}</td><td>{usd(c.costSystem)}</td>
      <td>
        {c.pending.map(r => (
          <div key={r.id} className="ov-muted">{r.by} asked for more, {new Date(r.at).toLocaleDateString()}
            <button type="button" className="fc-link" style={{ marginLeft: 6 }} disabled={pending}
              onClick={() => act(() => dismissUsageRequestAction(c.tenantId, r.id))}>dismiss</button></div>
        ))}
        <span className="cl-card-acts">
          <input type="number" min={1} max={10000} value={n} onChange={e => setN(Number(e.target.value))} style={{ width: 80 }} aria-label="Questions to grant" />
          <button type="button" className="btn secondary ap-mini" disabled={pending} onClick={() => act(() => grantChatAction(c.tenantId, n))}>Grant this month</button>
        </span>
        {err && <div className="cl-error">{err}</div>}
      </td>
    </tr>
  );
}
