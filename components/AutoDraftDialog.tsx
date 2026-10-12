"use client";
// The window before an auto-draft run (Auto-Draft patch 6, spec section 4a and
// 11): how many questions it will touch and how, whether there is enough to
// draft from, and what is missing from the grant context. When Funder context
// is empty it leads with a clear warning and two ways on: add it now, or
// auto-draft anyway. Client context empty is said more quietly.
import { useEffect, useState } from "react";
import { autodraftPreviewAction } from "@/lib/server/autodraft-actions";
import type { AutodraftPreview } from "@/lib/server/autodraft";
import { SKIP_LABEL } from "@/lib/autodraft";

export default function AutoDraftDialog({ draftId, sectionId, questionNumber, onAddContext, onConfirm, onCancel }: {
  draftId: string;
  /** One question (the per-question button), or null for the whole draft. */
  sectionId: string | null;
  questionNumber?: number;
  onAddContext: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<AutodraftPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    autodraftPreviewAction(draftId, sectionId).then(r => { if (!live) return; if (r.ok) setP(r.preview); else setError(r.error); })
      .catch(() => { if (live) setError("Could not reach the portal. Check the connection and try again."); });
    return () => { live = false; };
  }, [draftId, sectionId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const one = sectionId !== null;
  const n = p?.plan.run.length ?? 0;
  const funderMissing = p?.context.funder === "missing";
  const canRun = !!p && p.minimum.met && n > 0;
  const plural = (k: number, a: string, b: string) => `${k} ${k === 1 ? a : b}`;

  return (
    <div className="ws-modal-back" role="presentation" onClick={onCancel}>
      <div className="ws-modal ad-dialog" role="dialog" aria-modal="true" aria-labelledby="ad-title" onClick={e => e.stopPropagation()}>
        <h3 id="ad-title">{one ? `Auto-draft question ${questionNumber ?? ""}`.trim() : "Auto-draft this draft"}</h3>
        {!p && !error && <p className="ov-muted">Checking what it would do&hellip;</p>}
        {error && <div className="ap-error" role="alert">{error}</div>}
        {p && (
          <>
            {funderMissing && p.minimum.met && n > 0 && (
              <div className="ad-warn" role="alert">
                <strong>There is no Funder context yet.</strong> Auto-draft is much more useful and accurate with the funder&rsquo;s
                overview, FAQ and website: it uses them to judge what to lead with and what to leave out.
                <div className="ad-warn-acts">
                  <button type="button" className="btn inline ap-mini" onClick={onAddContext}>Add funder context now</button>
                  <button type="button" className="btn ghost ap-mini" onClick={onConfirm}>Auto-draft anyway</button>
                </div>
              </div>
            )}
            {!p.minimum.met && <div className="ap-error" role="alert">{p.minimum.message}</div>}
            {p.minimum.met && n === 0 && (
              <div className="ap-error" role="alert">
                {one && p.plan.skipped[0] ? `This question is ${SKIP_LABEL[p.plan.skipped[0].reason]}, so auto-draft leaves it alone.` : "There is nothing to auto-draft: every question is marked done or already approved."}
              </div>
            )}
            {n > 0 && p.minimum.met && (
              <ul className="ad-what">
                <li>{one ? "This question" : plural(n, "question", "questions")} will be auto-drafted
                  {p.fromStandard ? `: ${p.fromStandard} from ${p.fromStandard === 1 ? "its" : "their"} approved Standard Answer${p.toArrange ? `, ${p.toArrange} arranged from the Story Cards` : ""}` : ", arranged from the Story Cards"}.</li>
                {!one && p.plan.skipped.length > 0 && <li>{plural(p.plan.skipped.length, "question is", "questions are")} left alone: {[...new Set(p.plan.skipped.map(s => SKIP_LABEL[s.reason]))].join("; ")}.</li>}
                <li>Story Cards only: nothing is written for you. Cards already in an answer stay where they are; new cards follow them. A kind with no card stays a gap, shown under the question.</li>
                <li>It may place cards that still need review. Copy, Mark completed, Mark submitted and approving stay stopped until each is dealt with.</li>
                <li>A version named &ldquo;Before auto-draft&rdquo; is saved first.{one ? " Undo also puts this answer back." : " Restore it from Versions to undo the whole run."}</li>
                {p.toArrange > 0 && <li className="ov-muted">{plural(p.toArrange, "model call", "model calls")}, For Granted&rsquo;s spend, never the client&rsquo;s.{!one ? " It runs on the server; this page can be closed." : ""}</li>}
                {p.context.client === "missing" && <li className="ov-muted">There is no Client context for this draft. Add it from Grant context if the client has said what to lead with or avoid.</li>}
              </ul>
            )}
          </>
        )}
        <div className="ws-modal-acts">
          <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
          {canRun && !funderMissing && <button type="button" className="btn inline ap-go" onClick={onConfirm}>{one ? "Auto-draft this question" : `Auto-draft ${n} question${n === 1 ? "" : "s"}`}</button>}
          {canRun && funderMissing && <button type="button" className="btn secondary" onClick={onAddContext}>Add funder context</button>}
        </div>
      </div>
    </div>
  );
}
