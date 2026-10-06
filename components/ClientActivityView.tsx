"use client";
// Admin, Client activity: one client, one month (Eastern time). Five tabs:
// Overview, Usage and limits, Documents, Grants, People. Read-only, except
// granting extra chat questions. Chat appears as counts and topics only.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MonthPicker from "./MonthPicker";
import OpenAsClient from "./OpenAsClient";
import type { ClientActivity, DraftRow } from "@/lib/server/activity-read";
import { monthLabel, STALL } from "@/lib/activity";
import { LIMITS } from "@/lib/usage-limits";
import { grantChatAction, dismissUsageRequestAction } from "@/lib/server/usage-actions";

type Tab = "overview" | "usage" | "documents" | "grants" | "people";
const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const money = (cents: number | null) => (cents == null ? "" : `$${Math.round(cents / 100).toLocaleString()}`);
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
/** A date with no time (a deadline): shown as written, not shifted by time zone. */
const day = (ymd: string | null) => (ymd ? new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const STATUS: Record<string, string> = { drafting: "Drafting", client_review: "Client review", completed: "Completed", submitted: "Submitted", won: "Won", lost: "Lost" };
const FEATURE: Record<string, string> = {
  chat: "Ask your Inven(s)tory", upload_readiness: "Readiness read on upload", story_intelligence: "Story Intelligence",
  analysis: "Inven(s)tory Analysis", card_library: "Card Library build", search_profile: "Search profile",
  match_rationale: "Funder match explanations", parse_application: "Reading a funder's application", tidy: "Tidy",
  readiness_audit: "Readiness audit", readiness_refresh: "Readiness refresh", unattributed: "Not attributed",
};

function Meter({ used, limit, label, dollars }: { used: number; limit: number; label: string; dollars?: boolean }) {
  const f = (n: number) => (dollars ? `$${n.toFixed(2)}` : n.toLocaleString());
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 100 ? "full" : pct >= LIMITS.warnAt * 100 ? "near" : "ok";
  return (
    <div className="ca-meter">
      <div className="ca-meter-head"><span>{label}</span><b>{f(used)} of {dollars ? `$${limit}` : f(limit)}</b></div>
      <div className={`ca-meter-bar ca-meter-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`stat-card${warn ? " ca-stat-warn" : ""}`}>
      <div className="stat-value">{value}</div><div className="stat-label">{label}</div>{sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function ClientActivityView({ data }: { data: ClientActivity }) {
  const [tab, setTab] = useState<Tab>("overview");
  const d = data;
  const apps = d.drafts.filter(x => x.purpose !== "standard_answers");
  const stalled = apps.filter(x => x.stall.stalled);
  const docsAdded = d.documents.list.length;
  const docsClient = d.documents.list.filter(x => x.source === "client").length;

  return (
    <div className="cl cav">
      <div className="page-head">
        <div>
          <p className="ov-muted"><Link href={`/admin/clients?m=${d.month}`}>All clients</Link> / activity</p>
          <h2>{d.tenant.name}</h2>
          <p>{monthLabel(d.month)}, Eastern time. Client since {date(d.tenant.createdAt)}.</p>
        </div>
        <div className="spacer" />
        <div className="cl-actions">
          <MonthPicker month={d.month} months={d.months} />
          <OpenAsClient tenantId={d.tenant.id} href="/invenstory" className="btn secondary">Open their portal</OpenAsClient>
        </div>
      </div>

      <div className="cl-filters" role="tablist">
        {([["overview", "Overview"], ["usage", "Usage and limits"], ["documents", `Documents (${docsAdded})`], ["grants", `Grants (${d.drafts.length})`], ["people", `People (${d.people.length})`]] as [Tab, string][])
          .map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {tab === "overview" && (
        <>
          {stalled.length > 0 && (
            <div className="cl-error">
              <b>{stalled.length} draft{stalled.length === 1 ? "" : "s"} stalled near the deadline</b> (due within {STALL.deadlineWithinDays} days, no change for {STALL.idleDays} or more):
              <ul>{stalled.map(x => x.stall.stalled && (
                <li key={x.id}>{x.title}{x.funder ? `, ${x.funder}` : ""}: {x.stall.pastDue ? `${-x.stall.daysToDeadline} days past due` : `due in ${x.stall.daysToDeadline} days`}, last changed {x.stall.idleDays} days ago.{" "}
                  <OpenAsClient tenantId={d.tenant.id} href={`/drafts/${x.id}`}>Open the draft</OpenAsClient></li>
              ))}</ul>
            </div>
          )}
          <div className="stat-grid">
            <Stat label="Chat questions this month" value={`${d.chat.month} of ${d.chat.limit}`} warn={d.chat.month >= d.chat.limit * LIMITS.warnAt} />
            <Stat label="AI spend caused by the client" value={usd(d.spend.client)} sub={`of the $${d.spend.allowance} allowance (Phase D); ${usd(d.spend.total)} in all`} warn={d.spend.client >= d.spend.allowance * LIMITS.warnAt} />
            <Stat label="Documents added" value={String(docsAdded)} sub={`${docsClient} by the client, ${docsAdded - docsClient} by For Granted`} />
            <Stat label="Readiness" value={`${d.growth.readinessPct}%`} sub="today" />
            <Stat label="Verified Story Cards" value={String(d.growth.cardsVerified)} sub={`${d.growth.cardsVerifiedThisMonth} verified this month, of ${d.growth.cardsTotal}`} />
            <Stat label="Applications" value={`${d.outcomes.submittedAll} submitted`} sub={`${d.outcomes.won} won (${money(d.outcomes.wonCents)}), ${d.outcomes.lost} lost`} />
            <Stat label="Deadlines ahead" value={`${d.outcomes.upcoming.d30} in 30 days`} sub={`${d.outcomes.upcoming.d60} in 60, ${d.outcomes.upcoming.d90} in 90`} />
            <Stat label="Inven(s)tory size" value={`${d.growth.docsTotal} documents`} sub={`${d.growth.words.toLocaleString()} words`} />
          </div>
          <h3>Worth a look</h3>
          <ul className="ca-items">
            {friction(d).map((f, i) => <li key={i} className={`ca-item ${f.bad ? "ca-missing" : "ca-covered"}`}><b>{f.label}</b> <span className="ov-muted">{f.detail}</span></li>)}
          </ul>
        </>
      )}

      {tab === "usage" && <UsageTab d={d} />}
      {tab === "documents" && <DocumentsTab d={d} />}
      {tab === "grants" && <GrantsTab d={d} />}
      {tab === "people" && (
        <table className="an-table">
          <thead><tr><th>Person</th><th>Email</th><th>Login since</th><th>Questions this month</th><th>Busiest day</th></tr></thead>
          <tbody>{d.people.length === 0 ? <tr><td colSpan={5}><em>No client logins yet.</em></td></tr> : d.people.map(p => (
            <tr key={p.id}><td>{p.name}</td><td>{p.email}</td><td>{date(p.since)}</td><td>{p.questions}</td>
              <td className={p.busiestDay && p.busiestDay.count >= d.chat.perDayLimit * LIMITS.warnAt ? "an-warn" : ""}>
                {p.busiestDay ? `${p.busiestDay.count} on ${new Date(`${p.busiestDay.day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} (limit ${d.chat.perDayLimit})` : ""}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function friction(d: ClientActivity): { label: string; detail: string; bad: boolean }[] {
  const out: { label: string; detail: string; bad: boolean }[] = [];
  out.push({ label: `${d.documents.failedNow} document${d.documents.failedNow === 1 ? "" : "s"} failed to read`, detail: "in the whole Inven(s)tory", bad: d.documents.failedNow > 0 });
  out.push({ label: `${d.documents.unreadableNow} with no readable text`, detail: "usually scanned PDFs, waiting on text recognition", bad: d.documents.unreadableNow > 0 });
  out.push({ label: `${d.chat.nothingFound} chat question${d.chat.nothingFound === 1 ? "" : "s"} found nothing`, detail: "this month: a sign of something missing from the Inven(s)tory", bad: d.chat.nothingFound > 0 });
  const open = d.requests.filter(r => r.status === "pending").length;
  out.push({ label: `${open} open request${open === 1 ? "" : "s"} for more questions`, detail: "answer on Usage and limits", bad: open > 0 });
  out.push({ label: `${d.other.readsHeld} upload read${d.other.readsHeld === 1 ? "" : "s"} held back`, detail: `past ${LIMITS.uploadReadsPerDayPerClient} a day this month`, bad: d.other.readsHeld > 0 });
  return out;
}

function UsageTab({ d }: { d: ClientActivity }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [n, setN] = useState(250);
  const [err, setErr] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => start(async () => {
    setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not save."); }
  });
  const topicsTotal = d.chat.topics.reduce((a, t) => a + t.count, 0);
  return (
    <>
      <div className="ca-meters">
        <Meter label="Chat questions, all logins" used={d.chat.month} limit={d.chat.limit} />
        <Meter label="AI spend caused by the client (Phase D allowance)" used={d.spend.client} limit={d.spend.allowance} dollars />
        <Meter label="Analysis pages read" used={d.analysis.pages} limit={d.analysis.pagesLimit} />
      </div>
      <p className="cl-note">Limits: {LIMITS.chatPerDayPerPerson} questions a day per person and {LIMITS.chatPerMonthPerClient} a month per client
        {d.chat.extra ? `, plus ${d.chat.extra} granted this month` : ""}; {d.analysis.runs} analysis run{d.analysis.runs === 1 ? "" : "s"} by the client this month (1 a day);
        {" "}{d.other.reprocesses} document{d.other.reprocesses === 1 ? "" : "s"} processed again ({LIMITS.reprocessPerDayPerClient} a day). For Granted is never limited.</p>

      <div className="ca-grant">
        <b>Give more questions this month</b>
        <input type="number" min={1} max={10000} value={n} onChange={e => setN(Number(e.target.value))} aria-label="Questions to grant" />
        <button type="button" className="btn secondary ap-mini" disabled={pending} onClick={() => act(() => grantChatAction(d.tenant.id, n))}>Grant</button>
        {err && <span className="cl-error">{err}</span>}
      </div>
      {d.requests.length > 0 && (
        <table className="an-table">
          <thead><tr><th>Request for more</th><th>By</th><th>Status</th><th /></tr></thead>
          <tbody>{d.requests.map(r => (
            <tr key={r.id}><td>{date(r.at)}</td><td>{r.by}</td><td>{r.status}</td>
              <td>{r.status === "pending" && <button type="button" className="fc-link" disabled={pending} onClick={() => act(() => dismissUsageRequestAction(d.tenant.id, r.id))}>dismiss</button>}</td></tr>
          ))}</tbody>
        </table>
      )}

      <h3>What they asked about</h3>
      <p className="cl-note">Counts by broad topic. The questions themselves are not shown here.</p>
      {topicsTotal === 0 ? <p className="cl-note">No questions this month.</p> : (
        <table className="an-table">
          <thead><tr><th>Topic</th><th>Questions</th><th>Share</th></tr></thead>
          <tbody>{d.chat.topics.map(t => <tr key={t.key}><td>{t.label}</td><td>{t.count}</td><td>{Math.round((t.count / topicsTotal) * 100)}%</td></tr>)}</tbody>
        </table>
      )}

      <h3>AI spend by feature</h3>
      <p className="cl-note">Client {usd(d.spend.client)}, For Granted {usd(d.spend.admin)}, background {usd(d.spend.system)}.</p>
      {d.spend.byFeature.length === 0 ? <p className="cl-note">No AI calls measured this month.</p> : (
        <table className="an-table">
          <thead><tr><th>Feature</th><th>Calls</th><th>Spend</th></tr></thead>
          <tbody>{d.spend.byFeature.map(f => <tr key={f.feature}><td>{FEATURE[f.feature] ?? f.feature}</td><td>{f.calls}</td><td>{usd(f.cost)}</td></tr>)}</tbody>
        </table>
      )}
    </>
  );
}

function DocumentsTab({ d }: { d: ClientActivity }) {
  const max = Math.max(1, ...d.documents.byMonth.map(m => m.client + m.fg));
  return (
    <>
      <h3>Documents added, last 12 months</h3>
      <div className="ca-bars" role="img" aria-label="Documents added per month">
        {d.documents.byMonth.map(m => {
          const total = m.client + m.fg;
          return (
            <div key={m.month} className={`ca-bar${m.month === d.month ? " ca-bar-now" : ""}`} title={`${monthLabel(m.month)}: ${total} (${m.client} by the client, ${m.fg} by For Granted)`}>
              <span className="ca-bar-n">{total || ""}</span>
              <div className="ca-bar-fill" style={{ height: `${Math.round((total / max) * 100)}%` }} />
              <span className="ca-bar-m">{monthLabel(m.month).slice(0, 3)}</span>
            </div>
          );
        })}
      </div>
      <h3>Added in {monthLabel(d.month)} ({d.documents.list.length})</h3>
      {d.documents.list.length === 0 ? <p className="cl-note">No documents added this month.</p> : (
        <table className="an-table">
          <thead><tr><th>Document</th><th>Layer</th><th>Type</th><th>Added by</th><th>Date</th><th>Status</th><th /></tr></thead>
          <tbody>{d.documents.list.map(x => (
            <tr key={x.id} className={x.problem ? "an-conflict" : ""}>
              <td>{x.title}</td><td>{x.layer}</td><td>{x.kind ?? ""}</td>
              <td>{x.source === "client" ? (x.by ?? "The client") : "For Granted"}</td><td>{date(x.at)}</td>
              <td>{x.problem ? <span className="an-bad">{x.problem}</span> : x.status}</td>
              <td><DownloadDoc id={x.id} /></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  );
}

function DownloadDoc({ id }: { id: string }) {
  const [err, setErr] = useState(false);
  return (
    <button type="button" className="fc-link" onClick={async () => {
      setErr(false);
      const res = await fetch(`/api/file?documentId=${id}`);
      if (res.ok) { const { url } = await res.json(); window.open(url, "_blank", "noopener,noreferrer"); } else setErr(true);
    }}>{err ? "Not available" : "Download"}</button>
  );
}

function GrantsTab({ d }: { d: ClientActivity }) {
  const [onlyMonth, setOnlyMonth] = useState(false);
  const rows = d.drafts.filter(x => !onlyMonth || x.touchedThisMonth);
  return (
    <>
      <label className="an-only"><input type="checkbox" checked={onlyMonth} onChange={e => setOnlyMonth(e.target.checked)} /> Only drafts worked on in {monthLabel(d.month)}</label>
      {rows.length === 0 ? <p className="cl-note">No drafts{onlyMonth ? " worked on this month" : " yet"}.</p> : (
        <table className="an-table">
          <thead><tr><th>Draft</th><th>Deadline</th><th>Stage</th><th>Questions answered</th><th>Last change</th><th>Funder&rsquo;s application</th><th /></tr></thead>
          <tbody>{rows.map(x => <DraftRowView key={x.id} x={x} tenantId={d.tenant.id} />)}</tbody>
        </table>
      )}
      <p className="cl-note">Submitted by month: {d.outcomes.byMonth.filter(m => m.submitted).map(m => `${monthLabel(m.month).slice(0, 3)} ${m.submitted}`).join(", ") || "none in the last 12 months"}.</p>
    </>
  );
}

function DraftRowView({ x, tenantId }: { x: DraftRow; tenantId: string }) {
  const source = x.sourceUrl
    ? <a className="fc-link" href={x.sourceUrl} target="_blank" rel="noopener noreferrer">From the funder&rsquo;s web page</a>
    : x.sourceFilename
      ? <span title="The portal reads the file and keeps its text; keeping the file itself comes in the next patch.">{x.sourceFilename}<div className="ov-muted">questions kept; file not stored yet</div></span>
      : x.hasSourceText ? <span className="ov-muted">Pasted questions</span> : <span className="ov-muted">None</span>;
  return (
    <tr className={x.stall.stalled ? "an-conflict" : ""}>
      <td><b>{x.title}</b>{x.funder ? <div className="ov-muted">{x.funder}{x.amountCents ? `, ${money(x.amountCents)}` : ""}</div> : null}
        {x.purpose === "standard_answers" && <div className="ov-muted">Standard Answers</div>}
        <div className="ov-muted">Started {date(x.createdAt)}{x.createdBy ? ` by ${x.createdBy}` : ""}</div></td>
      <td>{day(x.deadline)}{x.stall.stalled && <div className="an-bad">{x.stall.pastDue ? "past due" : `due in ${x.stall.daysToDeadline} days`}, idle {x.stall.idleDays} days</div>}</td>
      <td>{STATUS[x.status] ?? x.status}</td>
      <td>{x.sections ? `${x.answered} of ${x.sections}` : "No questions yet"}{x.done ? <div className="ov-muted">{x.done} marked done</div> : null}</td>
      <td>{date(x.lastEdit)}</td>
      <td>{source}</td>
      <td><OpenAsClient tenantId={tenantId} href={`/drafts/${x.id}`}>Open the draft</OpenAsClient></td>
    </tr>
  );
}
