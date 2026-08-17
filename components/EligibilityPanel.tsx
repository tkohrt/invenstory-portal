"use client";
import Link from "next/link";
import type { EligibilitySummary } from "@/lib/server/eligibility";

export default function EligibilityPanel({ s }: { s: EligibilitySummary }) {
  const complete = s.completeness >= 100;
  return (
    <div className="elig-panel">
      <div className="elig-label">FUNDING ELIGIBILITY</div>
      {!s.started ? (
        <Link href="/funding-eligibility" className="elig-invite">
          <b>See what you qualify for</b>
          <span>Set up your eligibility profile — about 2 minutes.</span>
          <span className="elig-cta">Set up →</span>
        </Link>
      ) : (
        <>
          <div className="elig-cards">
            <div className={`elig-card ${complete ? "done" : ""}`}>
              <div className="elig-val">{s.completeness}%</div>
              <div className="elig-cap">Profile{complete ? " ✓" : ""}</div>
            </div>
            <Link href="/funding-eligibility" className="elig-card link">
              <div className="elig-val">✎</div><div className="elig-cap">Review / edit</div>
            </Link>
            <div className="elig-card muted" title="Arrives with the funder database">
              <div className="elig-val">—</div><div className="elig-cap">Matches soon</div>
            </div>
          </div>
          {s.chips.length > 0 && <div className="elig-chips">{s.chips.map((c, i) => <span key={i} className="elig-chip">{c}</span>)}</div>}
          {!complete && <Link href="/funding-eligibility" className="elig-finish">Finish your profile to unlock matching →</Link>}
        </>
      )}
    </div>
  );
}
