"use client";
// Following (patch 66): the client's shared list of funders, grants, RFPs and
// accelerators it is tracking, each with one switch for updates. Rules in
// lib/following.ts. Everything shown is a snapshot kept when the item was
// added, rendered as text.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setFollowUpdatesAction, unfollowAction } from "@/lib/server/saved-actions";
import { groupFollowing, followingSummary, type FollowItem, type FollowRow } from "@/lib/following";
import { UNREVIEWED_LABEL, UNREVIEWED_WHY, WITHDRAWN_LABEL } from "@/lib/trust";

const STATE_TAG: Record<string, string> = { reopened: "ov-tag sg-ok", closing: "ov-tag sg-warn", open: "ov-tag", closed: "ov-tag sg-off", none: "ov-tag sg-off" };

export default function FollowingView({ items, preview }: { items: FollowItem[]; preview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Switches answer at once; the server's answer follows on refresh.
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [gone, setGone] = useState<string[]>([]);
  const keyOf = (r: FollowRow) => `${r.kind}:${r.target_id}`;
  const g = groupFollowing(items.filter(i => !gone.includes(`${i.kind}:${i.target_id}`)));

  const setUpdates = async (r: FollowRow, on: boolean) => {
    const k = keyOf(r);
    setBusy(k); setErr(null); setLocal(l => ({ ...l, [k]: on }));
    const res = await setFollowUpdatesAction(r.kind, r.target_id, on).catch(() => ({ error: "That did not save. Try again." }));
    setBusy(null);
    if ("error" in res) { setErr(res.error); setLocal(l => ({ ...l, [k]: !on })); return; }
    router.refresh();
  };
  const remove = async (r: FollowRow) => {
    const k = keyOf(r);
    setBusy(k); setErr(null);
    const res = await unfollowAction(r.kind, r.target_id).catch(() => ({ error: "Could not remove it. Try again." }));
    setBusy(null);
    if ("error" in res) { setErr(res.error); return; }
    setGone(x => [...x, k]);
    router.refresh();
  };
  // Plain functions, not components: a component defined here would be remounted on every render.
  const switchFor = (r: FollowRow) => {
    const on = local[keyOf(r)] ?? r.updates;
    return (
      <label className="fo-switch" title={on ? "Updates are on for your whole team. Untick to stop notices about this." : "Updates are off for your whole team. It stays on the list."}>
        <input type="checkbox" checked={on} disabled={preview || busy === keyOf(r)} onChange={e => void setUpdates(r, e.target.checked)} />
        <span>{on ? "Updates on" : "Updates off"}</span>
      </label>
    );
  };
  const removeFor = (r: FollowRow) => (
    <button type="button" className="sb-btn sb-quiet sb-sm" disabled={preview || busy === keyOf(r)} onClick={() => void remove(r)}
      aria-label={`${r.kind === "funder" ? "Unfollow" : "Remove"} ${r.title}`}>{r.kind === "funder" ? "Unfollow" : "Remove"}</button>
  );
  const empty = g.funders.length === 0 && g.opportunities.length === 0;

  return (
    <div className="fo-page">
      <div className="page-head">
        <div>
          <h2>Following</h2>
          <p>{empty ? "Nothing yet." : `You are following ${followingSummary(g)}`} One list for your whole team: anyone on your account can add to it, remove from it, or switch an item&rsquo;s updates on and off.</p>
        </div>
        <div className="spacer" />
        <a className="sb-btn sb-secondary sb-sm" href="/funding">Funding</a>
      </div>
      {err && <p className="cl-error" role="alert">{err}</p>}
      {empty && (
        <section className="cu-card">
          <p className="cu-sub">This is where the funders and opportunities you want to keep an eye on live. To add to it: open a funder on the Funding page and press <b>Follow</b>, or press <b>☆ Save</b> beside any grant. For Granted may add things here for you too.</p>
        </section>
      )}

      {g.opportunities.length > 0 && (
        <section className="cu-card">
          <div className="cu-head"><h3>Grants, RFPs and accelerators</h3><span className="cu-sub">What needs attention first is at the top.</span></div>
          <table className="do-table sg-table">
            <thead><tr><th>Opportunity</th><th>From</th><th>Kind</th><th>When</th><th>Updates</th><th></th></tr></thead>
            <tbody>
              {g.opportunities.map(r => (
                <tr key={keyOf(r)}>
                  <td>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title} ↗</a> : <b>{r.title}</b>}
                    {r.terms && <span className="sg-why" title="An investment, not a grant. These are the terms as the programme's own page states them; confirm them there before applying.">Terms: {r.terms}</span>}
                    {r.standing === "unreviewed" && <span className="sg-why"><span className="ov-tag gt-pending" title={UNREVIEWED_WHY}>{UNREVIEWED_LABEL}</span></span>}
                    {r.standing === "withdrawn" && <span className="sg-why"><span className="ov-tag sg-off" title="For Granted looked at this and removed it from the opportunities it shows. It stays here until you remove it.">{WITHDRAWN_LABEL}</span></span>}</td>
                  <td>{r.who ?? <span className="do-muted">Not listed</span>}</td>
                  <td>{r.label}</td>
                  <td><span className={STATE_TAG[r.state]}>{r.when}</span></td>
                  <td>{switchFor(r)}</td>
                  <td className="sg-acts">{removeFor(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {g.funders.length > 0 && (
        <section className="cu-card">
          <div className="cu-head"><h3>Funders</h3><span className="cu-sub">A funder has no date of its own; what it opens shows above once you save it.</span></div>
          <table className="do-table sg-table">
            <thead><tr><th>Funder</th><th>Their site</th><th>Updates</th><th></th></tr></thead>
            <tbody>
              {g.funders.map(r => (
                <tr key={keyOf(r)}>
                  <td>{r.href ? <a href={r.href}>{r.title}</a> : <b>{r.title}</b>}</td>
                  <td>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 50)} ↗</a> : <span className="do-muted">Not on record</span>}</td>
                  <td>{switchFor(r)}</td>
                  <td className="sg-acts">{removeFor(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!empty && <p className="do-muted">Updates appear in the notification bar on your Funding page: a saved call opening again, or a deadline within two weeks. Switching an item&rsquo;s updates off keeps it on the list and silences those notices for everyone on your account.</p>}
    </div>
  );
}
