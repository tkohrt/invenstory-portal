"use client";
// The Requests inbox (patch 37): every client-triggered event as a row with a
// status, so nothing depends on who happened to read Slack. Open items are
// the work; FYIs are logged beneath without becoming chores; the handled list
// is the audit trail.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveRequestAction } from "@/lib/server/request-actions";
import { KIND_LABEL, type ClientRequest } from "@/lib/requests-shared";

export default function AdminRequestsView({ open, recent }: { open: ClientRequest[]; recent: ClientRequest[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const act = async (id: string, status: "done" | "dismissed" | "open", resolution?: string) => {
    setBusyId(id); setErr(null);
    const r = await resolveRequestAction({ id, status, resolution }).catch(() => ({ ok: false as const, error: "That did not save. Try again." }));
    if (!r.ok) setErr(r.error);
    setBusyId(null); setNoteFor(null); setNote("");
    router.refresh();
  };

  const openWork = open.filter(r => r.status === "open");
  const fyi = open.filter(r => r.status === "seen");
  const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <p className="rq-sub">Everything clients have asked for or triggered, with who handled what. Slack and email still ping; this is the record.</p>
      {err && <div className="ov-note">{err}</div>}

      {openWork.length === 0 && <div className="empty">Nothing waiting. Open requests land here the moment a client asks.</div>}
      {openWork.map(r => (
        <div key={r.id} className="rq-item">
          <div className="rq-item-head">
            <span className="rq-kind">{KIND_LABEL[r.kind] ?? r.kind}</span>
            {r.tenant_name && <b>{r.tenant_name}</b>}
            <span className="rq-when">{when(r.created_at)}</span>
          </div>
          <div className="rq-detail">{r.detail}</div>
          <div className="rq-verbs">
            {noteFor === r.id ? (
              <>
                <input autoFocus value={note} maxLength={400} placeholder="What was done? (optional)"
                  onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void act(r.id, "done", note); if (e.key === "Escape") setNoteFor(null); }} />
                <button type="button" className="sb-btn sb-primary sb-sm" disabled={busyId === r.id} onClick={() => void act(r.id, "done", note)}>Mark done</button>
                <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setNoteFor(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busyId === r.id} onClick={() => { setNoteFor(r.id); setNote(""); }}>Done…</button>
                <button type="button" className="sb-btn sb-quiet sb-sm" disabled={busyId === r.id}
                  title="Close without action. Stays in the handled list." onClick={() => void act(r.id, "dismissed")}>Dismiss</button>
              </>
            )}
          </div>
        </div>
      ))}

      {fyi.length > 0 && (
        <details className="rq-fold">
          <summary>FYI log ({fyi.length}): uploads, removals and threshold notes. Logged, never a chore.</summary>
          {fyi.map(r => (
            <div key={r.id} className="rq-item rq-fyi">
              <div className="rq-item-head">
                <span className="rq-kind">{KIND_LABEL[r.kind] ?? r.kind}</span>
                {r.tenant_name && <b>{r.tenant_name}</b>}
                <span className="rq-when">{when(r.created_at)}</span>
              </div>
              <div className="rq-detail">{r.detail}</div>
              <div className="rq-verbs">
                <button type="button" className="sb-btn sb-quiet sb-sm" disabled={busyId === r.id} onClick={() => void act(r.id, "dismissed")}>Clear</button>
              </div>
            </div>
          ))}
        </details>
      )}

      {recent.length > 0 && (
        <details className="rq-fold">
          <summary>Recently handled ({recent.length})</summary>
          {recent.map(r => (
            <div key={r.id} className="rq-item rq-done">
              <div className="rq-item-head">
                <span className="rq-kind">{KIND_LABEL[r.kind] ?? r.kind}</span>
                {r.tenant_name && <b>{r.tenant_name}</b>}
                <span className="rq-when">{r.status === "dismissed" ? "Dismissed" : "Done"}{r.handled_by_name ? ` by ${r.handled_by_name}` : ""}{r.handled_at ? ` · ${when(r.handled_at)}` : ""}</span>
              </div>
              <div className="rq-detail">{r.detail}</div>
              {r.resolution && <div className="rq-resolution">{r.resolution}</div>}
              <div className="rq-verbs">
                <button type="button" className="sb-btn sb-quiet sb-sm" disabled={busyId === r.id} onClick={() => void act(r.id, "open")}>Reopen</button>
              </div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
