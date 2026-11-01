"use client";
// A client's own "Worth a look" or "Not for us" on one match (patch 7 of the 1
// November 2026 build). For Granted sees it as a read-only line in its
// Decision column; the client sets and undoes it here.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setClientViewAction, clearClientViewAction } from "@/lib/server/client-view-actions";
import { CLIENT_REASONS, CLIENT_STATE_LABEL, viewSentence, type ClientView, type ClientViewKind } from "@/lib/client-view";

export default function ClientVerdict({ kind, targetId, view, mode }: {
  kind: ClientViewKind; targetId: string; view: ClientView | null;
  /** client: set and undo. admin: show what the client said, if anything. */
  mode: "client" | "admin";
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (mode === "admin") {
    return view ? <div className={`cv-admin cv-${view.state}`} title={view.note ?? undefined}>Client: {viewSentence(view)}</div> : null;
  }

  const save = async (state: "interested" | "not_for_us", reason?: string) => {
    setBusy(true); setErr(null);
    const r = await setClientViewAction({ kind, targetId, state, reason: reason ?? null });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setPicking(false); router.refresh();
  };
  const undo = async () => {
    setBusy(true); setErr(null);
    const r = await clearClientViewAction(kind, targetId);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    router.refresh();
  };

  if (picking) {
    return (
      <div className="cv-pick">
        <div className="cv-why">Why not?</div>
        {CLIENT_REASONS.map(r => (
          <button key={r.code} type="button" className="cv-reason" disabled={busy} onClick={() => save("not_for_us", r.code)}>{r.label}</button>
        ))}
        <button type="button" className="fc-link" onClick={() => setPicking(false)}>cancel</button>
        {err && <div className="ov-err">{err}</div>}
      </div>
    );
  }
  if (view) {
    return (
      <div className="cv-set">
        <span className={`ov-tag cv-tag cv-${view.state}`}>{viewSentence(view)}</span>
        <button type="button" className="fc-link" disabled={busy} onClick={undo}>undo</button>
        {err && <div className="ov-err">{err}</div>}
      </div>
    );
  }
  return (
    <div className="cv-buttons">
      <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busy} onClick={() => save("interested")}>{CLIENT_STATE_LABEL.interested}</button>
      <button type="button" className="sb-btn sb-quiet sb-sm" disabled={busy} onClick={() => setPicking(true)}>{CLIENT_STATE_LABEL.not_for_us}</button>
      {err && <div className="ov-err">{err}</div>}
    </div>
  );
}
