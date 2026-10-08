"use client";
// One Story Card, with everything a reviewer can do to it: verify, edit,
// retire as inaccurate or out of date, reinstate, decide a sensitive card, and
// merge a possible duplicate.
//
// Shared, so a card is reviewed the same way wherever it is met: in the Card
// Library, and in the Storyboard when an unverified card is dropped into an
// answer (decided 2 October 2026: a card goes into a grant only once verified).
// `onAction` tells the page what the reviewer did, so the Storyboard can place
// the card the moment it is verified. Editing counts as verifying.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LibraryCard } from "@/lib/server/card-library";
import { USER_GENERATED } from "@/lib/user-card";
import {
  verifyCardAction, unverifyCardAction, editCardAction, retireCardAction,
  reinstateCardAction, mergeCardAction, dismissDuplicateAction, clearSensitiveAction, reopenSensitiveAction,
} from "@/lib/server/card-actions";
import { CLEARANCE_LABEL } from "@/lib/card-sensitivity";

const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };
const RETIRED_WHY: Record<string, string> = {
  source_removed: "its source document is gone or no longer says this",
  superseded: "out of date",
  inaccurate: "marked inaccurate",
  merged: "merged into another card",
};

/** What the reviewer just did. "verified" covers an edit too: editing counts as verifying. */
export type ReviewOutcome = "verified" | "unverified" | "retired" | "reinstated" | "sensitive_cleared" | "sensitive_reopened" | "merged";

export default function CardReview({ card: c, byId, onAction, verifyLabel = "Verify", editSaveLabel }: {
  card: LibraryCard;
  /** The library's other cards, for duplicates and merges. Absent outside the library. */
  byId?: Map<string, LibraryCard>;
  onAction?: (what: ReviewOutcome) => void;
  /** "Verify and place" in the Storyboard. */
  verifyLabel?: string;
  editSaveLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.statement);
  const [open, setOpen] = useState(false);
  const [retiring, setRetiring] = useState<"inaccurate" | "superseded" | null>(null);
  const [retireNote, setRetireNote] = useState("");
  const [clearing, setClearing] = useState<"consent" | "deidentified" | "not_sensitive" | null>(null);
  const [clearNote, setClearNote] = useState("");

  const act = (fn: () => Promise<unknown>, what?: ReviewOutcome) => start(async () => {
    setErr(null);
    try {
      await fn();
      if (what && onAction) onAction(what); else router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  });

  const dup = c.possibleDuplicateOf ? byId?.get(c.possibleDuplicateOf) : undefined;
  const layerClass = c.layer ? `cl-l${c.layer.length}` : "cl-l0";
  const cls = `cl-card ${layerClass}${c.strength === "thin" ? " cl-thin" : ""}${c.status === "verified" ? " cl-verified" : ""}${c.status === "retired" ? " cl-retired" : ""}`;

  return (
    <div className={cls}>
      <div className="cl-card-head">
        <span className="cl-kind">{c.kindLabel}</span>
        {c.createdFrom === "manual" && <span className="uc-tag" title={c.sourceLine ?? undefined}>{USER_GENERATED}{c.writtenByRole === "admin" && !c.clientConfirmedAt ? " · client to confirm" : ""}</span>}
        {c.layer && <span className="cl-layer">{LAYER_NAME[c.layer]}</span>}
        <span className="cl-spacer" />
        {c.sensitive && !c.sensitiveCleared && c.status !== "retired" && <span className="cl-badge cl-badge-sens" title={c.sensitiveReason ?? ""}>Sensitive</span>}
        {c.status === "verified" && <span className="cl-badge cl-badge-ok">{c.verifiedByRole === "client" ? "Verified by client" : "Verified"}</span>}
        {c.status === "suggested" && <span className="cl-badge">Suggested</span>}
        {c.status === "retired" && <span className="cl-badge cl-badge-off">Retired</span>}
      </div>

      {editing ? (
        <div className="cl-edit">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} />
          <div className="cl-card-acts">
            <button type="button" className="btn inline cl-primary" disabled={pending}
              onClick={() => act(async () => { await editCardAction(c.id, draft); setEditing(false); }, "verified")}
              title="Saving an edit also verifies the card">{editSaveLabel ?? "Save and verify"}</button>
            <button type="button" className="btn ghost" disabled={pending} onClick={() => { setEditing(false); setDraft(c.statement); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="cl-statement">{c.statement}</p>
      )}

      <div className="cl-tags">
        <span>{c.strength === "covered" ? "Specific" : "General"}</span>
        {c.hasFigures && <span>Has figures</span>}
        {c.subject === "third_party" && <span title="The quote is about or by someone outside the organization">Outside voice</span>}
        {c.statementOrigin === "human" && <span title={`Edited by For Granted; version ${c.version}`}>Edited v{c.version}</span>}
        <button type="button" className="cl-link" onClick={() => setOpen(o => !o)}>
          {open ? "Hide" : "Show"} {c.evidence.length} source{c.evidence.length === 1 ? "" : "s"}
        </button>
      </div>

      {open && (
        <ul className="cl-evidence">
          {c.evidence.length === 0 && <li className="cl-note">No live source. It was read from a document that is gone or has changed.</li>}
          {c.evidence.map(e => (
            <li key={e.documentId}>
              <div className="cl-quote">{`“${e.quote}”`}</div>
              <div className="cl-src">
                {e.title}{e.layer ? ` · ${LAYER_NAME[e.layer] ?? e.layer}` : ""}{e.speaker ? ` · ${e.speaker}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}

      {c.status === "retired" && (
        <p className="cl-note">Retired: {RETIRED_WHY[c.retiredReason ?? ""] ?? c.retiredReason ?? "no reason recorded"}
          {c.mergedInto && byId?.get(c.mergedInto) ? ` (“${byId.get(c.mergedInto)!.statement.slice(0, 80)}…”)` : ""}.
          {c.retiredNote ? <> Note: {c.retiredNote}</> : null}</p>
      )}

      {c.sensitive && c.status !== "retired" && (
        <div className={`cl-sens${c.sensitiveCleared ? " cl-sens-done" : ""}`}>
          {c.sensitiveCleared ? (
            <>
              <strong>{CLEARANCE_LABEL[c.sensitiveCleared]}.</strong>{c.sensitiveNote ? ` ${c.sensitiveNote}` : ""}
              <button type="button" className="cl-link" disabled={pending} onClick={() => act(() => reopenSensitiveAction(c.id), "sensitive_reopened")}>Reopen</button>
            </>
          ) : (
            <>
              <strong>Sensitive: cannot be placed in an answer yet.</strong> {c.sensitiveReason}
              {clearing ? (
                <div className="cl-edit">
                  <textarea rows={2} value={clearNote} onChange={e => setClearNote(e.target.value)}
                    placeholder={clearing === "consent" ? "Who consented, when, and how (for example: Terry, by email to Ted, 3 Oct 2026)"
                      : clearing === "deidentified" ? "Optional: what was removed" : "Why this is not sensitive"} />
                  <div className="cl-card-acts">
                    <button type="button" className="btn inline cl-primary" disabled={pending}
                      onClick={() => act(async () => { await clearSensitiveAction(c.id, clearing, clearNote); setClearing(null); setClearNote(""); }, "sensitive_cleared")}>
                      Record: {CLEARANCE_LABEL[clearing].toLowerCase()}</button>
                    <button type="button" className="btn ghost" onClick={() => setClearing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="cl-card-acts">
                  <button type="button" className="btn secondary" onClick={() => setClearing("consent")}>Record consent</button>
                  <button type="button" className="btn secondary" disabled={c.statementOrigin !== "human"}
                    title={c.statementOrigin !== "human" ? "Edit the card to remove what identifies the person first" : undefined}
                    onClick={() => setClearing("deidentified")}>Mark de-identified</button>
                  <button type="button" className="btn ghost" onClick={() => setClearing("not_sensitive")}>Not sensitive</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {dup && c.status !== "retired" && (
        <div className="cl-dup">
          <div className="cl-dup-head">Possibly the same claim as:</div>
          <p>{dup.statement}</p>
          <div className="cl-card-acts">
            <button type="button" className="btn secondary" disabled={pending}
              onClick={() => act(() => mergeCardAction(c.id, dup.id), "merged")}>Merge this into that one</button>
            <button type="button" className="btn secondary" disabled={pending}
              onClick={() => act(() => mergeCardAction(dup.id, c.id), "merged")}>Merge that one into this</button>
            <button type="button" className="btn ghost" disabled={pending}
              onClick={() => act(() => dismissDuplicateAction(c.id))}>Not the same</button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="cl-card-acts">
          {c.status === "suggested" && (
            <button type="button" className="btn inline cl-primary" disabled={pending} onClick={() => act(() => verifyCardAction(c.id), "verified")}>{verifyLabel}</button>
          )}
          {c.status === "verified" && (
            <button type="button" className="btn ghost" disabled={pending} onClick={() => act(() => unverifyCardAction(c.id), "unverified")}>Undo verify</button>
          )}
          {c.status !== "retired" && (
            <>
              <button type="button" className="btn ghost" disabled={pending} onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="btn ghost" disabled={pending} onClick={() => setRetiring("inaccurate")}>Inaccurate</button>
              <button type="button" className="btn ghost" disabled={pending} onClick={() => setRetiring("superseded")}>Out of date</button>
            </>
          )}
          {c.status === "retired" && (
            <button type="button" className="btn ghost" disabled={pending} onClick={() => act(() => reinstateCardAction(c.id), "reinstated")}>Reinstate</button>
          )}
        </div>
      )}
      {retiring && (
        <div className="cl-edit">
          <textarea rows={2} value={retireNote} onChange={e => setRetireNote(e.target.value)} autoFocus
            placeholder={retiring === "inaccurate" ? "Optional: what is wrong with it" : "Optional: what has changed, or what replaces it"} />
          {retiring === "inaccurate" && (
            <p className="cl-note">Its quotes are remembered and refused on every later read, so the claim cannot come back
              reworded. Reinstating the card forgets them.</p>
          )}
          <div className="cl-card-acts">
            <button type="button" className="btn inline cl-primary" disabled={pending}
              onClick={() => act(async () => { await retireCardAction(c.id, retiring, retireNote); setRetiring(null); setRetireNote(""); }, "retired")}>
              Retire as {retiring === "inaccurate" ? "inaccurate" : "out of date"}</button>
            <button type="button" className="btn ghost" onClick={() => { setRetiring(null); setRetireNote(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div className="cl-error">{err}</div>}
    </div>
  );
}
