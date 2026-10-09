"use client";
// Questions For Granted asked from the Storyboard (0058, 9 October 2026), on
// the client's Inven(s)tory page. The client answers in their own words; the
// answer is saved as a user-generated Story Card they wrote, and For Granted is
// told. For Granted, viewing the client, sees the same list and can withdraw a
// question still waiting.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerAskAction, withdrawAskAction } from "@/lib/server/ask-actions";
import { USER_CARD_WORDS, USER_GENERATED } from "@/lib/user-card";
import type { ClientAskItem } from "@/lib/server/asks";

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export default function ClientAsks({ asks, isAdmin, tenantName }: { asks: ClientAskItem[]; isAdmin: boolean; tenantName: string }) {
  const open = asks.filter(a => a.status === "open");
  const answered = asks.filter(a => a.status === "answered");
  return (
    <section className="ca" aria-label="Questions from For Granted">
      <div className="ca-head">
        <strong>{open.length ? `For Granted has ${open.length === 1 ? "a question" : `${open.length} questions`} for you` : "Thank you for your answers"}</strong>
        <span className="ov-muted">
          {isAdmin
            ? `${tenantName} sees these here. Each answer becomes a ${USER_GENERATED} Story Card written by them.`
            : "We are drafting an application and need a little more in your own words. Each answer is saved in your Inven(s)tory."}
        </span>
      </div>
      {open.map(a => <AskRow key={a.id} ask={a} isAdmin={isAdmin} />)}
      {answered.length > 0 && (
        <details className="ca-done">
          <summary>{answered.length} answered recently</summary>
          {answered.map(a => (
            <div key={a.id} className="ca-row ca-answered">
              <span className="ov-tag">{a.kindLabel}</span>
              <p className="ca-q">{a.question}</p>
              <p className="ca-a">{a.answer}</p>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

function AskRow({ ask, isAdmin }: { ask: ClientAskItem; isAdmin: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const n = words(text);
  const send = async () => {
    setBusy(true); setError(null);
    const r = await answerAskAction(ask.id, text).catch(() => null);
    setBusy(false);
    if (!r) { setError("Could not send your answer. Please try again."); return; }
    if (!r.ok) { setError(r.error); return; }
    setSent(true);
    router.refresh();
  };
  const withdraw = async () => {
    setBusy(true);
    const r = await withdrawAskAction(ask.id).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setError(r && !r.ok ? r.error : "Could not withdraw it."); return; }
    router.refresh();
  };
  if (sent) return <div className="ca-row ca-thanks" role="status">Thank you. Your answer is saved in your Inven(s)tory, and For Granted has been told.</div>;
  return (
    <div className="ca-row">
      <div className="ca-row-head">
        <span className="ov-tag">{ask.kindLabel}</span>
        <span className="ov-muted">Asked {new Date(ask.askedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</span>
      </div>
      <p className="ca-q">{ask.question}</p>
      {isAdmin ? (
        <div className="ca-acts">
          <span className="ov-muted">Waiting for the client&rsquo;s answer. Only they answer here, in their own words.</span>
          <span className="spacer" />
          <button type="button" className="btn ghost ap-mini" disabled={busy} onClick={() => void withdraw()}>Withdraw the question</button>
        </div>
      ) : (
        <>
          <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Your answer, in your own words"
            aria-label={`Your answer: ${ask.question}`} />
          <div className="ca-acts">
            <span className={`ov-muted${n > USER_CARD_WORDS.max ? " ca-over" : ""}`}>{n} word{n === 1 ? "" : "s"} (between {USER_CARD_WORDS.min} and {USER_CARD_WORDS.max})</span>
            <span className="spacer" />
            <button type="button" className="btn inline" disabled={busy || n < USER_CARD_WORDS.min || n > USER_CARD_WORDS.max} onClick={() => void send()}>
              {busy ? "Sending…" : "Send answer"}</button>
          </div>
        </>
      )}
      {error && <div className="ap-error">{error}</div>}
    </div>
  );
}
