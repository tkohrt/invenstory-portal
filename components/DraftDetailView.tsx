"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerBracketAction, setDraftStatusAction } from "@/lib/server/draft-actions";
import type { DraftStatus, DraftWithBrackets } from "@/lib/types";

const FLOW: DraftStatus[] = ["drafting", "client_review", "submitted", "won", "lost"];
const LABEL: Record<DraftStatus, string> = {
  drafting: "Drafting", client_review: "With client", submitted: "Submitted", won: "Won", lost: "Lost",
};
const money = (c: number | null) => c == null ? null : "$" + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

// Render the draft body, turning [BRACKET] tokens into inline chips
// (filled = answered).
function renderBody(body: string, filled: Set<string>, onJump: (label: string) => void) {
  const parts: React.ReactNode[] = [];
  let last = 0; let i = 0;
  for (const m of body.matchAll(/\[([^\]]+)\]/g)) {
    const label = m[1].trim();
    if (m.index! > last) parts.push(body.slice(last, m.index));
    parts.push(
      <span key={i++} className={`bracket-token${filled.has(label) ? " filled" : ""}`} onClick={() => onJump(label)}>
        {filled.has(label) ? label : `[${label}]`}
      </span>
    );
    last = m.index! + m[0].length;
  }
  parts.push(body.slice(last));
  return parts;
}

export default function DraftDetailView({ tenantName, draft, isAdmin }: {
  tenantName: string; draft: DraftWithBrackets; isAdmin: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const filled = new Set(draft.brackets.filter(b => b.answer).map(b => b.label));

  const submitAnswer = async (bracketId: string, label: string) => {
    const text = (answers[bracketId] ?? "").trim();
    if (!text) return;
    setBusy(bracketId);
    await answerBracketAction(draft.id, bracketId, text);
    setBusy(null);
    router.refresh();
  };
  const changeStatus = async (status: DraftStatus) => {
    setBusy("status");
    await setDraftStatusAction(draft.id, status);
    setBusy(null);
    router.refresh();
  };
  const jump = (label: string) => document.getElementById("q-" + label)?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn ghost" style={{ padding: "2px 4px", marginBottom: 4 }} onClick={() => router.push("/drafts")}>← In the Works</button>
          <h2>{draft.title}</h2>
          <p>{[draft.funder, money(draft.amount_cents), draft.deadline ? `due ${new Date(draft.deadline).toLocaleDateString()}` : null].filter(Boolean).join(" · ")}</p>
        </div>
      </div>

      <div className="status-row">
        <span className={`status-pill ${draft.status}`}>{LABEL[draft.status]}</span>
        {isAdmin && <>
          <span className="tp-sub" style={{ margin: 0 }}>Set status:</span>
          {FLOW.map(st => (
            <button key={st} className="chip" style={{ opacity: draft.status === st ? 1 : 0.7 }}
              disabled={!!busy} onClick={() => changeStatus(st)}>{LABEL[st]}</button>
          ))}
        </>}
      </div>

      {draft.brackets.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="cite-label" style={{ borderTop: "none", paddingTop: 0 }}>
            {draft.answered_count} of {draft.brackets.length} questions answered — each answer files into your Inven(s)tory
          </div>
          {draft.brackets.map(b => (
            <div key={b.id} id={"q-" + b.label} className={`qcard${b.answer ? " filled" : ""}`}>
              <h4>{b.label}</h4>
              {b.answer
                ? <div className="answered">✓ {b.answer}<div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>Filed to your Inven(s)tory as “Answer: {b.label}”.</div></div>
                : <div>
                    <textarea placeholder={`Provide: ${b.label}`} value={answers[b.id] ?? ""}
                      onChange={e => setAnswers({ ...answers, [b.id]: e.target.value })} style={{ minHeight: 60 }} />
                    <button className="btn inline" style={{ marginTop: 6 }} disabled={busy === b.id}
                      onClick={() => submitAnswer(b.id, b.label)}>{busy === b.id ? "Filing…" : "Answer & file to Inven(s)tory"}</button>
                  </div>}
            </div>
          ))}
        </div>
      )}

      <div className="cite-label" style={{ borderTop: "none" }}>Draft narrative</div>
      <div className="draft-body">{renderBody(draft.body, filled, jump)}</div>
      {draft.outcome_note && <div className="gap-note" style={{ marginTop: 12 }}><b>Outcome:</b> {draft.outcome_note}</div>}
    </div>
  );
}
