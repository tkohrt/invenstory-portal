"use client";
// The gap panel (9 October 2026): under each question, every kind of card the
// question calls for, and where it stands. A kind not in the answer yet can be
// found in the Story Cards (Show them), written now as a user-generated card
// (Add it now), or asked of the client (Ask the client); once the client
// answers, the card their answer made is offered here (Use it).
import { useEffect, useState } from "react";
import { askDraft, askProblem, type DraftProgress, type GapRow } from "@/lib/draft-gaps";
import { CARD_KIND_MAP } from "@/lib/story-card";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

export default function GapPanel({ rows, locked, onShow, onAdd, onAsk, onUse, onWithdraw }: {
  rows: GapRow[]; locked: boolean;
  onShow: (kind: string) => void; onAdd: (kind: string) => void; onAsk: (kind: string) => void;
  onUse: (cardId: string) => void; onWithdraw: (askId: string) => void;
}) {
  const label = (k: string) => CARD_KIND_MAP[k]?.label ?? k;
  const inAnswer = rows.filter(r => r.state === "in_answer").length;
  const settled = inAnswer === rows.length;
  return (
    <details className="gp" open={!settled}>
      <summary>
        <span className="ov-muted">Calls for:</span>{" "}
        {rows.map(r => (
          <span key={r.kind} className={`ov-tag ap-kind gp-k gp-${r.state}`}>{r.state === "in_answer" ? "✓ " : ""}{label(r.kind)}</span>
        ))}
        <span className="ov-muted gp-sum">{settled ? "all in the answer" : `${inAnswer} of ${rows.length} in the answer`}</span>
      </summary>
      <ul className="gp-rows">
        {rows.map(r => (
          <li key={r.kind} className={`gp-row gp-${r.state}`}>
            <span className="gp-name">{label(r.kind)}</span>
            {r.state === "in_answer" && <span className="gp-what">✓ In the answer</span>}
            {r.state === "answered" && r.ask && (
              <>
                <span className="gp-what">The client answered: <em>&ldquo;{(r.ask.answer ?? "").slice(0, 140)}{(r.ask.answer ?? "").length > 140 ? "…" : ""}&rdquo;</em></span>
                {!locked && r.ask.cardId && <button type="button" className="btn inline ap-go ap-mini" onClick={() => onUse(r.ask!.cardId!)}>Use it</button>}
              </>
            )}
            {r.state === "asked" && r.ask && (
              <>
                <span className="gp-what" title={r.ask.question}>Asked the client on {day(r.ask.askedAt)}; waiting for their answer.</span>
                {!locked && <button type="button" className="btn ghost ap-mini" onClick={() => onWithdraw(r.ask!.id)}>Withdraw</button>}
              </>
            )}
            {r.state === "in_library" && (
              <>
                <span className="gp-what">{r.inLibrary} in the Story Cards, not used here.</span>
                <button type="button" className="btn secondary ap-mini" onClick={() => onShow(r.kind)}>Show them</button>
                {!locked && <button type="button" className="btn ghost ap-mini" onClick={() => onAdd(r.kind)}>Add it now</button>}
              </>
            )}
            {r.state === "none" && (
              <>
                <span className="gp-what gp-missing">No card yet.</span>
                {!locked && <button type="button" className="btn secondary ap-mini" onClick={() => onAdd(r.kind)}
                  title="Write it yourself now; it is saved as a User-generated Story Card">Add it now</button>}
                {!locked && <button type="button" className="btn ghost ap-mini" onClick={() => onAsk(r.kind)}
                  title="Ask the client to answer in their own words, on their Inven(s)tory page">Ask the client</button>}
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Writing the question to the client, ready to edit. */
export function AskDialog({ kind, prompt, tenantName, onSend, onCancel }: {
  kind: string; prompt: string; tenantName: string;
  onSend: (question: string) => Promise<string | null>; onCancel: () => void;
}) {
  const k = CARD_KIND_MAP[kind];
  const [text, setText] = useState(() => askDraft(prompt, k?.label ?? kind, k?.describe ?? "a few sentences on this"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const problem = askProblem(text);
  const send = async () => {
    setBusy(true); setError(null);
    const err = await onSend(text.trim());
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <div className="ws-modal-back" role="presentation" onClick={onCancel}>
      <div className="ws-modal" role="dialog" aria-modal="true" aria-labelledby="gp-ask" onClick={e => e.stopPropagation()}>
        <h3 id="gp-ask">Ask {tenantName}: {k?.label ?? kind}</h3>
        <p className="ov-muted">They will see this on their Inven(s)tory page and answer in their own words. Their answer is saved as a
          User-generated Story Card they wrote, and comes back here, ready to use. You will be told by email and Slack.</p>
        <textarea className="gp-ask-text" rows={5} value={text} onChange={e => setText(e.target.value)} autoFocus />
        {error && <div className="ap-error">{error}</div>}
        <div className="ws-modal-acts">
          <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn inline ap-go" disabled={busy || !!problem} title={problem ?? undefined}
            onClick={() => void send()}>{busy ? "Sending…" : "Send the question"}</button>
        </div>
      </div>
    </div>
  );
}

/** Where the whole application stands, with a way to each thing still to do. */
export function ProgressStrip({ p, started, onReview, onBridges, onFigures, onAsks }: {
  p: DraftProgress; started: number;
  onReview: () => void; onBridges: () => void; onFigures: () => void; onAsks: () => void;
}) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const clear = !p.toReview && !p.bridgesWaiting && !p.figuresToTrace && !p.asksOpen && !p.answersReady;
  return (
    <div className="ws-progress-strip" role="status" aria-label="Progress">
      <span className="wps-item wps-done">
        <span className="wps-bar" aria-hidden="true"><span style={{ width: `${p.questions ? Math.round((p.done / p.questions) * 100) : 0}%` }} /></span>
        {p.done} of {p.questions} questions done{started > p.done ? ` · ${started - p.done} in progress` : ""}
      </span>
      {p.toReview > 0 && <button type="button" className="wps-item wps-warn" onClick={onReview}>{plural(p.toReview, "card to review", "cards to review")}</button>}
      {p.bridgesWaiting > 0 && <button type="button" className="wps-item" onClick={onBridges}>{plural(p.bridgesWaiting, "bridge waiting", "bridges waiting")}</button>}
      {p.figuresToTrace > 0 && <button type="button" className="wps-item wps-warn" onClick={onFigures}>{plural(p.figuresToTrace, "figure to trace", "figures to trace")}</button>}
      {p.answersReady > 0 && <button type="button" className="wps-item wps-good" onClick={onAsks}>{plural(p.answersReady, "client answer to use", "client answers to use")}</button>}
      {p.asksOpen > 0 && <button type="button" className="wps-item" onClick={onAsks}>{plural(p.asksOpen, "question waiting on the client", "questions waiting on the client")}</button>}
      {clear && p.done < p.questions && <span className="wps-item ov-muted">Nothing waiting on review</span>}
    </div>
  );
}
