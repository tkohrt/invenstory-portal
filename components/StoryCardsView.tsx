"use client";
// A client's Story Cards.
//
// The cards For Granted's reading found in the client's own documents, each a
// single claim with the quote behind it. New cards come up in short batches to
// look through one at a time: "yes, that's right", correct the wording, or "out
// of date". Seeing a card often brings back a story nobody has written down,
// which is why the page ends by inviting the client to add it.
//
// Everything a client does here is visible to For Granted in the Card Library:
// a confirmation reads "Verified by client", a correction is a new version, and
// out of date is kept with the note so it can be brought back.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmMyCardAction, editMyCardAction, outOfDateMyCardAction } from "@/lib/server/client-card-actions";
import { confirmUserCardAction } from "@/lib/server/user-card-actions";
import { USER_GENERATED } from "@/lib/user-card";
import type { ClientCard } from "@/lib/server/client-cards";

const BATCH = 10;
const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };

export default function StoryCardsView({ orgName, cards, isAdmin }: { orgName: string; cards: ClientCard[]; isAdmin: boolean }) {
  const waiting = useMemo(() => cards.filter(c => c.status === "suggested"), [cards]);
  const [batch, setBatch] = useState<string[]>(() => waiting.slice(0, BATCH).map(c => c.id));
  const [at, setAt] = useState(0);
  const [kind, setKind] = useState("");
  const [userOnly, setUserOnly] = useState(false);
  const router = useRouter();
  const [confirming, startConfirm] = useTransition();
  const byId = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  const current = batch[at] ? byId.get(batch[at]) : undefined;
  const reviewing = !!current;
  const kinds = [...new Map(cards.map(c => [c.kind, c.kindLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = cards.filter(c => (!kind || c.kind === kind) && (!userOnly || c.userGenerated));
  const toConfirm = cards.filter(c => c.toConfirm);

  return (
    <div className="sc">
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · seeing what {orgName} sees</div>}
      <div className="page-head">
        <div>
          <h2>Story Cards</h2>
          <p>Short, single claims about {orgName}, each taken from your own documents with the quote that backs it up.
            For Granted builds your applications from these, so the more of them are right and current, the better every application starts.</p>
        </div>
        <div className="spacer" />
        <a className="btn ghost" href="/api/export/cards" title="Every card with its sources, as a spreadsheet">⬇ Download (.csv)</a>
      </div>

      {reviewing ? (
        <section className="sc-deck" aria-label="Cards to look through">
          <div className="sc-deck-head">
            <strong>{waiting.length} new card{waiting.length === 1 ? "" : "s"} to look at.</strong>
            <span className="ov-muted">Card {at + 1} of {batch.length} in this batch</span>
          </div>
          <ReviewCard key={current.id} card={current} onDone={() => setAt(i => i + 1)} />
        </section>
      ) : waiting.length > 0 ? (
        <div className="ws-notice">
          {batch.length ? "That batch is done. " : ""}{waiting.length} card{waiting.length === 1 ? " is" : "s are"} still waiting.{" "}
          <button type="button" className="btn secondary ap-mini" onClick={() => {
            // Cards not yet shown come first; skipped ones come round again after.
            const unseen = waiting.filter(c => !batch.includes(c.id));
            setBatch((unseen.length ? unseen : waiting).slice(0, BATCH).map(c => c.id));
            setAt(0);
          }}>Look at the next {Math.min(BATCH, waiting.length)}</button>
        </div>
      ) : (
        <div className="ws-notice">Nothing new to look at. Thank you: every card has been checked.</div>
      )}

      <p className="sc-invite">Did a card remind you of a story, a result or a number that is not here yet? Add it to your
        Inven(s)tory as a note or a document, and it will become a card the next time your library is updated.</p>

      {toConfirm.length > 0 && (
        <div className="ws-notice">For Granted wrote {toConfirm.length} card{toConfirm.length === 1 ? "" : "s"} about {orgName} from what you have told us.
          Each is marked &ldquo;{USER_GENERATED}&rdquo; below with a Confirm button: press it if it is right, or tell us what to change.</div>
      )}

      <div className="cl-filters">
        <strong style={{ marginRight: 6 }}>All your cards ({cards.length})</strong>
        <button type="button" className={`chip${userOnly ? " active" : ""}`} onClick={() => setUserOnly(v => !v)}
          title="Cards a person wrote, not ones read from your documents">{USER_GENERATED}</button>
        <select className="cl-select" value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">
          <option value="">Every kind</option>
          {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="cl-grid">
        {shown.map(c => (
          <div key={c.id} className={`cl-card ${c.layer ? `cl-l${c.layer.length}` : "cl-l0"}`}>
            <div className="cl-card-head">
              <span className="cl-kind">{c.kindLabel}</span>
              {c.layer && <span className="cl-layer">{LAYER_NAME[c.layer]}</span>}
              {c.userGenerated && <span className="uc-tag" title={c.sourceLine ?? undefined}>{USER_GENERATED}</span>}
              <span className="cl-spacer" />
              {c.toConfirm ? <span className="cl-badge">To confirm</span> : c.status === "verified" ? <span className="cl-badge cl-badge-ok">Confirmed</span> : <span className="cl-badge">New</span>}
            </div>
            <p className="cl-statement">{c.statement}</p>
            {c.userGenerated && c.sourceLine && <div className="cl-src">{c.sourceLine}</div>}
            {c.toConfirm && !isAdmin && (
              <div className="cl-card-acts">
                <button type="button" className="btn inline cl-primary" disabled={confirming}
                  onClick={() => startConfirm(async () => { await confirmUserCardAction(c.id); router.refresh(); })}>Confirm, this is right</button>
              </div>
            )}
            {c.evidence[0] && <div className="cl-src">From {c.evidence[0].title}{c.evidence.length > 1 ? ` and ${c.evidence.length - 1} more` : ""}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ card: c, onDone }: { card: ClientCard; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"look" | "edit" | "old">("look");
  const [text, setText] = useState(c.statement);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => start(async () => {
    setErr(null);
    try { await fn(); onDone(); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not save."); }
  });

  return (
    <div className={`sc-card ${c.layer ? `cl-l${c.layer.length}` : ""}`}>
      <div className="cl-card-head"><span className="cl-kind">{c.kindLabel}</span>{c.layer && <span className="cl-layer">{LAYER_NAME[c.layer]}</span>}</div>
      {mode === "edit"
        ? <textarea rows={4} value={text} onChange={e => setText(e.target.value)} autoFocus />
        : <p className="sc-statement">{c.statement}</p>}
      <ul className="cl-evidence">
        {c.evidence.map((e, i) => <li key={i}><div className="cl-quote">{`“${e.quote}”`}</div><div className="cl-src">{e.title}</div></li>)}
      </ul>
      {c.sensitive && !c.sensitiveCleared && (
        <p className="ws-warn ws-soft">This card may identify someone&rsquo;s private information. For Granted will confirm consent,
          or remove what identifies them, before it is ever used in an application.</p>
      )}
      {mode === "old" && (
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} autoFocus placeholder="Optional: what has changed?" />
      )}
      {err && <div className="cl-error">{err}</div>}
      <div className="cl-card-acts sc-acts">
        {mode === "look" && <>
          <button type="button" className="btn inline cl-primary" disabled={pending} onClick={() => act(() => confirmMyCardAction(c.id))}>Yes, this is right</button>
          <button type="button" className="btn secondary" disabled={pending} onClick={() => setMode("edit")}>Correct the wording</button>
          <button type="button" className="btn secondary" disabled={pending} onClick={() => setMode("old")}>Out of date</button>
          <button type="button" className="btn ghost" disabled={pending} onClick={onDone}>Skip for now</button>
        </>}
        {mode === "edit" && <>
          <button type="button" className="btn inline cl-primary" disabled={pending}
            onClick={() => act(async () => { await editMyCardAction(c.id, text); await confirmMyCardAction(c.id); })}>Save and confirm</button>
          <button type="button" className="btn ghost" onClick={() => { setMode("look"); setText(c.statement); }}>Cancel</button>
        </>}
        {mode === "old" && <>
          <button type="button" className="btn inline cl-primary" disabled={pending} onClick={() => act(() => outOfDateMyCardAction(c.id, note))}>Mark out of date</button>
          <button type="button" className="btn ghost" onClick={() => setMode("look")}>Cancel</button>
        </>}
      </div>
    </div>
  );
}
