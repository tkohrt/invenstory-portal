"use client";
// Sources (patch 11 of the 1 November 2026 build): what Funder Matches
// searches for this client, and the place to change it.
//
// A one-line button ("Searching 5 of 7 sources") opens a side panel listing
// every source, grouped, each with whether it is searched, why, what it did on
// the last run, and Automatic / On / Off. For Granted can also lock a choice.
// Nothing reruns on its own: changes apply to the next search, and the panel
// offers Search now. Rules: lib/sources.ts.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { setSourceAction } from "@/lib/server/source-actions";
import {
  GROUP_LABEL, MODE_LABEL, canChange, summaryLine, runText,
  type SourceGroup, type SourceMode, type SourceState, type SourceRun, type SourceId,
} from "@/lib/sources";

const MODES: SourceMode[] = ["auto", "on", "off"];
const GROUPS: SourceGroup[] = ["core", "public", "web"];

function status(s: SourceState): { word: string; cls: string } {
  if (s.unavailable) return { word: "Unavailable", cls: "src-unavail" };
  if (!s.on) return { word: "Off", cls: "src-off" };
  return { word: s.ownButton ? "On" : "Searched", cls: "src-on" };
}

export default function SourcesPanel({
  states, lastRun, orgName, role, preview = false, selfSearch, canRun = false, running = false, onRun, adminSlot = null,
}: {
  states: SourceState[];
  lastRun: { ranAt: string | null; bySource: Partial<Record<SourceId, SourceRun>> };
  orgName: string;
  /** Whose page this is: For Granted's, or the client's. */
  role: "admin" | "client";
  /** For Granted viewing as the client: nothing changes. */
  preview?: boolean;
  /** For Granted let this client run searches itself. */
  selfSearch: boolean;
  canRun?: boolean;
  running?: boolean;
  onRun?: () => void;
  /** For Granted only: the "run searches themselves" switch, shown at the top. */
  adminSlot?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<SourceId | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const who = { role, preview, selfSearch };

  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("h3")?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [open]);

  const save = (s: SourceState, mode: SourceMode, locked: boolean) => {
    setBusy(s.id); setErr(null);
    void setSourceAction({ source: s.id, mode, locked })
      .then(r => { if (!r.ok) setErr(r.error); router.refresh(); })
      .catch(() => setErr("That could not be saved. Please try again."))
      .finally(() => setBusy(null));
  };

  const anyEditable = states.some(s => canChange(s, who));
  const ran = lastRun.ranAt ? new Date(lastRun.ranAt).toLocaleDateString() : null;

  return (
    <>
      <button ref={trigger} type="button" className="sb-btn sb-secondary src-trigger" aria-haspopup="dialog"
        onClick={() => setOpen(true)} title="See and choose the databases this search uses">
        <span className="src-trigger-dot" aria-hidden="true" />{summaryLine(states)}
      </button>
      {open && (
        <div className="ws-modal-back" role="presentation" onClick={close}>
          <aside ref={panel} className="ws-versions src-drawer" role="dialog" aria-modal="true" aria-labelledby="src-title"
            onClick={e => e.stopPropagation()}>
            <div className="ws-versions-head">
              <h3 id="src-title" tabIndex={-1}>Sources</h3>
              <button type="button" className="sb-btn sb-quiet sb-icon" aria-label="Close sources" onClick={close}>×</button>
            </div>
            <p className="src-intro">
              Where Funder Matches looks for {orgName}. <strong>Automatic</strong> follows Funding Eligibility: the kinds of
              funding sought and where the work happens. On and Off override it.
              {ran ? ` The last search ran on ${ran}.` : " No search has run yet."}
            </p>
            {adminSlot}
            {preview && <div className="ov-note">You are seeing the sources as {orgName} sees them. Nothing here can be changed in this view.</div>}
            {!preview && !anyEditable && (
              <div className="ov-note">Your For Granted team chooses the sources. Ask them if you would like one changed.</div>
            )}
            {err && <div className="ap-error" role="alert">{err}</div>}

            <div className="src-body">
              {GROUPS.map(g => {
                const rows = states.filter(s => s.group === g);
                if (!rows.length) return null;
                return (
                  <section key={g} className="src-group" aria-label={GROUP_LABEL[g]}>
                    <div className="src-label">{GROUP_LABEL[g]}</div>
                    <ul className="src-list">
                      {rows.map(s => {
                        const st = status(s);
                        const editable = canChange(s, who);
                        return (
                          <li key={s.id} className={`src-row ${s.on ? "" : "src-row-off"}`}>
                            <div className="src-top">
                              <span className={`src-status ${st.cls}`}><i aria-hidden="true" />{st.word}</span>
                              <span className="src-name">{s.name}</span>
                              {s.paid && <span className="ov-tag src-tag" title="Each search costs a little of the monthly AI allowance.">Paid per search</span>}
                              {s.locked && <span className="ov-tag src-tag" title="Only For Granted can change this source.">Set by For Granted</span>}
                            </div>
                            <div className="src-what">{s.what}</div>
                            <div className="src-meta">Finds: {s.kindsText}</div>
                            <div className="src-why">{s.unavailable ?? s.why}</div>
                            {!s.ownButton && <div className="src-meta">{runText(lastRun.bySource[s.id])}</div>}
                            {!s.fixed && (
                              <div className="src-controls">
                                <div className="src-seg" role="radiogroup" aria-label={`${s.name}: Automatic, On or Off`}>
                                  {MODES.map(m => (
                                    <button key={m} type="button" role="radio" aria-checked={s.mode === m}
                                      className={`src-seg-btn${s.mode === m ? " on" : ""}`}
                                      disabled={!editable || busy === s.id}
                                      title={!editable ? (s.locked && role === "client" ? "Set by For Granted." : "Your For Granted team chooses the sources.") : m === "auto" ? (s.autoOn ? "Automatic: searched, because of Funding Eligibility." : "Automatic: not searched, because of Funding Eligibility.") : undefined}
                                      onClick={() => { if (s.mode !== m) save(s, m, s.locked); }}>
                                      {MODE_LABEL[m]}
                                    </button>
                                  ))}
                                </div>
                                {role === "admin" && !preview && (
                                  <label className="src-lock">
                                    <input type="checkbox" checked={s.locked} disabled={busy === s.id}
                                      onChange={e => save(s, s.mode, e.target.checked)} />
                                    Only For Granted can change this
                                  </label>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>

            <div className="src-foot">
              <span className="src-meta">Changes apply to the next search.</span>
              <span className="spacer" />
              {canRun && onRun && !preview && (
                <button type="button" className="sb-btn sb-primary" disabled={running}
                  onClick={() => { onRun(); close(); }}>
                  {running ? "Searching…" : "Search now"}
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
