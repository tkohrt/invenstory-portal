"use client";
// The Document Reader's card panel (Phase 1; mockup first and third artboards).
//
// For Granted gets the Card Library's own review card (CardReview), with every
// action it has there, and Inaccurate opening the two-choice "What is wrong?"
// (decision 2). A client gets its card, and when "Act on cards" is on for it:
// Verify, Edit wording, Out of date, and Inaccurate with the passage choice
// only ("The card itself is inaccurate" stays For Granted's). With the switch
// off, a client reads the card and nothing more. The server checks the same
// switch on every action (lib/server/reader-actions.ts).
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CardReview from "./CardReview";
import type { LibraryCard } from "@/lib/server/card-library";
import type { ReaderCard } from "@/lib/server/reader";
import type { ReaderAccess } from "@/lib/reader-features";
import {
  readerConfirmCardAction, readerEditCardAction, readerOutOfDateCardAction, refusePassageAction,
} from "@/lib/server/reader-actions";
import { retireCardAction } from "@/lib/server/card-actions";

const LAYER: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };
const X = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;

export default function ReaderCardPanel({ card, position, library, access, documentId, onClose, onDone }: {
  card: ReaderCard; position: string; library: LibraryCard | null; access: ReaderAccess; documentId: string; onClose: () => void;
  /** A line for the page to show once an action is done (the panel may close as the card leaves). */
  onDone: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const placed = card.spans.length > 0;

  const openDialog = () => { opener.current = document.activeElement as HTMLElement | null; setAsking(true); };

  return (
    <div className="rd-box">
      <div className="rd-box-head">
        <span className="rd-label">{position}</span>
        <button type="button" className="sb-btn sb-quiet sb-icon sb-sm" aria-label="Close the card (Esc)" onClick={onClose}>{X}</button>
      </div>

      {access.admin && library ? (
        <CardReview card={library} onInaccurate={openDialog} />
      ) : (
        <ClientCard key={`${card.id}|${card.statement}|${card.status}`} card={card} access={access} onInaccurate={openDialog} />
      )}

      <div className="rd-sec">
        <span className="rd-label">Source</span>
        {placed ? (
          <p>This document{card.page ? `, page ${card.page}` : ""}. The quote is highlighted.
            {card.places > 1 ? ` The same words appear ${card.places} times in this document; the first is highlighted.` : ""}</p>
        ) : (
          <p>This document, but its quote is not in the text as it reads now: &ldquo;{card.quote}&rdquo;</p>
        )}
        {card.otherSources.length > 0 && (
          <p className="rd-small">Also from {card.otherSources.map((o, i) => (
            <span key={o.documentId}>{i > 0 ? ", " : ""}<Link href={`/documents/${o.documentId}?card=${card.id}`}>{o.title}</Link></span>
          ))}.</p>
        )}
      </div>

      {access.draftLinks && (
        <div className="rd-sec">
          <span className="rd-label">Used in</span>
          {card.usedIn.length === 0 ? <p>Not placed in any draft yet.</p> : (
            <ul className="rd-uses">
              {card.usedIn.map(u => (
                <li key={u.sectionId}>
                  {access.admin
                    ? <Link href={`/drafts/${u.draftId}?q=${u.question}`}>Question {u.question} of {u.draftTitle}</Link>
                    : <>Question {u.question} of {u.draftTitle}</>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {asking && (
        <WhatIsWrong card={card} documentId={documentId} admin={access.admin} onDone={onDone}
          onClose={() => {
            setAsking(false);
            // Back to what opened it, or to the text if that has gone with the card.
            const back = opener.current;
            if (back && back.isConnected) back.focus();
            else document.querySelector<HTMLElement>(".rd-text")?.focus();
          }} />
      )}
    </div>
  );
}

/** A client's view of its card, with the actions its switches allow. */
function ClientCard({ card, access, onInaccurate }: { card: ReaderCard; access: ReaderAccess; onInaccurate: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"view" | "edit" | "outdated">("view");
  const [draft, setDraft] = useState(card.statement);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    setErr(null);
    const r = await fn();
    if (!r.ok) { setErr(r.error); return; }
    setMode("view");
    router.refresh();
  });
  const can = access.cardActions && card.status !== "retired";

  return (
    <div className="rd-cardwrap">
      <div className={`rd-card rd-card-l${card.layer?.length ?? 0}`}>
        <div className="rd-card-head">
          <span className="rd-kind">{card.kindLabel}{card.layer ? <span className="rd-kind-layer"> · {LAYER[card.layer]}</span> : null}</span>
          <span className="rd-spacer" />
          {card.status === "verified"
            ? <span className="rd-status rd-status-ok"><span aria-hidden="true">●</span> Verified</span>
            : card.status === "retired" ? <span className="rd-status">Retired</span>
              : <span className="rd-status rd-status-review"><span aria-hidden="true">●</span> Needs review</span>}
        </div>
        {mode === "edit" ? (
          <label className="rd-field">
            <span className="rd-sr">The card&apos;s wording</span>
            <textarea rows={4} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
          </label>
        ) : <p className="rd-card-st">{card.statement}</p>}
      </div>

      {err && <p className="ap-error">{err}</p>}

      {can && mode === "view" && (
        <div className="rd-acts">
          {card.status !== "verified" && (
            <button type="button" className="sb-btn sb-primary" disabled={pending} onClick={() => run(() => readerConfirmCardAction(card.id))}>Verify</button>
          )}
          <button type="button" className="sb-btn sb-secondary" disabled={pending} onClick={() => setMode("edit")}>Edit wording</button>
          <button type="button" className="sb-btn sb-secondary" disabled={pending} onClick={() => setMode("outdated")}>Out of date</button>
          <button type="button" className="sb-btn sb-quiet rd-danger" disabled={pending} onClick={onInaccurate}>Inaccurate…</button>
        </div>
      )}
      {can && mode === "edit" && (
        <div className="rd-acts">
          <button type="button" className="sb-btn sb-primary" disabled={pending || !draft.trim()} onClick={() => run(() => readerEditCardAction(card.id, draft))}>Save the wording</button>
          <button type="button" className="sb-btn sb-quiet" disabled={pending} onClick={() => { setMode("view"); setDraft(card.statement); }}>Cancel</button>
          <p className="rd-small">Saving also verifies the card. A figure must be in one of its sources.</p>
        </div>
      )}
      {can && mode === "outdated" && (
        <div className="rd-acts rd-acts-col">
          <label className="rd-field">
            <span>What has changed (optional)</span>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="For example: we now serve 14 sites" autoFocus />
          </label>
          <div className="rd-acts">
            <button type="button" className="sb-btn sb-primary" disabled={pending} onClick={() => run(() => readerOutOfDateCardAction(card.id, note))}>Mark out of date</button>
            <button type="button" className="sb-btn sb-quiet" disabled={pending} onClick={() => setMode("view")}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "What is wrong?" (decision 2, 17 October 2026): this passage does not support
 * the card (this source only), or the card itself is inaccurate (For Granted
 * only; retires it everywhere and remembers all its sources, as the Card
 * Library does). When this passage is the card's only source, the first choice
 * says the card will be retired (decision of 17 October 2026).
 */
function WhatIsWrong({ card, documentId, admin, onClose, onDone }: {
  card: ReaderCard; documentId: string; admin: boolean; onClose: () => void; onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const only = card.otherSources.length === 0;

  // Kept in a ref so a parent redraw neither moves focus nor re-adds the listener.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input")?.focus();  // never a choice: Enter must not act by accident
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      // Tab stays inside the dialog.
      if (e.key !== "Tab" || !box.current) return;
      const items = Array.from(box.current.querySelectorAll<HTMLElement>("button:not(:disabled), input"));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keys, true);
    return () => document.removeEventListener("keydown", keys, true);
  }, []);

  const passage = () => start(async () => {
    setErr(null);
    const r = await refusePassageAction(card.id, documentId, why);
    if (!r.ok) { setErr(r.error); return; }
    onDone(r.retired
      ? "Done. That was the card's only source, so the card is retired as no longer supported."
      : "Done. This passage is no longer a source of the card, and the card is back to Needs review.");
    onClose(); router.refresh();
  });
  const whole = () => start(async () => {
    setErr(null);
    try { await retireCardAction(card.id, "inaccurate", why); onDone("Done. The card is retired as inaccurate everywhere."); onClose(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  });

  return (
    <div className="ws-modal-back" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws-modal rd-dialog" role="dialog" aria-modal="true" aria-labelledby="rd-wrong-h" ref={box}>
        <h3 id="rd-wrong-h">What is wrong?</h3>
        <p className="rd-small">&ldquo;{card.statement.length > 140 ? `${card.statement.slice(0, 140)}…` : card.statement}&rdquo;</p>
        <button type="button" className="rd-choice" disabled={pending} onClick={passage}>
          <strong>This passage does not support the card</strong>
          <span>{only
            ? "This is the card's only source, so the card will be retired as no longer supported. This passage is not offered for it again."
            : "Removes this source only. The card stays with its other sources and goes back to Needs review. This passage is not offered for it again."}</span>
        </button>
        {admin && (
          <button type="button" className="rd-choice rd-choice-danger" disabled={pending} onClick={whole}>
            <strong>The card itself is inaccurate</strong>
            <span>Retires the card everywhere, as in the Card Library, and remembers all its sources so it is not proposed again. Cards placed in drafts are flagged.</span>
          </button>
        )}
        <label className="rd-field">
          <span>Why (optional)</span>
          <input type="text" value={why} onChange={e => setWhy(e.target.value)} maxLength={600} placeholder="For example: the meeting is no longer daily" />
        </label>
        {err && <p className="ap-error">{err}</p>}
        <div className="rd-acts rd-acts-end">
          <button type="button" className="sb-btn sb-secondary" disabled={pending} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
