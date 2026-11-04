"use client";
// Waking Ground Truth from the browser (patch 19, 4 November 2026).
//
// Ground Truth naps when idle and takes most of a minute to start. The page
// wakes it on load, as before, but now knows when the wake-up has finished:
// a search pressed in the meantime waits for it (up to PAGE_WAKE_WAIT_MS)
// rather than being fired at a host that refuses everything while it starts.
import { useCallback, useEffect, useRef, useState } from "react";
import { PAGE_WAKE_WAIT_MS } from "@/lib/ledger-wake";

export const WOKE_KEY = "fg.ledger.wokeAt";

function remember() {
  try { sessionStorage.setItem(WOKE_KEY, String(Date.now())); } catch { /* storage unavailable: harmless */ }
}

/** One wake-up request, settled when it answers or after the page's wait, whichever is first. */
export function wakeLedgerOnce(): Promise<void> {
  remember();
  return new Promise<void>(resolve => {
    const t = setTimeout(resolve, PAGE_WAKE_WAIT_MS);
    fetch("/api/ledger/warm", { method: "POST" }).catch(() => null).finally(() => { clearTimeout(t); resolve(); });
  });
}

export function useLedgerWake(enabled: boolean) {
  const [waking, setWaking] = useState(enabled);
  const gate = useRef<Promise<void> | null>(null);

  const begin = useCallback(() => {
    const p = wakeLedgerOnce().then(() => setWaking(false));
    gate.current = p;
    return p;
  }, []);

  useEffect(() => { if (enabled) void begin(); }, [enabled, begin]);

  /** Wait for the wake-up in progress, if there is one. */
  const ready = useCallback(() => gate.current ?? Promise.resolve(), []);
  /** Wake it again, for a retry after a run found it asleep. */
  const wakeAgain = useCallback(() => { setWaking(true); return begin(); }, [begin]);

  return { waking, ready, wakeAgain };
}
