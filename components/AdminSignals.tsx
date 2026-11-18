"use client";
// Signals (patch 64): the Sources tab. Every recurring source For Granted
// watches, how each is doing, and what each produced lately. Entries a source
// yields land in the Ground Truth queue under that week's "Signals" list;
// this tab is where sources are added, approved and kept healthy.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addSourceAction, setSourceActiveAction, checkSourceNowAction, readHeldAction } from "@/lib/server/signals-actions";
import {
  KIND_LABEL, CATEGORY_LABEL, CATEGORIES, STATUS_LABEL, HEALTH_LABEL, sourceHealth,
  type SourceRow, type SignalRow, type SourceKind,
} from "@/lib/signals";

type Recent = SignalRow & { source_label: string; source_kind: SourceKind };

const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "never";
const HEALTH_TAG: Record<string, string> = { ok: "ov-tag sg-ok", failing: "ov-tag sg-bad", quiet: "ov-tag sg-warn", new: "ov-tag", off: "ov-tag sg-off" };

export default function AdminSignals({ sources, recent, inbox, ready }: {
  sources: SourceRow[]; recent: Recent[];
  /** The signals inbox: its address when set, and whether the webhook secret is configured. */
  inbox: { address: string | null; configured: boolean };
  /** False when migration 0098 has not been applied. */
  ready: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: "page", address: "", label: "", category: "funder" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, done?: string) => {
    setBusy(key); setErr(null); setMsg(null);
    const r = await fn().catch(() => ({ ok: false as const, error: "That did not finish. Try again." }));
    setBusy(null);
    if (!r.ok) { setErr(r.error); return false; }
    setMsg(r.message ?? done ?? null);
    router.refresh();
    return true;
  };
  const add = async () => {
    if (await run("add", () => addSourceAction(form), "Added. It will be read on the next run (Mondays and Thursdays).")) {
      setForm({ kind: "page", address: "", label: "", category: "funder" }); setAdding(false);
    }
  };

  if (!ready) {
    return <section className="cu-card"><div className="cu-head"><h3>Sources</h3></div>
      <p className="cl-error">The signals tables are not in the database yet. Apply migration 0098, then reload.</p></section>;
  }
  const now = new Date();
  const health = sources.map(s => ({ s, h: sourceHealth(s, now) }));
  const attention = health.filter(x => x.h.state === "failing" || x.h.state === "quiet").length;
  const waiting = sources.filter(s => s.kind === "email" && !s.active && s.origin === "inbox" && !s.last_signal_at);
  const held = recent.filter(r => r.status === "held");

  return (
    <>
      <section className="cu-card">
        <div className="cu-head">
          <h3>Sources</h3>
          <span className="cu-sub">
            {sources.length} watched{attention ? `, ${attention} need${attention === 1 ? "s" : ""} a look` : ""}. Read Mondays and Thursdays; what they yield lands in the Ground Truth queue.
          </span>
          <span className="spacer" />
          <button type="button" className="sb-btn sb-primary sb-sm" onClick={() => setAdding(a => !a)}>{adding ? "Cancel" : "Add a source"}</button>
        </div>
        {msg && <p className="cu-msg" role="status">{msg}</p>}
        {err && <p className="cl-error" role="alert">{err}</p>}
        {adding && (
          <div className="cu-form">
            <div className="cu-form-row">
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} aria-label="Kind of source">
                <option value="page">A page to watch for changes</option>
                <option value="bluesky">A Bluesky account</option>
              </select>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} aria-label="What it covers">
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            <div className="cu-form-row">
              <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                placeholder={form.kind === "page" ? "The page's address, e.g. https://www.ycombinator.com/apply" : "The handle, e.g. kresge.org or nehgov.bsky.social"} />
              <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="What to call it, e.g. Y Combinator: apply page" />
            </div>
            <p className="cu-sub">Use the funder&rsquo;s or programme&rsquo;s own page, not an aggregator&rsquo;s copy of it. A newsletter is added by subscribing the signals inbox to it; the sender then appears here for approval.</p>
            <button type="button" className="sb-btn sb-primary sb-sm" onClick={() => void add()} disabled={busy === "add" || !form.address.trim()}>{busy === "add" ? "Adding…" : "Add"}</button>
          </div>
        )}
        {sources.length === 0 ? <p className="cu-sub">Nothing is being watched yet. Add a funder&rsquo;s or an accelerator&rsquo;s application page to start.</p> : (
          <table className="do-table sg-table">
            <thead><tr><th>Source</th><th>Kind</th><th>Covers</th><th>Health</th><th>Last read</th><th>Last produced</th><th></th></tr></thead>
            <tbody>
              {health.map(({ s, h }) => (
                <tr key={s.id}>
                  <td><b>{s.label}</b><br />
                    {s.kind === "page" ? <a href={s.address} target="_blank" rel="noopener noreferrer" className="sg-addr">{s.address.replace(/^https?:\/\//, "").slice(0, 70)} ↗</a>
                      : s.kind === "bluesky" ? <a href={`https://bsky.app/profile/${s.address}`} target="_blank" rel="noopener noreferrer" className="sg-addr">@{s.address} ↗</a>
                      : <span className="sg-addr">{s.address}</span>}
                  </td>
                  <td>{KIND_LABEL[s.kind]}</td>
                  <td>{CATEGORY_LABEL[s.category]}</td>
                  <td><span className={HEALTH_TAG[h.state]} title={h.why}>{HEALTH_LABEL[h.state]}</span><br /><span className="sg-why">{h.why}</span></td>
                  <td className="fm-nowrap">{day(s.last_checked_at)}</td>
                  <td className="fm-nowrap">{day(s.last_signal_at ?? s.last_changed_at)}</td>
                  <td className="sg-acts">
                    {s.kind === "page" && s.active && (
                      <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busy === `c${s.id}`} onClick={() => void run(`c${s.id}`, () => checkSourceNowAction(s.id))}>
                        {busy === `c${s.id}` ? "Reading…" : "Read now"}</button>
                    )}
                    <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busy === `a${s.id}`}
                      onClick={() => void run(`a${s.id}`, () => setSourceActiveAction(s.id, !s.active), s.active ? "Turned off. It is kept, and can be turned back on." : s.kind === "email" ? "Approved. Mail from this sender is read from now on; read anything held below." : "Turned on.")}>
                      {s.active ? "Turn off" : s.kind === "email" && waiting.includes(s) ? "Approve sender" : "Turn on"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cu-card">
        <div className="cu-head">
          <h3>Signals inbox</h3>
          <span className="cu-sub">
            {inbox.configured
              ? <>Subscribe {inbox.address ? <b>{inbox.address}</b> : "the signals address"} to funder and accelerator newsletters, or forward anything worth reading to it.</>
              : "Not set up yet: the mail service needs a receiving address and this portal needs its webhook secret (RESEND_INBOUND_SECRET). See the patch 64 build notes."}
          </span>
        </div>
        {held.length > 0 && (
          <>
            <p className="cu-sub">Held mail. A new sender&rsquo;s mail is not read until you approve the sender above; a subscription&rsquo;s confirmation link is usually among the links shown.</p>
            {held.map(r => {
              const src = sources.find(s => s.id === r.source_id);
              return (
                <div key={r.id} className="cu-row sg-held">
                  <div className="cu-row-main">
                    <b>{r.title || "(no subject)"}</b>
                    <span className="cu-counts">{r.source_label} · {day(r.seen_at)}</span>
                    {r.excerpt && <span className="sg-why">{r.excerpt.slice(0, 220)}</span>}
                    {r.note && <span className="sg-links">{r.note.split("\n").slice(0, 6).map((u, i) => /^https?:\/\//i.test(u) ? <a key={i} href={u} target="_blank" rel="noopener noreferrer">{u.replace(/^https?:\/\//, "").slice(0, 60)} ↗</a> : null)}</span>}
                  </div>
                  <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busy === `h${r.id}` || !src?.active}
                    title={src?.active ? undefined : "Approve the sender first."} onClick={() => void run(`h${r.id}`, () => readHeldAction(r.id))}>
                    {busy === `h${r.id}` ? "Reading…" : "Read it"}</button>
                </div>
              );
            })}
          </>
        )}
      </section>

      <section className="cu-card">
        <div className="cu-head"><h3>Lately</h3><span className="cu-sub">The last {recent.length} things the sources produced.</span></div>
        {recent.length === 0 ? <p className="cu-sub">Nothing yet. The first run reads every page once.</p> : (
          <table className="do-table sg-table">
            <thead><tr><th>When</th><th>Source</th><th>What</th><th>Outcome</th></tr></thead>
            <tbody>
              {recent.filter(r => r.status !== "held").map(r => (
                <tr key={r.id}>
                  <td className="fm-nowrap">{day(r.seen_at)}</td>
                  <td>{r.source_label}</td>
                  <td>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title || r.url} ↗</a> : (r.title || "")}
                    {r.excerpt && <><br /><span className="sg-why">{r.excerpt.slice(0, 160)}</span></>}</td>
                  <td>{STATUS_LABEL[r.status]}{r.status === "filed" ? ` (${r.entries})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
