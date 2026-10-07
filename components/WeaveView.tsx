"use client";
// Weave: the answer as prose (Storyboarding Tool, Phase 4).
//
// Shane's design, 7 October 2026: in Weave a Story Card shows only its words,
// inside the paragraph, with its layer's coloured border and rounded corners
// and a pale wash of the same colour behind the text, so it reads almost like a
// highlight. Everything else about a card (its kind, review state, sources,
// Edit, Remove) opens when the card's text is clicked, and closes again.
//
// A bridge Weave proposed reads in grey italic with Accept and Reject beside
// it; once accepted it is ordinary text, marked only in Show seams. A writer's
// own words are ordinary text too. Any piece can be clicked to open it.
import { useEffect, useRef, useState } from "react";
import { placeable } from "@/lib/card-sensitivity";
import { placeIssue, ISSUE_LABEL, type GateCard } from "@/lib/card-gate";
import { untracedFigures } from "@/lib/story-card";
import type { WsBlock, WsCard } from "@/lib/server/workspace";

const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };
const layerClass = (l: string | null | undefined) => (l === "I" ? "l1" : l === "II" ? "l2" : l === "III" ? "l3" : "l0");

export interface WeaveHandlers {
  onAccept: (blockId: string | null) => Promise<unknown>;
  onEdit: (blockId: string, text: string) => Promise<unknown>;
  /** Removing goes through the page's own question-and-Undo path. */
  onRemove: (blockId: string) => void;
  onReview: (cardId: string) => void;
  onRefresh: (blockId: string) => Promise<unknown>;
  onKeep: (blockId: string) => Promise<unknown>;
}

export default function WeaveView({ blocks, cardById, gateCard, locked, handlers }: {
  blocks: WsBlock[]; cardById: Map<string, WsCard>; gateCard: (id: string) => GateCard | null; locked: boolean;
  handlers: WeaveHandlers;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  // A click anywhere outside the answer closes the open piece; Escape too.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  // Paragraphs, as the writer set them in Arrange.
  const paras: WsBlock[][] = [];
  blocks.forEach((b, i) => {
    if (i === 0 || b.breakBefore) paras.push([b]);
    else paras[paras.length - 1].push(b);
  });

  const toggle = (id: string) => setOpen(o => (o === id ? null : id));
  const keyOpen = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(id); }
  };

  return (
    <div className="wv" ref={root} aria-label="The answer, woven">
      {paras.map((p, pi) => {
        const openHere = p.find(b => b.id === open);
        return (
          <div key={p[0].id} className="wv-para-wrap">
            <p className="wv-para">
              {p.map((b, i) => {
                const sep = i > 0 ? " " : "";
                const text = b.kind === "human" ? b.text.trim() : b.text.replace(/\s+/g, " ").trim();
                if (b.kind === "card") {
                  const card = b.cardId ? cardById.get(b.cardId) : undefined;
                  const issue = b.cardId ? placeIssue(gateCard(b.cardId)) : "retired";
                  const reworded = !b.edited && !!card && b.cardVersion != null && b.cardVersion < card.version;
                  return (
                    <span key={b.id}>{sep}
                      <span role="button" tabIndex={0} aria-expanded={open === b.id}
                        className={`wv-card ${layerClass(card?.layer)}${open === b.id ? " wv-open" : ""}${issue || reworded ? " wv-flag" : ""}`}
                        title={issue ? `This card is ${ISSUE_LABEL[issue]}. Click to see it.` : reworded ? "Reworded in the library since it was placed. Click to choose." : undefined}
                        onClick={() => toggle(b.id)} onKeyDown={keyOpen(b.id)}>{text}</span>
                    </span>
                  );
                }
                if (b.kind === "bridge" && b.proposed) {
                  return (
                    <span key={b.id}>{sep}
                      <span className={`wv-bridge-prop${open === b.id ? " wv-open" : ""}`}>
                        <span role="button" tabIndex={0} aria-expanded={open === b.id} className="wv-bridge-text"
                          title="A bridge Weave proposed. Not part of the answer until you accept it."
                          onClick={() => toggle(b.id)} onKeyDown={keyOpen(b.id)}>{text}</span>
                        {!locked && (
                          <span className="wv-bridge-acts">
                            <button type="button" className="wv-mini wv-yes" onClick={() => void handlers.onAccept(b.id)} aria-label="Accept this bridge" title="Accept">✓</button>
                            <button type="button" className="wv-mini wv-no" onClick={() => handlers.onRemove(b.id)} aria-label="Reject this bridge" title="Reject">✕</button>
                          </span>
                        )}
                      </span>
                    </span>
                  );
                }
                return (
                  <span key={b.id}>{sep}
                    <span role="button" tabIndex={0} aria-expanded={open === b.id}
                      className={`wv-plain${b.kind === "bridge" ? " wv-bridge" : " wv-own"}${open === b.id ? " wv-open" : ""}${!text ? " ws-placeholder" : ""}`}
                      onClick={() => toggle(b.id)} onKeyDown={keyOpen(b.id)}>{text || "(empty text)"}</span>
                  </span>
                );
              })}
            </p>
            {openHere && (
              <Details key={openHere.id} block={openHere} card={openHere.cardId ? cardById.get(openHere.cardId) : undefined}
                gateCard={gateCard} locked={locked} handlers={handlers} onClose={() => setOpen(null)} last={pi === paras.length - 1} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Everything about one piece, opened under its paragraph. */
function Details({ block: b, card, gateCard, locked, handlers, onClose }: {
  block: WsBlock; card?: WsCard; gateCard: (id: string) => GateCard | null; locked: boolean;
  handlers: WeaveHandlers; onClose: () => void; last: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(b.text);
  const [showSrc, setShowSrc] = useState(false);
  const isCard = b.kind === "card";
  const issue = isCard && b.cardId ? placeIssue(gateCard(b.cardId)) : null;
  const reworded = isCard && !b.edited && !!card && b.cardVersion != null && b.cardVersion < card.version;
  const untraced = isCard && b.edited && card ? untracedFigures(b.text, card.evidence.map(e => e.quote).join("\n")) : [];

  const save = async () => {
    setEditing(false);
    if (text.trim() !== b.text.trim() || (b.kind === "bridge" && b.proposed)) await handlers.onEdit(b.id, text);
  };

  const title = isCard ? (card?.kindLabel ?? "Story Card")
    : b.kind === "human" ? "Your words"
    : b.proposed ? "Bridge, proposed" : b.edited ? "Bridge, edited by you" : "Bridge, accepted";

  return (
    <div className={`wv-details ${isCard ? layerClass(card?.layer) : "l0"}`} role="region" aria-label={title}>
      <div className="wv-d-head">
        <span className="cl-kind">{title}</span>
        {isCard && card?.layer && <span className="cl-layer">{LAYER_NAME[card.layer]}</span>}
        {isCard && !issue && <span className="cl-badge cl-badge-ok">Verified</span>}
        {isCard && issue === "unverified" && <span className="cl-badge ws-badge-review">Needs review</span>}
        {isCard && issue === "retired" && <span className="ov-tag ws-tag-sens">Retired card</span>}
        {isCard && card && !placeable(card) && <span className="ov-tag ws-tag-sens" title={card.sensitiveReason ?? ""}>Sensitive, undecided</span>}
        {isCard && b.edited && <span className="ov-tag" title="Changed in this draft only. The library card is unchanged.">Edited here</span>}
        <span className="cl-spacer" />
        <button type="button" className="bn-x" onClick={onClose} aria-label="Close">×</button>
      </div>

      {b.kind === "bridge" && !editing && (
        <p className="ov-muted wv-d-note">{b.proposed
          ? "Drafted to lead from the piece before to the piece after. It adds no facts, numbers or names: anything that would was set aside before you saw it. It is not part of the answer until you accept it."
          : "Part of the answer. Show seams marks it as a bridge."}</p>
      )}

      {editing ? (
        <div className="cl-edit">
          <textarea rows={Math.max(2, Math.ceil(text.length / 80))} value={text} autoFocus
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { setText(b.text); setEditing(false); } }} />
          <div className="cl-card-acts">
            <button type="button" className="btn inline cl-primary" onClick={() => void save()}>{b.kind === "bridge" && b.proposed ? "Save and accept" : "Save"}</button>
            <button type="button" className="btn ghost" onClick={() => { setText(b.text); setEditing(false); }}>Cancel</button>
            {isCard && <span className="ov-muted">Changes this draft only. The library card stays as it is.</span>}
          </div>
        </div>
      ) : (
        <div className="wv-d-acts">
          {b.kind === "bridge" && b.proposed && !locked && (
            <button type="button" className="btn inline ap-go ap-mini" onClick={() => void handlers.onAccept(b.id).then(onClose)}>Accept</button>
          )}
          {isCard && issue && issue !== "retired" && b.cardId && (
            <button type="button" className="btn secondary ap-mini" onClick={() => handlers.onReview(b.cardId!)}>Review</button>
          )}
          {!locked && <button type="button" className="btn secondary ap-mini" onClick={() => { setText(b.text); setEditing(true); }}>Edit</button>}
          {!locked && (
            <button type="button" className="btn ghost ap-mini ap-del" onClick={() => { onClose(); handlers.onRemove(b.id); }}>
              {b.kind === "bridge" && b.proposed ? "Reject" : "Remove"}
            </button>
          )}
          {isCard && b.edited && !locked && (
            <button type="button" className="cl-link" onClick={() => void handlers.onRefresh(b.id)}
              title="Drop the edit and use the card's current wording from the library">Use the card&rsquo;s wording</button>
          )}
          {isCard && card && (
            <button type="button" className="cl-link" onClick={() => setShowSrc(v => !v)}>{showSrc ? "Hide sources" : `Sources (${card.evidence.length})`}</button>
          )}
        </div>
      )}

      {reworded && !locked && (
        <div className="ws-warn ws-soft">
          This card was reworded in the library since you placed it, so this answer cannot leave until you choose.{" "}
          <button type="button" className="cl-link" onClick={() => void handlers.onRefresh(b.id)}>Use the new wording</button>{" "}
          or <button type="button" className="cl-link" onClick={() => void handlers.onKeep(b.id)}>keep this wording</button>
        </div>
      )}
      {untraced.length > 0 && (
        <div className="ws-warn">{untraced.join(", ")} {untraced.length === 1 ? "is" : "are"} not in this card&rsquo;s sources. The figure audit in Polish will stop the export until it is traced or removed.</div>
      )}
      {showSrc && card && (
        <ul className="cl-evidence">
          {card.evidence.length === 0 && <li className="cl-note">No live source: its document is gone or changed.</li>}
          {card.evidence.map((e, i) => (
            <li key={i}>
              <div className="cl-quote">{`“${e.quote}”`}</div>
              <div className="cl-src">{e.title}{e.layer ? ` · ${LAYER_NAME[e.layer] ?? e.layer}` : ""}{e.speaker ? ` · ${e.speaker}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
