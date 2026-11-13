"use client";
// P1.5 (patch 38): the Getting Started card, reborn as a slim banner the Shell
// shows on every page until the five first steps are done or the person hides
// it. One line by default; the steps unfold on request, each with a link that
// goes where the work happens. Reuses the hide_getting_started preference, so
// anyone who hid the old card stays hidden.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setUiPrefAction } from "@/lib/server/account-actions";
import type { StartStep } from "@/lib/living-voice";

const STEP_HREF: Record<StartStep["key"], string> = {
  eligibility: "/funding-eligibility",
  layer1: "/invenstory?upload=I",
  layer2: "/invenstory?upload=II",
  layer3: "/invenstory?upload=III",
  readiness: "/readiness",
  ein: "/readiness",
};

export default function SetupBanner({ steps }: { steps: StartStep[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const left = steps.filter(s => !s.done);
  if (left.length === 0) return null;
  const done = steps.length - left.length;

  const hide = async () => {
    setBusy(true);
    try { await setUiPrefAction("hide_getting_started", true); router.refresh(); }
    finally { setBusy(false); }
  };

  return (
    <div className="setup-banner" role="note" aria-label="Setting up">
      <div className="stb-line">
        <span className="stb-ic" aria-hidden>◔</span>
        <b>Setting up:</b>
        <span>{left.length} of {steps.length} item{left.length === 1 ? "" : "s"} outstanding{done > 0 ? ` (${done} done)` : ""}.</span>
        <span className="spacer" />
        <button type="button" className="sb-btn sb-quiet sb-sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Hide the steps" : "What is left?"}</button>
        <button type="button" className="sb-btn sb-quiet sb-sm" onClick={hide} disabled={busy} title="Hide this banner for good">Dismiss</button>
      </div>
      {open && (
        <ol className="stb-steps">
          {left.map(s => (
            <li key={s.key}>
              <div className="stb-step-text"><b>{s.title}</b><span>{s.detail}</span></div>
              <a className="sb-btn sb-secondary sb-sm" href={STEP_HREF[s.key]}>Do it →</a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
