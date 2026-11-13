"use client";
// Curated list sweeps (P2.5, patch 39): the admin card on the Ground Truth
// tab. Load a list once, approve its entries in the queue below, sweep every
// community member, and the matched clients hear about it on their Funding
// page. Membership is managed here too, until the client-facing consent
// switch lands with the signed-off copy.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCuratedListAction, sweepCuratedListAction, setCommunityMemberAction } from "@/lib/server/curated-actions";
import type { CuratedListRow } from "@/lib/server/curated";

export default function AdminCuratedLists({ lists, clients }: {
  lists: CuratedListRow[];
  clients: { id: string; name: string; member: boolean }[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", sourceUrl: "", contextNote: "", pasted: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const members = clients.filter(c => c.member).length;

  const create = async () => {
    setBusy(true); setErr(null); setMsg(null);
    const r = await createCuratedListAction(form).catch(() => ({ ok: false as const, error: "That did not save. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setMsg(`${r.entries} entr${r.entries === 1 ? "y" : "ies"} filed into the queue below. Approve them, then sweep.`);
    setForm({ name: "", sourceUrl: "", contextNote: "", pasted: "" });
    setAdding(false);
    router.refresh();
  };

  const sweep = async (id: string) => {
    setSweeping(id); setErr(null); setMsg(null);
    const r = await sweepCuratedListAction(id).catch(() => ({ ok: false as const, error: "The sweep did not finish. Try again." }));
    setSweeping(null);
    if (!r.ok) { setErr(r.error); return; }
    setMsg(`Swept ${r.tenants} community member${r.tenants === 1 ? "" : "s"} against ${r.entries} opportunit${r.entries === 1 ? "y" : "ies"}: ${r.matches} match${r.matches === 1 ? "" : "es"}.${r.skipped ? ` ${r.skipped} client${r.skipped === 1 ? " is" : "s are"} not community members and were left out.` : ""}`);
    router.refresh();
  };

  const toggleMember = async (id: string, member: boolean) => {
    setMemberBusy(id);
    await setCommunityMemberAction(id, member).catch(() => null);
    setMemberBusy(null);
    router.refresh();
  };

  return (
    <section className="cu-card">
      <div className="cu-head">
        <h3>Curated lists</h3>
        <span className="cu-sub">Load a funding roundup once; every community member benefits.</span>
        <span className="spacer" />
        <button type="button" className="sb-btn sb-primary sb-sm" onClick={() => setAdding(a => !a)}>{adding ? "Cancel" : "Load a list"}</button>
      </div>
      {msg && <p className="cu-msg">{msg}</p>}
      {err && <p className="cl-error">{err}</p>}
      {adding && (
        <div className="cu-form">
          <div className="cu-form-row">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="List name, e.g. Mozilla open-source fund roundup" />
            <input value={form.sourceUrl} onChange={e => setForm({ ...form, sourceUrl: e.target.value })} placeholder="Where it came from (URL, optional)" />
          </div>
          <textarea rows={6} value={form.pasted} onChange={e => setForm({ ...form, pasted: e.target.value })}
            placeholder="Paste the list itself: titles, funders, links, deadlines, amounts. It is parsed into entries for the review queue; nothing reaches a client unreviewed." />
          <textarea rows={2} value={form.contextNote} onChange={e => setForm({ ...form, contextNote: e.target.value })}
            placeholder="Context for matched clients (optional): application questions you pulled down, FAQ highlights, a webinar's gist." />
          <button type="button" className="sb-btn sb-primary sb-sm" onClick={create} disabled={busy}>{busy ? "Parsing…" : "Parse into the queue"}</button>
        </div>
      )}
      {lists.length > 0 && (
        <div className="cu-lists">
          {lists.map(l => (
            <div key={l.id} className="cu-row">
              <div className="cu-row-main">
                <b>{l.name}</b>
                <span className="cu-counts">
                  {l.approved} approved · {l.proposed} awaiting review{l.rejected ? ` · ${l.rejected} rejected` : ""}
                  {l.swept_at ? ` · swept ${new Date(l.swept_at).toLocaleDateString()}: ${l.matches} match${l.matches === 1 ? "" : "es"} across ${l.tenants} client${l.tenants === 1 ? "" : "s"}` : " · not swept yet"}
                </span>
              </div>
              <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => sweep(l.id)} disabled={sweeping === l.id || l.approved === 0}
                title={l.approved === 0 ? "Approve its entries in the queue below first." : undefined}>
                {sweeping === l.id ? "Sweeping…" : l.swept_at ? "Sweep again" : "Sweep clients"}</button>
            </div>
          ))}
        </div>
      )}
      <details className="cu-members">
        <summary>Community members ({members} of {clients.length})</summary>
        <p className="cu-sub">Sweeps reach only members. The client-facing consent switch arrives with the signed-off copy; until then membership is set here.</p>
        <div className="cu-member-grid">
          {clients.map(c => (
            <label key={c.id} className="cu-member">
              <input type="checkbox" checked={c.member} disabled={memberBusy === c.id}
                onChange={e => void toggleMember(c.id, e.target.checked)} />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
