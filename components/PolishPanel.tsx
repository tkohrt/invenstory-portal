"use client";
// Polish (Storyboarding Tool, Phase 4; Shane, 9 October 2026). Rules in lib/polish.ts.
//
// Nothing runs until Begin Polishing. Then, for this answer:
//   Length       over the limit: shorter wording for pieces (drafted with AI,
//                each checked in code) and pieces that could be dropped. Both
//                are offers; nothing changes until accepted.
//   Figures      every number its sources do not hold. Each stops the answer
//                leaving until it is changed, traced, or cleared by a person
//                (optional reason; who and when are kept).
//   Repetition   two pieces saying the same thing in the same words.
// The lists follow the answer as it changes, so fixing a piece clears its line.
import { useState } from "react";
import { CLEAR_REASON_MAX, type DropOption, type FigureFlag, type Repeat, type ShortenProposal } from "@/lib/polish";

export interface PolishRun { at: number; aiRan: boolean; proposals: ShortenProposal[]; refused: number; original: Record<string, string> }

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
const clip = (t: string, n = 90) => { const x = t.replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

export default function PolishPanel({ run, locked, count, limit, unit, standard, drops, flags, repeated, textOf, labelOf, whoCleared, current,
  onBegin, onAccept, onAcceptAll, onDrop, onOpen, onClear, onRestore }: {
  run: PolishRun | null; locked: boolean;
  count: number; limit: number | null; unit: "words" | "characters"; standard: boolean;
  drops: DropOption[]; flags: FigureFlag[]; repeated: Repeat[];
  /** The piece's words now, and a short name for it ("Program model", "Your words"). */
  textOf: (blockId: string) => string | null; labelOf: (blockId: string) => string;
  whoCleared: (f: FigureFlag) => string;
  /** The block's words now, for a proposal: shown only while the piece reads as it did when shortened. */
  current: (blockId: string) => string | null;
  onBegin: () => void;
  onAccept: (p: ShortenProposal) => void; onAcceptAll: (ps: ShortenProposal[]) => void;
  onDrop: (ids: string[]) => void; onOpen: (blockId: string) => void;
  onClear: (f: FigureFlag, reason: string) => Promise<string | null>; onRestore: (f: FigureFlag) => void;
}) {
  if (!run) {
    return (
      <div className="pl pl-start">
        <div>
          <strong>Polish checks this answer before it goes out.</strong>{" "}
          Its length against the {standard ? "typical length" : "limit"}, with shorter wording and pieces you could drop if it is over;
          every number against the sources behind it; and wording repeated between pieces. Nothing runs until you begin, and nothing
          changes unless you accept it. Drafting shorter wording uses a small part of the monthly AI allowance; the other checks are free.
        </div>
        <button type="button" className="btn inline ap-go" disabled={locked} onClick={onBegin}>Begin Polishing</button>
      </div>
    );
  }
  const over = limit ? count - limit : 0;
  const live = run.proposals.filter(p => current(p.blockId) === run.original[p.blockId]);
  const open = flags.filter(f => !f.cleared), cleared = flags.filter(f => f.cleared);
  return (
    <div className="pl">
      <div className="pl-head">
        <strong>Polish</strong>
        <span className="ov-muted">checked at {new Date(run.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}; the lists follow your changes</span>
        <span className="spacer" />
        <button type="button" className="btn ghost ap-mini" disabled={locked} onClick={onBegin}
          title={over > 0 ? "Check again, and draft shorter wording again (a small part of the AI allowance)" : "Check again"}>Polish again</button>
      </div>

      <section className="pl-sec">
        <h4 className={over > 0 ? "pl-bad" : "pl-good"}>
          {!limit ? `Length: ${count.toLocaleString()} ${unit}, no limit stated`
            : over > 0 ? `Length: ${count.toLocaleString()} of ${limit.toLocaleString()} ${unit}, ${over.toLocaleString()} over`
            : `Length: ${count.toLocaleString()} of ${limit.toLocaleString()} ${unit}, within the ${standard ? "typical length" : "limit"}`}
        </h4>
        {over > 0 && (
          <>
            <div className="pl-sub">Shorter wording</div>
            {!run.aiRan && <p className="ov-muted">This answer was within the limit when you began. Press Polish again to draft shorter wording.</p>}
            {run.aiRan && !live.length && (
              <p className="ov-muted">{run.proposals.length ? "Every suggestion has been used or the piece has changed since." : "No piece could be shortened without losing its point."}
                {run.refused ? ` ${run.refused} more ${run.refused === 1 ? "was" : "were"} set aside unseen for changing a number, name or quotation.` : ""}</p>
            )}
            {live.map(p => (
              <div key={p.blockId} className="pl-prop">
                <div className="pl-prop-head"><span className="ov-tag">{labelOf(p.blockId)}</span><span className="ov-muted">saves {p.saves} {unit}</span></div>
                <p className="pl-was">{run.original[p.blockId]}</p>
                <p className="pl-now">{p.text}</p>
                {!locked && (
                  <div className="cl-card-acts">
                    <button type="button" className="btn inline ap-go ap-mini" onClick={() => onAccept(p)}>Use this wording</button>
                    <button type="button" className="btn ghost ap-mini" onClick={() => onOpen(p.blockId)}>Edit it myself</button>
                  </div>
                )}
              </div>
            ))}
            {live.length > 1 && !locked && (
              <button type="button" className="btn secondary ap-mini" onClick={() => onAcceptAll(live)}>
                Use all {live.length} (saves {live.reduce((n, p) => n + p.saves, 0)} {unit})</button>
            )}
            {live.length > 0 && <p className="ov-muted pl-note">A card&rsquo;s shorter wording is this draft&rsquo;s own edit; the card in the library is unchanged. It keeps every number and name, and adds none.</p>}

            <div className="pl-sub">Or take out</div>
            {!drops.length && <p className="ov-muted">No piece or two would bring it under on their own.</p>}
            {drops.map(d => (
              <div key={d.blockIds.join(",")} className="pl-drop">
                <span>{d.blockIds.map(id => `${labelOf(id)}: “${clip(textOf(id) ?? "", 70)}”`).join(" and ")}</span>
                <span className="ov-muted">saves {d.saves}, leaving {d.after.toLocaleString()}</span>
                {!locked && <button type="button" className="btn ghost ap-mini ap-del" onClick={() => onDrop(d.blockIds)}>Take {d.blockIds.length === 1 ? "it" : "them"} out</button>}
              </div>
            ))}
          </>
        )}
      </section>

      <section className="pl-sec">
        <h4 className={open.length ? "pl-bad" : "pl-good"}>
          {open.length ? `Numbers: ${open.length} without a source` : flags.length ? "Numbers: all traced or cleared" : "Numbers: every one traced to its source"}
        </h4>
        {open.length > 0 && <p className="ov-muted pl-note">Until each is changed, traced or cleared, this answer cannot be copied, approved, or marked completed or submitted.</p>}
        {open.map(f => <FlagRow key={`${f.blockId}|${f.figure}`} f={f} locked={locked} label={labelOf(f.blockId)} text={textOf(f.blockId) ?? ""}
          onOpen={() => onOpen(f.blockId)} onClear={r => onClear(f, r)} />)}
        {cleared.map(f => (
          <div key={`${f.blockId}|${f.figure}`} className="pl-flag pl-cleared">
            <span className="pl-fig">{f.figure}</span>
            <span>in {labelOf(f.blockId)}: cleared by {whoCleared(f)} on {day(f.cleared!.at)}{f.cleared!.reason ? `: ${f.cleared!.reason}` : ""}</span>
            {!locked && <button type="button" className="cl-link" onClick={() => onRestore(f)}>Put the flag back</button>}
          </div>
        ))}
      </section>

      <section className="pl-sec">
        <h4 className={repeated.length ? "pl-warn" : "pl-good"}>{repeated.length ? `Repetition: ${repeated.length} place${repeated.length === 1 ? "" : "s"}` : "Repetition: none found"}</h4>
        {repeated.map(r => (
          <div key={`${r.a}|${r.b}`} className="pl-rep">
            <span><em>&ldquo;{r.phrase}&rdquo;</em> appears in both {labelOf(r.a)} and {labelOf(r.b)}.</span>
            <button type="button" className="cl-link" onClick={() => onOpen(r.b)}>Open the second</button>
          </div>
        ))}
      </section>
    </div>
  );
}

function FlagRow({ f, locked, label, text, onOpen, onClear }: {
  f: FigureFlag; locked: boolean; label: string; text: string; onOpen: () => void; onClear: (reason: string) => Promise<string | null>;
}) {
  const [clearing, setClearing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const at = text.indexOf(f.figure);
  const around = at < 0 ? clip(text, 120) : `${at > 50 ? "…" : ""}${text.slice(Math.max(0, at - 50), at)}`;
  const after = at < 0 ? "" : `${text.slice(at + f.figure.length, at + f.figure.length + 50)}${text.length > at + f.figure.length + 50 ? "…" : ""}`;
  return (
    <div className="pl-flag">
      <div className="pl-flag-line">
        <span className="pl-fig">{f.figure}</span>
        <span className="pl-ctx">{label}: {around}{at >= 0 && <mark>{f.figure}</mark>}{after}</span>
      </div>
      <div className="ov-muted pl-why">{f.where === "card" ? "Not in this card's sources." : "Not in the sources of any card in this answer."}</div>
      {!locked && !clearing && (
        <div className="cl-card-acts">
          <button type="button" className="btn ghost ap-mini" onClick={onOpen}>Change it</button>
          <button type="button" className="btn secondary ap-mini" onClick={() => setClearing(true)}>It&rsquo;s right: clear it</button>
        </div>
      )}
      {clearing && (
        <div className="pl-clear">
          <input value={reason} maxLength={CLEAR_REASON_MAX} onChange={e => setReason(e.target.value)} autoFocus
            placeholder="Why it is right (optional): for example, the 2026 budget, page 2" aria-label="Why the number is right (optional)" />
          <button type="button" className="btn inline ap-mini" disabled={busy} onClick={async () => {
            setBusy(true); setErr(null);
            const e = await onClear(reason);
            setBusy(false);
            if (e) setErr(e); else setClearing(false);
          }}>{busy ? "Clearing…" : "Clear it"}</button>
          <button type="button" className="btn ghost ap-mini" onClick={() => { setClearing(false); setReason(""); }}>Cancel</button>
        </div>
      )}
      {err && <div className="ap-error">{err}</div>}
    </div>
  );
}

