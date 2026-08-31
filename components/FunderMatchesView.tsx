"use client";
// Funder matching results. Hidden from clients by default; For Granted runs the
// match and reads the results here. Every card is a June 2026 lead, and the page
// says so rather than letting anyone forget it.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runMatchAction, clearMatchesAction } from "@/lib/server/match-actions";
import type { Verdict } from "@/lib/server/matching";

interface Cached {
  grant_id: string; verdict: Verdict; reason: string | null;
  close_date: string | null; award_ceiling: number | null; matched_at: string;
  title: string | null; funder: string | null; url: string | null;
  rationale: string | null; source_site: string | null;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  eligible: "Eligible", likely: "Likely", check: "Needs a check",
};

// What each rung of the ladder actually means, shown on hover. Every one ends
// at the same place on purpose: the Ledger is a June 2026 snapshot, so none of
// these verdicts is a substitute for reading the funder's own page.
const VERDICT_HELP: Record<Verdict, string> = {
  eligible:
    "The eligibility text names your organization type, and nothing is blocking. "
    + "The strongest signal available from a June 2026 snapshot. Still verify at the source.",
  likely:
    "Nothing is blocking, and there is at least one real alignment signal: your state, "
    + "a cause-area overlap, or a strong score from the Ledger. Worth an hour. Verify at the source.",
  check:
    "Either something is blocking (federal money without SAM.gov, a cost match you cannot meet), "
    + "or there is nothing to go on but topical similarity. Read the eligibility text before spending time on it.",
};

function money(n: number | null) {
  if (n == null) return "—";
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;
}

function deadline(d: string | null) {
  if (!d) return "Rolling";
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
  const label = new Date(d).toLocaleDateString();
  if (days < 0) return `${label} (closed)`;
  if (days <= 30) return `${label} · ${days}d left`;
  return label;
}

export default function FunderMatchesView({
  matches, orgName, configured, health, isAdmin,
}: {
  matches: Cached[]; orgName: string; configured: boolean;
  health: { ok: boolean; detail: string }; isAdmin: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    setErr(null); setMsg("Searching the Ledger. A cold start can take up to a minute.");
    try {
      const r = await runMatchAction();
      setMsg(`${r.kept} opportunities kept, ${r.dropped} filtered out as closed or ineligible. ${r.funders} funder matches, ${r.evidence} with funding evidence.`);
      router.refresh();
    } catch (e) {
      setMsg(null);
      setErr(e instanceof Error ? e.message : "Matching failed.");
    }
  });

  const clear = () => start(async () => { await clearMatchesAction(); setMsg(null); router.refresh(); });

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Funder Matches</h2>
          <p>
            Opportunities screened for {orgName}: eligibility rules first, then alignment,
            then funding evidence. Everything here is a <strong>June 2026 lead, not a fact</strong>.
            Verify eligibility and deadlines on the funder&apos;s own site before any of it
            reaches a client or an application.
          </p>
        </div>
        {isAdmin && (
          <>
            <span className="spacer" />
            <button className="btn" onClick={run} disabled={pending || !configured}>
              {pending ? "Matching…" : matches.length ? "Re-run matching" : "Run matching"}
            </button>
          </>
        )}
      </div>

      {!configured && (
        <div className="ov-note">
          The Ledger service isn&apos;t connected yet. Set <code>FUNDER_LEDGER_URL</code> and{" "}
          <code>FUNDER_LEDGER_KEY</code> in the portal environment and this page goes live.
          Nothing else needs to change.
        </div>
      )}
      {configured && !health.ok && (
        <div className="ov-note">Ledger status: {health.detail}</div>
      )}

      {msg && <div className="fm-msg">{msg}</div>}
      {err && <div className="ov-err">{err}</div>}

      {matches.length === 0 ? (
        <div className="empty">
          No matches cached yet.{isAdmin && configured ? " Run matching to build the list." : ""}
        </div>
      ) : (
        <>
          <div className="ov-runbar">
            {matches.length} opportunities · last matched{" "}
            {new Date(matches[0].matched_at).toLocaleString()} · Ledger data as of June 2026
          </div>
          <table className="aq-table fm-table">
            <thead>
              <tr>
                <th>Opportunity</th><th>Funder</th><th>Verdict</th>
                <th>Deadline</th><th>Ceiling</th><th>Why this client</th>
              </tr>
            </thead>
            <tbody>
              {matches.map(m => (
                <tr key={m.grant_id}>
                  <td className="fm-name">
                    {m.url
                      ? <a href={m.url} target="_blank" rel="noopener noreferrer">{m.title || m.grant_id}</a>
                      : (m.title || m.grant_id)}
                  </td>
                  <td className="fm-funder">
                    {m.funder || <span className="ov-muted" title="The dataset does not carry a funder name for this record. Resolved once the opportunity page is fetched.">Unknown</span>}
                    {m.source_site && <div className="fm-listed">listed on {m.source_site.replace(/^https?:\/\//i, "").toLowerCase()}</div>}
                  </td>
                  <td>
                    <span className={`ov-tag fm-${m.verdict} fm-verdict`} title={VERDICT_HELP[m.verdict]}>
                      {VERDICT_LABEL[m.verdict]}
                    </span>
                  </td>
                  <td className="fm-nowrap">{deadline(m.close_date)}</td>
                  <td className="fm-nowrap">{money(m.award_ceiling)}</td>
                  <td className="fm-why">
                    {m.rationale || <span className="ov-muted">{m.reason ?? "—"}</span>}
                    {m.rationale && m.reason && (
                      <div className="fm-screen">Screen: {m.reason}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <div className="ov-actions">
              <button className="btn ghost" onClick={clear} disabled={pending}>Clear cached matches</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
