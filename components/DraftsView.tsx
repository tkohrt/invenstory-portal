"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveDraftAction } from "@/lib/server/draft-actions";
import { openStandardAnswersAction } from "@/lib/server/workspace-actions";
import Drawer from "./Drawer";
import type { DraftStatus, DraftWithBrackets } from "@/lib/types";

const STATUS_LABEL: Record<DraftStatus, string> = {
  drafting: "Drafting", client_review: "With client", submitted: "Submitted", won: "Won", lost: "Lost",
};
const money = (c: number | null) => c == null ? null : "$" + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function DraftsView({ tenantName, drafts, isAdmin }: {
  tenantName: string; drafts: DraftWithBrackets[]; isAdmin: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const openStandard = async () => {
    setOpening(true); setOpenError(null);
    try {
      const r = await openStandardAnswersAction();
      router.push(`/drafts/${r.draftId}${r.added && r.since ? `?since=${encodeURIComponent(r.since)}` : ""}`);
    }
    catch (e) { setOpenError(e instanceof Error ? e.message : "Could not open Standard Answers."); setOpening(false); }
  };
  return (
    <div>
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · {tenantName}</div>}
      <div className="page-head">
        <div><h2>In the Works</h2><p>Grant applications For Granted is preparing for {tenantName}. Answer the highlighted questions and they file straight into your Inven(s)tory.</p></div>
        <div className="spacer" />
        {isAdmin && <>
          <button className="btn inline" onClick={() => router.push("/drafts/new")}
            title="Bring in a funder's application and draft it from Story Cards. For Granted only.">＋ From a funder&rsquo;s application</button>
          <button className="btn secondary" onClick={() => void openStandard()} disabled={opening}
            title="The questions funders ask again and again, answered once from Story Cards and approved into the Answer Library. For Granted only.">
            {opening ? "Opening…" : "Standard Answers"}</button>
          <button className="btn secondary" onClick={() => setCreating(true)}>＋ New draft</button>
        </>}
      </div>
      {openError && <div className="ap-error" role="alert">{openError}</div>}
      {drafts.length === 0 && <div className="empty">No drafts yet.{isAdmin ? " Create one to get started." : " For Granted will post applications here as they're prepared."}</div>}
      <div className="draft-cols">
        {drafts.map(d => {
          const pct = d.brackets.length ? Math.round((d.answered_count / d.brackets.length) * 100) : 100;
          return (
            <div key={d.id} className="doc-card draft-card" onClick={() => router.push(`/drafts/${d.id}`)}>
              <span className={`status-pill ${d.status}`}>{STATUS_LABEL[d.status]}</span>
              {d.mode === "cards" && (
                <span className="ov-tag" style={{ marginLeft: 6 }} title="Built from the funder's application. For Granted only; the client does not see it.">
                  {d.purpose === "standard_answers" ? "Standard Answers"
                    : d.confirmed_at ? "Drafting from cards" : d.parsed_at ? "Questions to confirm" : "Reading the application"}
                </span>
              )}
              <h4 style={{ marginTop: 10 }}>{d.title}</h4>
              <div className="dc-meta">
                {d.funder && <span>{d.funder}</span>}
                {money(d.amount_cents) && <span><b>{money(d.amount_cents)}</b></span>}
                {d.deadline && <span>due {new Date(d.deadline).toLocaleDateString()}</span>}
              </div>
              {d.brackets.length > 0 && (
                <div>
                  <div className="dc-meta"><span>{d.answered_count}/{d.brackets.length} questions answered</span></div>
                  <div className="draft-progress"><i style={{ width: `${pct}%` }} /></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {creating && <NewDraftDrawer onClose={() => setCreating(false)} onSaved={id => { setCreating(false); router.push(`/drafts/${id}`); }} />}
    </div>
  );
}

function NewDraftDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ title: "", funder: "", amountDollars: "", deadline: "", body: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.title.trim()) return;
    setBusy(true);
    const r = await saveDraftAction(f);
    setBusy(false);
    onSaved(r.id);
  };
  return (
    <Drawer onClose={onClose}>
      <h3>New grant draft</h3>
      <p style={{ color: "var(--muted)", marginTop: 2 }}>Use <span className="bracket-token">[square brackets]</span> in the narrative for anything the client needs to fill in — each becomes a question.</p>
      <label>Title</label><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. ODH SUD Transportation Grant" />
      <label>Funder</label><input value={f.funder} onChange={e => setF({ ...f, funder: e.target.value })} />
      <label>Amount (USD)</label><input value={f.amountDollars} onChange={e => setF({ ...f, amountDollars: e.target.value })} placeholder="50000" />
      <label>Deadline</label><input type="date" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} />
      <label>Draft narrative</label>
      <textarea style={{ minHeight: 160 }} value={f.body} onChange={e => setF({ ...f, body: e.target.value })}
        placeholder="Our organization serves [target population] in [service area]. Last year we delivered [number of rides] rides…" />
      <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Create draft"}</button>
    </Drawer>
  );
}
