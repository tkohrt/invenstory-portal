"use client";
// Wake Ground Truth early (patch 19, 4 November 2026): on any portal page, at
// most once every few minutes per tab, so it is usually awake by the time
// somebody reaches Funder Matches. The route does nothing for a client who
// cannot search. Renders nothing.
import { useEffect } from "react";
import { shouldWake } from "@/lib/ledger-wake";
import { WOKE_KEY, wakeLedgerOnce } from "./useLedgerWake";

export default function LedgerWarmer() {
  useEffect(() => {
    let last: number | null = null;
    try { const v = sessionStorage.getItem(WOKE_KEY); last = v ? Number(v) : null; } catch { /* storage unavailable */ }
    if (shouldWake(Number.isFinite(last) ? last : null, Date.now())) void wakeLedgerOnce();
  }, []);
  return null;
}
