"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveQuestionAction, deleteQuestionAction } from "@/lib/server/answer-actions";
import type { GrantQuestion, Audience } from "@/lib/types";

const BLANK = { category: "", prompt_text: "", guidance: "", audience: "both" as Audience, sort_order: 100, active: true };

function Editor({ initial, onDone }: { initial: typeof BLANK & { id?: string }; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [pending, start] = useTransition();
  const save = () => start(async () => { await saveQuestionAction(f); onDone(); router.refresh(); });
  return (
    <div className="aq-editor">
      <div className="aq-grid">
        <label>Category<input value={f.category} onChange={e => setF({ ...f, category: e.target.value })} /></label>
        <label>Audience
          <select value={f.audience} onChange={e => setF({ ...f, audience: e.target.value as Audience })}>
            <option value="both">Both</option><option value="nonprofit">Nonprofit</option><option value="startup">Startup</option>
          </select>
        </label>
        <label>Sort order<input type="number" value={f.sort_order} onChange={e => setF({ ...f, sort_order: Number(e.target.value) })} /></label>
        <label className="aq-check"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>
      </div>
      <label>Question prompt<textarea rows={2} value={f.prompt_text} onChange={e => setF({ ...f, prompt_text: e.target.value })} /></label>
      <label>Guidance (optional)<textarea rows={2} value={f.guidance} onChange={e => setF({ ...f, guidance: e.target.value })} /></label>
      <div className="al-actions">
        <button className="btn" onClick={save} disabled={pending || !f.prompt_text || !f.category}>{pending ? "Saving…" : "Save"}</button>
        <button className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export default function AdminQuestionsView({ questions }: { questions: GrantQuestion[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [, start] = useTransition();
  const remove = (id: string) => start(async () => { if (confirm("Delete this question for all clients?")) { await deleteQuestionAction(id); router.refresh(); } });

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Question bank</h2>
          <p>The shared grant-question set every client&apos;s Answer Library is built from. For Granted IP — changes apply to all clients.</p>
        </div>
        {!adding && <button className="btn" onClick={() => setAdding(true)}>Add question</button>}
      </div>
      {adding && <Editor initial={BLANK} onDone={() => setAdding(false)} />}
      <table className="aq-table">
        <thead><tr><th>Prompt</th><th>Category</th><th>Audience</th><th>Sort</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {questions.map(q => editId === q.id ? (
            <tr key={q.id}><td colSpan={6}><Editor initial={{ id: q.id, category: q.category, prompt_text: q.prompt_text, guidance: q.guidance ?? "", audience: q.audience, sort_order: q.sort_order, active: q.active }} onDone={() => setEditId(null)} /></td></tr>
          ) : (
            <tr key={q.id} className={q.active ? "" : "aq-inactive"}>
              <td>{q.prompt_text}</td><td>{q.category}</td><td>{q.audience}</td><td>{q.sort_order}</td><td>{q.active ? "Yes" : "No"}</td>
              <td className="aq-row-actions">
                <button className="btn ghost" onClick={() => setEditId(q.id)}>Edit</button>
                <button className="btn ghost" onClick={() => remove(q.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
