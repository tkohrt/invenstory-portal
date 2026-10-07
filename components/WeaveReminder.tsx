"use client";
// The reminder before weaving (Shane, 7 October 2026). Weaving is a model call,
// so before it runs the person is told it uses a small part of the monthly AI
// allowance. "Don't remind me before weaving" turns it off for that person
// (their Account page turns it back on); for a client it comes back anyway once
// the month's allowance is 80% used. Clients see shares, never dollars
// (decision 32). For Granted's weaves are its own and are never charged to the
// client, and the reminder says so.
import { useEffect, useState } from "react";
import { weaveInfoAction, type WeaveInfo } from "@/lib/server/workspace-actions";
import { setUiPrefAction } from "@/lib/server/account-actions";

export default function WeaveReminder({ tenantName, again, onWeave, onCancel }: {
  tenantName: string;
  /** Weave again, rather than the first weave of this answer. */
  again: boolean;
  onWeave: () => void; onCancel: () => void;
}) {
  const [info, setInfo] = useState<WeaveInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [dontRemind, setDontRemind] = useState(false);

  useEffect(() => {
    let live = true;
    weaveInfoAction().then(i => {
      if (!live) return;
      // Reminders off, and nothing worth saying: weave straight away.
      if (!i.due && !i.atCeiling) { onWeave(); return; }
      setInfo(i);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const go = () => {
    if (dontRemind) void setUiPrefAction("confirm_weave", false).catch(() => null);
    onWeave();
  };

  if (!info && !failed) return null;

  return (
    <div className="ws-modal-back" role="presentation" onClick={onCancel}>
      <div className="ws-modal wv-remind" role="dialog" aria-modal="true" aria-labelledby="wv-rm-title" onClick={e => e.stopPropagation()}>
        <h3 id="wv-rm-title">{again ? "Weave this answer again?" : "Weave this answer?"}</h3>
        <p>Weaving drafts short connecting sentences between the Story Cards in this answer. You accept, edit or reject each one; none of them adds facts, numbers or names.</p>
        {failed && <p className="ov-muted">Weaving uses a small part of the monthly AI allowance.</p>}
        {info && info.admin && (
          <p className="ov-muted">Each question you weave costs about {info.perWeaveCents} cent{info.perWeaveCents === 1 ? "" : "s"} of AI use.
            Weaves by For Granted are recorded as For Granted&rsquo;s own use, so they are not counted toward {tenantName}&rsquo;s monthly allowance.</p>
        )}
        {info && !info.admin && !info.atCeiling && (
          <p className="ov-muted">Each question you weave uses a small part of your organization&rsquo;s monthly AI allowance ({info.perWeave}).
            {info.usedPct != null ? ` You've used ${info.usedPct}% this month.` : ""}</p>
        )}
        {info && info.atCeiling && (
          <div className="ap-error">Your organization has reached this month&rsquo;s AI limit, so weaving is paused. Ask For Granted for more and we&rsquo;ll add it, or it renews on the 1st.</div>
        )}
        {(!info || !info.atCeiling) && (
          <label className="wv-remind-off">
            <input type="checkbox" checked={dontRemind} onChange={e => setDontRemind(e.target.checked)} /> Don&rsquo;t remind me before weaving
          </label>
        )}
        <div className="ws-modal-acts">
          <button type="button" className="btn secondary" onClick={onCancel} autoFocus>Not now</button>
          {(!info || !info.atCeiling) && <button type="button" className="btn inline ap-go" onClick={go}>Weave</button>}
        </div>
      </div>
    </div>
  );
}
