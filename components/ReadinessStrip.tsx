"use client";
// P1.5 (patch 38): the readiness checklist moved to its own screen; what stays
// on the Inven(s)tory page is this one-line strip, so the layers are the
// page's marquee. The run button stays here on purpose (the page where
// documents are added is the page where the check is re-run), and the strip
// links to the full checklist.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { runGapAnalysisAction } from "@/lib/server/gap-actions";
import AllowanceRequest from "./AllowanceRequest";

export default function ReadinessStrip({ pct, computedAt }: { pct: number; computedAt: string | null }) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [allowance, setAllowance] = useState<string | null>(null);
  const analyze = async () => {
    setAnalyzing(true);
    const r = await runGapAnalysisAction();
    setAnalyzing(false);
    if (!r.ok) { setAllowance(r.allowance); return; }
    router.refresh();
  };
  const pctColor = pct >= 80 ? "#3a7d44" : pct >= 50 ? "#b08a2e" : "#b06a2e";
  return (
    <div className="inv-readiness-strip" data-tour="inv-readiness">
      <b style={{ color: pctColor }}>{pct}%</b>
      <span className="irs-label">Readiness</span>
      <span className="irs-bar"><span style={{ width: `${pct}%`, background: pctColor }} /></span>
      {computedAt && <span className="irs-when">checked {new Date(computedAt).toLocaleDateString()}</span>}
      <a className="sb-btn sb-secondary sb-sm" href="/readiness">See the checklist →</a>
      <button className={`btn rc-run-cta${computedAt ? "" : " rc-run-pulse"}`} onClick={analyze} disabled={analyzing}>
        {analyzing ? "Running Readiness Check…" : "Run Readiness Check"}</button>
      {allowance && <AllowanceRequest message={allowance} />}
    </div>
  );
}
