"use client";
// The Living Voice questions (patch 3 of the 1 November 2026 build), with two
// ways to answer: record and upload a transcript, or type the answers here.
// Typed answers are filed as a Layer III note through the same action the
// readiness checklist uses, tagged as the founder or leader interview.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addInvenstoryNoteAction } from "@/lib/server/note-actions";
import {
  voiceSections, promptsAsText, answersToText, answeredCount, VOICE_TIPS, MIN_ANSWER_CHARS,
  type TenantOrgType,
} from "@/lib/living-voice";

export default function LivingVoicePrompts({ orgType, compact = false, onSaved }: {
  orgType: TenantOrgType;
  /** Inside the upload drawer: the questions fold away behind one line. */
  compact?: boolean;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const sections = voiceSections(orgType);
  const [open, setOpen] = useState(!compact);
  const [writing, setWriting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const text = answersToText(orgType, answers);
  const count = answeredCount(orgType, answers);
  const tooShort = text.length < MIN_ANSWER_CHARS;

  const copy = async () => {
    try { await navigator.clipboard.writeText(promptsAsText(orgType)); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setMsg("Copying is blocked in this browser. Select the questions and copy them instead."); }
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await addInvenstoryNoteAction("founder_voice", text);
      setAnswers({}); setWriting(false);
      setMsg("Saved to your Living Voice layer. It is read like any other document.");
      router.refresh();
      onSaved?.();
    } catch {
      setMsg("That did not save. Please try again.");
    } finally { setBusy(false); }
  };

  if (compact && !open) {
    return (
      <div className="lv-box lv-compact">
        <span>Not sure what to say? </span>
        <button type="button" className="fc-link" onClick={() => setOpen(true)}>See the Living Voice questions</button>
      </div>
    );
  }

  return (
    <div className="lv-box">
      <div className="lv-head">
        <h4>What to talk about in your Living Voice</h4>
        <span className="spacer" />
        <button type="button" className="sb-btn sb-secondary sb-sm" onClick={copy}>{copied ? "Copied" : "Copy the questions"}</button>
      </div>
      <ul className="lv-tips">{VOICE_TIPS.map(t => <li key={t}>{t}</li>)}</ul>
      {!writing && (
        <>
          {sections.map(s => (
            <div key={s.key} className="lv-section">
              <div className="lv-title">{s.title}</div>
              <ul>{s.prompts.map(p => <li key={p.key}>{p.question}</li>)}</ul>
            </div>
          ))}
          <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => setWriting(true)}>Answer in writing instead</button>
        </>
      )}
      {writing && (
        <div className="lv-form">
          {sections.map(s => (
            <div key={s.key} className="lv-section">
              <div className="lv-title">{s.title}</div>
              {s.prompts.map(p => (
                <label key={p.key} className="lv-q">
                  <span>{p.question}</span>
                  <textarea rows={3} value={answers[p.key] ?? ""}
                    onChange={e => setAnswers({ ...answers, [p.key]: e.target.value })} />
                </label>
              ))}
            </div>
          ))}
          <div className="lv-actions">
            <button type="button" className="sb-btn sb-primary sb-sm" onClick={save} disabled={busy || tooShort}
              title={tooShort ? "Answer at least one question in a sentence or two first." : undefined}>
              {busy ? "Saving…" : `Save ${count} answer${count === 1 ? "" : "s"} to Living Voice`}
            </button>
            <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setWriting(false)} disabled={busy}>Back to the questions</button>
          </div>
        </div>
      )}
      {msg && <p className="acct-note" role="status" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
