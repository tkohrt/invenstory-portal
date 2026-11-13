"use client";
// The 990 importer (patch 42): one EIN in, the public filings out. Used in
// onboarding's nonprofit branch and on the Readiness page for clients who
// onboarded before this existed. Decided 13 Nov: no record for the EIN means
// offer the manual upload or a skip, never a dead end; nothing waits on this.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { importClient990Action, applyBudgetBandAction, type Import990Result } from "@/lib/server/irs990-actions";

export default function Irs990Block({ initialEin = "", onUpload, uploadHint }: {
  initialEin?: string;
  /** When set, "Upload your 990" opens the caller's upload UI (type pre-set). */
  onUpload?: () => void;
  /** Shown on the no-record path when there is no onUpload (onboarding). */
  uploadHint?: string;
}) {
  const router = useRouter();
  const [ein, setEin] = useState(initialEin);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Extract<Import990Result, { ok: true }> | null>(null);
  const [fail, setFail] = useState<Extract<Import990Result, { ok: false }> | null>(null);
  const [bandBusy, setBandBusy] = useState(false);
  const [bandDone, setBandDone] = useState(false);
  const [bandSkipped, setBandSkipped] = useState(false);

  const run = async () => {
    setBusy(true); setDone(null); setFail(null);
    const r = await importClient990Action(ein).catch(() => ({ ok: false as const, status: "error" as const, error: "That did not finish. Try again." }));
    setBusy(false);
    if (r.ok) { setDone(r); router.refresh(); } else setFail(r);
  };
  const useBand = async () => {
    if (!done?.suggestion) return;
    setBandBusy(true);
    const r = await applyBudgetBandAction(done.suggestion.band).catch(() => ({ ok: false }));
    setBandBusy(false);
    if (r.ok) { setBandDone(true); router.refresh(); }
  };

  return (
    <div className="i990">
      <div className="i990-head">
        <b>Pull your IRS filings</b>
        <span className="su-small">Your 990s are public. Give us your EIN and we file a summary for you; no uploading needed.</span>
      </div>
      <div className="i990-row">
        <input value={ein} onChange={e => setEin(e.target.value)} placeholder="EIN, e.g. 34-1234567" inputMode="numeric"
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void run(); } }} />
        <button type="button" className="sb-btn sb-primary sb-sm" onClick={run} disabled={busy || !ein.trim()}>
          {busy ? "Looking up…" : "Find my filings"}</button>
      </div>
      {done && (
        <div className="i990-ok">
          <p>✓ Filed <b>{done.title}</b>{done.year ? ` (through filing year ${done.year})` : ""} into Layer I. It counts on your readiness checklist and is being read now.</p>
          {done.postcardOnly && <p className="su-small">This organization files the 990-N e-postcard, so there are no public financials; the summary says so honestly.</p>}
          {done.suggestion && !bandDone && !bandSkipped && (
            <p className="i990-sug">Your {done.suggestion.year} filing reports revenue of ${Math.round(done.suggestion.revenue).toLocaleString()}. Set your annual budget to <b>{done.suggestion.label}</b>?{" "}
              <button type="button" className="sb-btn sb-secondary sb-sm" onClick={useBand} disabled={bandBusy}>{bandBusy ? "Saving…" : "Use this"}</button>{" "}
              <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setBandSkipped(true)}>No thanks</button>
            </p>
          )}
          {bandDone && <p className="su-small">✓ Budget set on your eligibility profile. You can change it there any time.</p>}
        </div>
      )}
      {fail && (
        <div className="i990-none">
          <p>{fail.error}</p>
          {fail.status === "none" && (
            <p className="su-small">
              {onUpload
                ? <>You can <button type="button" className="sb-btn sb-secondary sb-sm" onClick={onUpload}>Upload your 990</button> instead, or skip for now; nothing waits on this.</>
                : (uploadHint ?? "You can upload your 990 as a document instead, or skip for now; nothing waits on this.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
