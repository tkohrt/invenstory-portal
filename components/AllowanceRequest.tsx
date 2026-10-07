"use client";
// Phase D: the hard AI limit, as a client meets it (lib/allowance.ts). A note,
// and the way to ask For Granted for more (Slack and info@forgranted.com,
// through the same request as chat's). Admins never see it: they are never limited.
import { useState, useTransition } from "react";
import { requestMoreUsageAction } from "@/lib/server/usage-actions";

export default function AllowanceRequest({ message, requested: already = false }: {
  message: string; requested?: boolean;
}) {
  const [requested, setRequested] = useState(already);
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="ca-request">
      <p className="cl-note">{message}</p>
      {requested
        ? <p className="cl-note">Request sent. For Granted will add more and let you know.</p>
        : <button type="button" className="btn secondary" disabled={busy}
            onClick={() => start(async () => {
              setErr(null);
              try { await requestMoreUsageAction("ai_month"); setRequested(true); }
              catch (e) { setErr(e instanceof Error ? e.message : "The request did not send."); }
            })}>Request more</button>}
      {err && <div className="cl-error">{err}</div>}
    </div>
  );
}
