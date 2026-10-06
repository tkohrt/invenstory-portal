"use client";
// The Monday digest as it would go out now, with Send now (client activity, patch 3).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendDigestNowAction } from "@/lib/server/digest-actions";

interface Props {
  week: string; subject: string; html: string; slack: string;
  ready: { email: boolean; slack: boolean; schedule: boolean };
  sends: { at: string; manual: boolean; email: boolean; slack: boolean }[];
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function DigestPreview({ week, subject, html, slack, ready, sends }: Props) {
  const [view, setView] = useState<"email" | "slack">("email");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();
  const send = () => start(async () => {
    try {
      const r = await sendDigestNowAction();
      setResult(r.email || r.slack
        ? `Sent${r.email ? " by email" : ""}${r.email && r.slack ? " and" : ""}${r.slack ? " to Slack" : ""}.${!r.email ? " Email did not go." : ""}${!r.slack ? " Slack did not go." : ""}`
        : "Nothing went: neither email nor Slack accepted it.");
      router.refresh();
    } catch (e) { setResult(e instanceof Error ? e.message : "Could not send."); }
  });
  const missing = [!ready.email && "email (RESEND_API_KEY)", !ready.slack && "Slack (SLACK_ADMIN_WEBHOOK_URL)", !ready.schedule && "the Monday schedule (CRON_SECRET)"].filter(Boolean);

  return (
    <div className="cl">
      <div className="page-head">
        <div>
          <p className="ov-muted"><Link href="/admin/clients">All clients</Link> / Monday digest</p>
          <h2>Monday digest</h2>
          <p>Goes to info@forgranted.com and the team Slack channel every Monday at 9am Eastern (8am in winter), covering the week before. This is what it says right now, for the week of {week}.</p>
        </div>
        <div className="spacer" />
        <div className="cl-actions">
          <button type="button" className="btn" onClick={send} disabled={pending}>{pending ? "Sending" : "Send it now"}</button>
        </div>
      </div>
      {result && <p className="cl-note"><b>{result}</b></p>}
      {missing.length > 0 && <div className="cl-error">Not set up yet in Vercel: {missing.join(", ")}.</div>}

      <div className="cl-filters" role="tablist">
        {(["email", "slack"] as const).map(k => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`chip${view === k ? " active" : ""}`} onClick={() => setView(k)}>
            {k === "email" ? "Email" : "Slack"}
          </button>
        ))}
      </div>
      {view === "email" ? (
        <>
          <p className="cl-note">Subject: <b>{subject}</b></p>
          <iframe title="The digest email" sandbox="" srcDoc={html} className="dg-frame" />
        </>
      ) : <pre className="dg-slack">{slack}</pre>}

      <h3>Last sent</h3>
      {sends.length === 0 ? <p className="cl-note">Not sent yet.</p> : (
        <table className="an-table">
          <thead><tr><th>When (Eastern)</th><th>How</th><th>Email</th><th>Slack</th></tr></thead>
          <tbody>{sends.map((s, i) => (
            <tr key={i}><td>{when(s.at)}</td><td>{s.manual ? "Send now" : "Monday schedule"}</td>
              <td className={s.email ? "" : "an-bad"}>{s.email ? "Sent" : "Did not go"}</td>
              <td className={s.slack ? "" : "an-bad"}>{s.slack ? "Sent" : "Did not go"}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
