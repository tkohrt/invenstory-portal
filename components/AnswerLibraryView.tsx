"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateAnswersAction, editAnswerAction, markAnswerReviewedAction } from "@/lib/server/answer-actions";
import type { AnswerLibraryItem, Completeness } from "@/lib/types";

const CHIP: Record<Completeness, { label: string; cls: string }> = {
  strong: { label: "Strong", cls: "al-chip strong" },
  partial: { label: "Needs detail", cls: "al-chip partial" },
  missing: { label: "Not started", cls: "al-chip missing" },
};

function Card({ item }: { item: AnswerLibraryItem }) {
  const router = useRouter();
  const { question: q, answer: a, citations } = item;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [short, setShort] = useState(a?.short_answer ?? "");
  const [long, setLong] = useState(a?.long_answer ?? "");
  const [pending, start] = useTransition();
  const comp = a?.completeness ?? "missing";

  const save = () => start(async () => {
    if (short !== (a?.short_answer ?? "")) await editAnswerAction(q.id, "short_answer", short);
    if (long !== (a?.long_answer ?? "")) await editAnswerAction(q.id, "long_answer", long);
    setEditing(false); router.refresh();
  });
  const review = () => start(async () => { await markAnswerReviewedAction(q.id); router.refresh(); });

  return (
    <div className="al-card">
      <div className="al-card-head">
        <div>
          <div className="al-q">{q.prompt_text}</div>
          {q.guidance && <div className="al-guide">{q.guidance}</div>}
        </div>
        <div className="al-flags">
          <span className={CHIP[comp].cls}>{CHIP[comp].label}</span>
          {a && (a.source === "human"
            ? <span className="al-badge human">{a.status === "published" ? "Reviewed" : "Edited"}</span>
            : <span className="al-badge auto">Auto-draft</span>)}
        </div>
      </div>

      {!editing && (
        <div className="al-answer">
          {a?.short_answer
            ? <p className="al-short">{a.short_answer}</p>
            : <p className="al-empty">No draft yet — run “Generate drafts”, or write your answer.</p>}
          {a?.long_answer && (
            <>
              {open && <p className="al-long">{a.long_answer}</p>}
              <button className="al-link" onClick={() => setOpen(o => !o)}>{open ? "Show less" : "Show full answer"}</button>
            </>
          )}
          {citations.length > 0 && (
            <div className="al-cites">Sourced from: {citations.map((c, i) => <span key={c.document_id}>{i > 0 ? ", " : ""}{c.title}</span>)}</div>
          )}
        </div>
      )}

      {editing && (
        <div className="al-edit">
          <label>Short answer (~50 words)</label>
          <textarea value={short} onChange={e => setShort(e.target.value)} rows={2} />
          <label>Full answer (~250 words)</label>
          <textarea value={long} onChange={e => setLong(e.target.value)} rows={5} />
        </div>
      )}

      <div className="al-actions">
        {!editing && <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>}
        {editing && <button className="btn" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</button>}
        {editing && <button className="btn ghost" onClick={() => { setEditing(false); setShort(a?.short_answer ?? ""); setLong(a?.long_answer ?? ""); }}>Cancel</button>}
        {a && a.status !== "published" && !editing && <button className="btn secondary" onClick={review} disabled={pending}>Mark reviewed</button>}
      </div>
    </div>
  );
}

export default function AnswerLibraryView({ items, isAdmin, tenantName }: { items: AnswerLibraryItem[]; isAdmin: boolean; tenantName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const answered = items.filter(i => i.answer && i.answer.completeness !== "missing").length;
  const reviewed = items.filter(i => i.answer?.status === "published").length;
  const total = items.length;
  const pct = total ? Math.round((answered / total) * 100) : 0;

  const generate = () => start(async () => { await generateAnswersAction(); router.refresh(); });

  const cats = [...new Set(items.map(i => i.question.category))];

  return (
    <div>
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · viewing {tenantName}</div>}
      <div className="page-head">
        <div>
          <h2>Answer Library</h2>
          <p>
            Most grant applications ask variations of the same core questions. Answer them well
            once here — drawing on your Inven(s)tory — and every new application starts from a
            high-quality draft instead of a blank page.
          </p>
        </div>
        <button className="btn" onClick={generate} disabled={pending}>{pending ? "Generating…" : "Generate drafts"}</button>
      </div>

      <div className="al-meter">
        <div className="al-meter-row">
          <span>Grant profile completeness</span><span>{answered} of {total} answered · {reviewed} reviewed</span>
        </div>
        <div className="al-bar"><div className="al-bar-fill" style={{ width: `${pct}%` }} /></div>
      </div>

      {cats.map(cat => (
        <div key={cat} className="al-cat">
          <div className="section-label">{cat}</div>
          {items.filter(i => i.question.category === cat).map(i => <Card key={i.question.id} item={i} />)}
        </div>
      ))}
    </div>
  );
}
