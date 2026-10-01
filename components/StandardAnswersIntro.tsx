"use client";
// Before a new application: answer the common questions once.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { openStandardAnswersAction } from "@/lib/server/workspace-actions";
import type { StandardProgress } from "@/lib/server/draft-start";

export default function StandardAnswersIntro({ tenantName, progress, skipHref }: { tenantName: string; progress: StandardProgress; skipHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pct = progress.recommended ? Math.round((progress.approved / progress.recommended) * 100) : 0;
  const open = async () => {
    setBusy(true); setError(null);
    try { router.push(`/drafts/${(await openStandardAnswersAction()).draftId}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not open Standard Answers."); setBusy(false); }
  };
  return (
    <div className="ds">
      <Link href="/draft" className="ds-back">← Draft an Application</Link>
      <h2>Answer the common questions once</h2>
      <ul className="ds-points">
        <li>Most funders ask the same core questions: who you are, the need, your program, your results.</li>
        <li>Standard Answers answers each of them once, from {tenantName}&rsquo;s Story Cards, so every sentence keeps its source.</li>
        <li>Every application then starts from those answers, like a common app, and only the new questions are written from scratch.</li>
      </ul>
      <div className="ds-progress" aria-label="Standard Answers progress">
        <div className="ds-bar"><i style={{ width: `${pct}%` }} /></div>
        <span>{progress.recommended
          ? `${progress.approved} of ${progress.recommended} recommended answers approved`
          : "No recommended questions yet: build the Card Library first so there are cards to answer from."}</span>
      </div>
      {error && <div className="ap-error" role="alert">{error}</div>}
      <div className="ds-actions">
        <button type="button" className="btn inline ap-go" disabled={busy} onClick={() => void open()}>
          {busy ? "Opening…" : progress.started ? "Continue Standard Answers" : "Start Standard Answers"}
        </button>
        <Link className="ds-skip" href={skipHref}>Start this application now and finish Standard Answers later</Link>
      </div>
    </div>
  );
}
