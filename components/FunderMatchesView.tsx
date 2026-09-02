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
  rationale: string | null; source_site: string | null; verified_at: string | null;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  eligible: "Eligible", likely: "Likely", check: "Needs a check",
};

// What each rung of the ladder actually means, shown on hover.
//
// NAMING RULE (client-visible surface): clients see "Ground Truth" and nothing
// else. Never the Funder Ledger, never the vendor dataset, never the service.
// This mirrors the existing brand rule that external writing says "For Granted's
// funder discovery process" rather than naming the source. Everything a client
// reads here is For Granted's work; how it is assembled is not their concern.
//
// Every rung still ends in the same place on purpose: nothing here substitutes
// for reading the funder's own page.
/** Freshness in For Granted's own terms, never the source dataset's. */
function verified(m: { verified_at: string | null }): { label: string; help: string } {
  if (!m.verified_at) {
    return {
      label: "Not independently verified",
      help: "For Granted has not yet confirmed this record at the funder's own site. Treat the details as a starting point.",
    };
  }
  const d = new Date(m.verified_at);
  return {
    label: `Verified ${d.toLocaleDateString()}`,
    help: `A member of the For Granted team confirmed these details at the funder's own site on ${d.toLocaleDateString()}. Deadlines and priorities can still change.`,
  };
}

const VERDICT_HELP: Record<Verdict, string> = {
  eligible:
    "The eligibility text names your organization type, and nothing is blocking. "
    + "The strongest signal available from a June 2026 snapshot. Still verify at the source.",
  likely:
    "Nothing is blocking, and there is at least one real alignment signal: your state, "
    + "a cause-area overlap, or a strong alignment score. Worth an hour. Verify at the source.",
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
    setErr(null); setMsg("Searching Ground Truth. This can take up to a minute.");
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
          {isAdmin
            ? <>Ground Truth is not connected in this environment. Set <code>FUNDER_LEDGER_URL</code>{" "}
              and <code>FUNDER_LEDGER_KEY</code> and this page goes live.</>
            : <>Ground Truth is being prepared for {orgName}. Your For Granted team will be in touch
              once matches are ready.</>}
        </div>
      )}
      {configured && !health.ok && (
        <div className="ov-note">{isAdmin ? `Ground Truth status: ${health.detail}` : "Matches are being refreshed."}</div>
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
            {matches.length} opportunities · compiled{" "}
            {new Date(matches[0].matched_at).toLocaleDateString()} · every match is a lead to
            confirm with the funder before applying
          </div>
          <table className="aq-table fm-table">
            <thead>
              <tr>
                <th>Opportunity</th><th>Funder</th><th>Verdict</th>
                <th>Deadline</th><th>Ceiling</th><th>Verified</th><th>Why this client</th>
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
                  <td className="fm-nowrap">
                    <span className={m.verified_at ? "fm-verified" : "ov-muted"} title={verified(m).help}>
                      {verified(m).label}
                    </span>
                  </td>
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
