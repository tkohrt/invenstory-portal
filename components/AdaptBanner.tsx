"use client";
// The note on an application question whose Standard Answer auto-draft adapted
// for this funder (Auto-Draft patch 7, spec section 4b): what changed, See what
// changed (the two side by side, changes marked), and the three choices. Once
// chosen it becomes a quiet line. Rules in lib/sa-adapt.ts; actions in
// lib/server/sa-adapt-actions.ts.
import { useEffect, useRef, useState } from "react";
import { compareAdaptationAction } from "@/lib/server/sa-adapt-actions";
import { adaptationLive, adaptationOpen, summaryLine, wordDiff, type SaAdaptation } from "@/lib/sa-adapt";

export default function AdaptBanner({ sectionId, adaptation: a, pieceIds, locked, onKeep, onUpdate, onRevert }: {
  sectionId: string; adaptation: SaAdaptation; pieceIds: string[]; locked: boolean;
  onKeep: () => void; onUpdate: () => void; onRevert: () => void;
}) {
  const [seeing, setSeeing] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  // Nothing to say once the answer no longer holds what auto-draft placed.
  if (!adaptationLive(a, pieceIds)) return null;
  const what = summaryLine(a.summary);

  if (!adaptationOpen(a, pieceIds)) {
    return (
      <div className="sa-note sa-decided" role="note">
        <span>Adapted from the Standard Answer{what ? ` (${what})` : ""}: {a.state === "kept"
          ? "kept for this grant only."
          : "also copied into Standard Answers as its working version, waiting to be approved there. The approved answer stays in use until then."}</span>
        <button type="button" className="fc-link" onClick={() => setSeeing(true)}>See what changed</button>
        {a.state === "kept" && !locked && <button type="button" className="fc-link" onClick={() => setConfirmUpdate(true)}>Also update the Standard Answer</button>}
        {confirmUpdate && <UpdateConfirm onYes={() => { setConfirmUpdate(false); onUpdate(); }} onNo={() => setConfirmUpdate(false)} />}
        {seeing && <Compare sectionId={sectionId} onClose={() => setSeeing(false)} />}
      </div>
    );
  }

  return (
    <div className="sa-note sa-open" role="status">
      <div className="sa-head">
        <strong>Adapted from your Standard Answer for this funder.</strong>
        {what && <span> {what.charAt(0).toUpperCase() + what.slice(1)}.</span>}
        <span className="ov-muted"> Should the client&rsquo;s Standard Answer change too? This answer can&rsquo;t leave until you choose.</span>
      </div>
      <div className="sa-acts">
        <button type="button" className="btn ghost ap-mini" onClick={() => setSeeing(true)}>See what changed</button>
        <button type="button" className="btn secondary ap-mini" disabled={locked} onClick={onKeep}
          title="The change stays in this application; the Standard Answer is unchanged.">Keep for this grant only</button>
        <button type="button" className="btn secondary ap-mini" disabled={locked} onClick={() => setConfirmUpdate(true)}
          title="Copy this answer into Standard Answers as its new working version, to approve there.">Also update the Standard Answer</button>
        <button type="button" className="btn ghost ap-mini" disabled={locked} onClick={onRevert}
          title="Put the Standard Answer back as it was copied in. Undo brings this version back.">Go back to the Standard Answer</button>
      </div>
      {confirmUpdate && <UpdateConfirm onYes={() => { setConfirmUpdate(false); onUpdate(); }} onNo={() => setConfirmUpdate(false)} />}
      {seeing && <Compare sectionId={sectionId} onClose={() => setSeeing(false)} />}
    </div>
  );
}

function UpdateConfirm({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="sa-confirm" role="alertdialog" aria-label="Also update the Standard Answer">
      <p>This answer becomes the working version of that question in Standard Answers. It goes back to unapproved and must be
        approved again there; until then the old approved answer stays in use. A version of Standard Answers is saved first.</p>
      <div className="sa-acts">
        <button type="button" className="btn inline ap-mini" onClick={onYes}>Update the Standard Answer</button>
        <button type="button" className="btn ghost ap-mini" onClick={onNo}>Cancel</button>
      </div>
    </div>
  );
}

function Compare({ sectionId, onClose }: { sectionId: string; onClose: () => void }) {
  const [texts, setTexts] = useState<{ before: string; after: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Held in a ref so a new onClose on each render of the page does not read the comparison again.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    let live = true;
    compareAdaptationAction(sectionId).then(r => { if (!live) return; if (r.ok) setTexts({ before: r.before, after: r.after }); else setError(r.error); })
      .catch(() => { if (live) setError("Could not reach the portal. Check the connection and try again."); });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { live = false; window.removeEventListener("keydown", onKey); };
  }, [sectionId]);
  const parts = texts ? wordDiff(texts.before, texts.after) : [];
  return (
    <div className="ws-modal-back" role="presentation" onClick={onClose}>
      <div className="ws-modal sa-compare" role="dialog" aria-modal="true" aria-labelledby="sa-compare-title" onClick={e => e.stopPropagation()}>
        <h3 id="sa-compare-title">What changed from the Standard Answer</h3>
        {error && <div className="ap-error" role="alert">{error}</div>}
        {!texts && !error && <p className="ov-muted">Loading&hellip;</p>}
        {texts && (
          <div className="sa-cols">
            <div>
              <h4>The Standard Answer</h4>
              <div className="sa-text">{parts.filter(p => p.kind !== "add").map((p, i) => p.kind === "del" ? <del key={i}>{p.text}</del> : <span key={i}>{p.text}</span>)}</div>
            </div>
            <div>
              <h4>This answer</h4>
              <div className="sa-text">{parts.filter(p => p.kind !== "del").map((p, i) => p.kind === "add" ? <ins key={i}>{p.text}</ins> : <span key={i}>{p.text}</span>)}</div>
            </div>
          </div>
        )}
        <p className="ov-muted sa-key">Struck through: taken out or reworded. Highlighted: added or reworded.</p>
        <div className="ws-modal-acts"><button type="button" className="btn secondary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
