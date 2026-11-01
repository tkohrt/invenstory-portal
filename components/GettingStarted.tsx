"use client";
// Getting started (patch 3 of the 1 November 2026 build): the first things to
// do in the portal, shown on the Inven(s)tory until they are done or hidden.
// Each step says what it is for and opens the thing that does it, so nobody
// has to remember what they were told on a call.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setUiPrefAction } from "@/lib/server/account-actions";
import type { StartStep } from "@/lib/living-voice";

export default function GettingStarted({ steps, isAdmin, onUpload, onVoice }: {
  steps: StartStep[];
  /** For Granted sees what the client sees, and is told so. */
  isAdmin: boolean;
  onUpload: (layer: "I" | "II" | "III") => void;
  onVoice: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // For Granted opens client pages all day: one line for them, the full card for the client.
  const [open, setOpen] = useState(!isAdmin);
  const done = steps.filter(s => s.done).length;

  const hide = async () => {
    setBusy(true);
    try { await setUiPrefAction("hide_getting_started", true); router.refresh(); }
    finally { setBusy(false); }
  };

  const action = (s: StartStep) => {
    switch (s.key) {
      case "eligibility": return <a className="sb-btn sb-secondary sb-sm" href="/funding-eligibility">Open Funding Eligibility</a>;
      case "layer1": return <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => onUpload("I")}>Add to Layer I</button>;
      case "layer2": return <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => onUpload("II")}>Add to Layer II</button>;
      case "layer3": return <button type="button" className="sb-btn sb-secondary sb-sm" onClick={onVoice}>See what to talk about</button>;
      case "readiness": return <a className="sb-btn sb-secondary sb-sm" href="#readiness">Go to the readiness check</a>;
    }
  };

  return (
    <section className="gs-card" aria-label="Getting started">
      <div className="gs-head">
        <h3>Getting started</h3>
        <span className="gs-count">{done} of {steps.length} done</span>
        <span className="spacer" />
        {!isAdmin && <button type="button" className="sb-btn sb-quiet sb-sm" onClick={hide} disabled={busy}>Hide this</button>}
        {isAdmin && <button type="button" className="sb-btn sb-quiet sb-sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Hide the steps" : "Show what the client sees"}</button>}
      </div>
      {isAdmin && open && <p className="acct-note" style={{ marginTop: 0 }}>This is what the client sees until every step is done or they hide it.</p>}
      {open && <ol className="gs-steps">
        {steps.map(s => (
          <li key={s.key} className={s.done ? "done" : ""}>
            <span className="gs-mark" aria-hidden>{s.done ? "✓" : ""}</span>
            <div className="gs-text">
              <b>{s.title}</b>{s.done && <span className="gs-done"> Done</span>}
              <span>{s.detail}</span>
            </div>
            {!s.done && action(s)}
          </li>
        ))}
      </ol>}
    </section>
  );
}
