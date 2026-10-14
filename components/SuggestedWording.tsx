"use client";
// Suggested wording on a card (Auto-Draft patch 8, spec section 6): the card's
// own words with auto-draft's suggestion shown as a tracked change, and Accept,
// Edit and Reject. Used under a card in Arrange and in Weave's piece window.
// The suggestion is never part of the answer until it is accepted; accepting
// makes it this draft's own edit of the card and does not verify the card.
import { useState } from "react";
import { wordDiff } from "@/lib/sa-adapt";

export default function SuggestedWording({ current, suggested, locked, onAccept, onReject }: {
  current: string; suggested: string; locked: boolean;
  onAccept: (text?: string) => Promise<unknown>; onReject: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  const parts = wordDiff(current, suggested);

  return (
    <div className="sw-box" role="group" aria-label="Suggested wording">
      <div className="sw-head">
        <strong>Suggested wording</strong>
        <span className="ov-muted"> Auto-draft suggests these words for this funder. The card&rsquo;s own words stay in the answer until you choose.</span>
      </div>
      {editing ? (
        <div className="cl-edit">
          <textarea rows={Math.max(3, Math.ceil(text.length / 80))} value={text} autoFocus
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { setText(suggested); setEditing(false); } }} />
          <div className="cl-card-acts">
            <button type="button" className="btn inline cl-primary" disabled={busy || !text.trim()} onClick={() => void run(() => onAccept(text))}>Use this wording</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => { setText(suggested); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="sw-diff">
          {parts.map((p, i) => p.kind === "same" ? <span key={i}>{p.text}</span>
            : p.kind === "del" ? <del key={i}>{p.text}</del>
            : <ins key={i}>{p.text}</ins>)}
        </p>
      )}
      {!locked && !editing && (
        <div className="cl-card-acts">
          <button type="button" className="btn inline ap-go ap-mini" disabled={busy} onClick={() => void run(() => onAccept())}>Accept</button>
          <button type="button" className="btn secondary ap-mini" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="btn ghost ap-mini" disabled={busy} onClick={() => void run(onReject)}>Reject</button>
          <span className="ov-muted">Accepting changes this draft only. The card in the library is unchanged and still needs its own review.</span>
        </div>
      )}
    </div>
  );
}
