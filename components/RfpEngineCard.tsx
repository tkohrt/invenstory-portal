"use client";
// The RFP Engine switch on a client's admin page (patch 53, 16 Nov 2026), with
// what the client has said so far: the interest answer and the six gates.
// Saves at once, like every switch (UI Style Guide, Switches).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setRfpEngineAction } from "@/lib/server/gov-readiness-actions";
import type { GateKey, GateState } from "@/lib/gov-readiness";

const STATE_WORD: Record<GateState, string> = { answered: "Answered", tbc: "To confirm", unanswered: "Open" };

export default function RfpEngineCard({ tenantId, orgName, on: initial, available, interest, gates }: {
  tenantId: string; orgName: string; on: boolean;
  /** False before migration 0094 is applied. */
  available: boolean;
  interest: "yes" | "no" | null;
  gates: { key: GateKey; label: string; state: GateState; line: string }[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flip = async () => {
    const next = !on;
    setBusy(true); setErr(null);
    const r = await setRfpEngineAction(tenantId, next).catch(() => ({ ok: false as const, error: "Could not save the switch." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setOn(next);
    router.refresh();
  };
  const settled = gates.filter(g => g.state === "answered").length;
  return (
    <section className="wc-card gov-admin">
      <div className="gov-admin-head">
        <button type="button" role="switch" aria-checked={on} aria-label={`RFP Engine for ${orgName}`} className="rs-switch" disabled={busy} onClick={flip} />
        <div>
          <h3>RFP Engine</h3>
          <p className="wc-sub" style={{ margin: 0 }}>
            {on
              ? `On. ${orgName} sees the Government readiness questions on Funding Eligibility. The weekly government-opportunity scan will include them once it is built; it is not running yet.`
              : `Off. Turn it on when government RFPs are in the scope of the engagement with ${orgName}. It opens the Government readiness questions on their Funding Eligibility page.`}
          </p>
        </div>
      </div>
      {err && <p className="cl-error" role="alert">{err}</p>}
      {!available && <p className="wc-sub" style={{ marginTop: 8 }}>Migration 0094 has not been applied yet, so answers cannot be saved or shown.</p>}
      {available && (
        <p className="wc-sub" style={{ marginTop: 8 }}>
          <b>Asked &ldquo;Do you sell, or want to sell, to government buyers?&rdquo;:</b>{" "}
          {interest === "yes" ? "Yes." : interest === "no" ? "No." : "Not answered."}
        </p>
      )}
      {available && on && (
        <>
          <p className="wc-sub" style={{ margin: "8px 0 4px" }}><b>Gates: {settled} of {gates.length} answered.</b> An open gate screens as check, never as fail.</p>
          <ul className="gov-gates">
            {gates.map(g => (
              <li key={g.key}>
                <span className={`gov-dot ${g.state}`} aria-hidden />
                <span className="gov-gate-name">{g.label}</span>
                <span className="gov-gate-state">{STATE_WORD[g.state]}</span>
                <span className="gov-gate-line">{g.line}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
