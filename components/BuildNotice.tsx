"use client";
// The Card Library build, wherever you are in the portal.
//
// A build runs for minutes and carries on after its page is closed, so the
// portal says so at the top of every page: how far it has got and about how
// long is left while it runs, and that it is done (with what it found) when it
// finishes. For a client with Story Cards turned on, the same notice in their
// words, pointing at their Story Cards.
//
// Polls every 8 seconds while a build runs and every minute otherwise, so a
// build started in another tab or by a colleague appears too. A finished notice
// can be dismissed; that is remembered in this browser only.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { roughly } from "@/lib/job";

interface Running { jobId: string; done: number; total: number; startedAt: string; etaMs: number | null; resuming: boolean }
interface Finished { jobId: string; status: string; finishedAt: string; created: number; cards: number; sensitive: number; error: string | null }

const DISMISS = (id: string) => `build-notice-dismissed:${id}`;

export default function BuildNotice({ role, tenantId, cardsVisible }: { role: "client" | "admin"; tenantId: string; cardsVisible: boolean }) {
  const path = usePathname();
  const [running, setRunning] = useState<Running | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const admin = role === "admin";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/active", { cache: "no-store" });
      if (!res.ok) return null;
      const body = await res.json() as { running: Running | null; finished: Finished | null };
      setRunning(body.running);
      setFinished(body.finished);
      return body;
    } catch { return null; }
  }, []);

  useEffect(() => {
    if (!cardsVisible) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const body = await load();
      if (!live) return;
      timer = setTimeout(tick, body?.running ? 8_000 : 60_000);
    };
    void tick();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [load, cardsVisible, tenantId]);

  const dismissed = (id: string) => {
    if (hidden === id) return true;
    try { return localStorage.getItem(DISMISS(id)) === "1"; } catch { return false; }
  };
  const dismiss = (id: string) => {
    setHidden(id);
    try { localStorage.setItem(DISMISS(id), "1"); } catch { /* remembered for this page only */ }
  };

  if (!cardsVisible) return null;
  // The Card Library page shows the full log already.
  if (admin && path.startsWith("/admin/card-library")) return null;
  const href = admin ? "/admin/card-library" : "/story-cards";

  if (running) {
    const eta = roughly(running.etaMs);
    return (
      <div className="bn bn-run" role="status" aria-live="polite">
        <span className="jp-spin" aria-hidden="true" />
        <span>
          <strong>{admin ? "Card Library build running" : "Your Story Cards are being updated"}.</strong>{" "}
          {running.total > 0 && `${Math.min(running.done, running.total)} of ${running.total} documents read`}
          {eta ? `, ${eta} left` : ""}.
          {running.resuming ? " It paused and is being picked up again." : " It keeps going if you leave this page."}
        </span>
        {admin && <Link href={href} className="bn-link">Watch it</Link>}
      </div>
    );
  }

  if (finished && !dismissed(finished.jobId)) {
    const ok = finished.status === "done";
    return (
      <div className={`bn ${ok ? "bn-done" : "bn-fail"}`} role="status">
        <span>
          {ok ? (
            <>
              <strong>{admin ? "Card Library build finished" : "Your Story Cards have been updated"}.</strong>{" "}
              {finished.created ? `${finished.created} new card${finished.created === 1 ? "" : "s"}` : "No new cards"}
              {admin ? `, ${finished.cards} live in all` : ""}{admin && finished.sensitive ? `; ${finished.sensitive} sensitive awaiting a decision` : ""}.
            </>
          ) : (
            <>
              <strong>{admin ? "Card Library build stopped" : "Updating your Story Cards paused"}.</strong>{" "}
              {admin ? (finished.error ?? "Everything read is saved.") + " Carry on from the Card Library." : "For Granted will pick it up."}
            </>
          )}
        </span>
        <Link href={href} className="bn-link">{admin ? "Open the Card Library" : ok ? "Look at them" : "Story Cards"}</Link>
        <button type="button" className="bn-x" onClick={() => dismiss(finished.jobId)} aria-label="Dismiss">×</button>
      </div>
    );
  }
  return null;
}
