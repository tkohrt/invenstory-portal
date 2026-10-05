// The fair-use cap on a client's own Analyze button (Build Decisions, 2 October
// 2026, decision 2).
//
// A press reads only documents that are new, changed, or read under older
// rules, so most presses cost almost nothing. The cap stops the expensive case:
// a client re-pressing every hour, or pouring in hundreds of pages a month.
// Past it, the button becomes "Request an analysis", which For Granted approves.
//
// Analyses For Granted runs are never counted. Pure, so the page can explain
// the cap and the server enforce exactly the same rule.

export const ANALYSIS_CAP = {
  /** Client-started analyses per rolling 24 hours. */
  runsPerDay: 1,
  /** New pages a client's own analyses may read per calendar month. */
  pagesPerMonth: 200,
  /** A page, for the allowance: roughly a printed page of text. */
  charsPerPage: 3000,
} as const;

export const pagesOf = (chars: number) => Math.max(0, Math.ceil(chars / ANALYSIS_CAP.charsPerPage));

export interface UsageRow { at: string; pendingChars: number }

export type CapDecision =
  | { allowed: true; pages: number; monthPagesAfter: number }
  | { allowed: false; reason: "nothing_new" }
  | { allowed: false; reason: "daily"; nextAt: string }
  | { allowed: false; reason: "monthly"; pages: number; monthPagesUsed: number };

/**
 * May the client start an analysis now?
 *
 * `usage` is the client's own presses (newest first or any order); `pendingChars`
 * and `pendingDocs` are what this press would read. An approved request lets one
 * press through whatever the cap says.
 */
export function decideClientRun(input: {
  now: Date; usage: UsageRow[]; pendingDocs: number; pendingChars: number; approvedRequest?: boolean;
}): CapDecision {
  const { now, usage, pendingDocs, pendingChars } = input;
  if (pendingDocs <= 0) return { allowed: false, reason: "nothing_new" };
  const pages = pagesOf(pendingChars);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthPagesUsed = usage
    .filter(u => new Date(u.at).getTime() >= monthStart)
    .reduce((n, u) => n + pagesOf(u.pendingChars), 0);
  if (input.approvedRequest) return { allowed: true, pages, monthPagesAfter: monthPagesUsed + pages };

  const dayAgo = now.getTime() - 24 * 3600_000;
  const recent = usage.map(u => new Date(u.at).getTime()).filter(t => t > dayAgo).sort((a, b) => a - b);
  if (recent.length >= ANALYSIS_CAP.runsPerDay) {
    const frees = recent[recent.length - ANALYSIS_CAP.runsPerDay] + 24 * 3600_000;
    return { allowed: false, reason: "daily", nextAt: new Date(frees).toISOString() };
  }
  if (monthPagesUsed + pages > ANALYSIS_CAP.pagesPerMonth) {
    return { allowed: false, reason: "monthly", pages, monthPagesUsed };
  }
  return { allowed: true, pages, monthPagesAfter: monthPagesUsed + pages };
}

/** One plain sentence for the page, when the button is not available. */
export function describeCap(d: CapDecision, now = new Date()): string {
  if (d.allowed) return "";
  if (d.reason === "nothing_new") return "Everything in your Inven(s)tory has been analysed. Upload or change a document to analyse again.";
  if (d.reason === "daily") {
    const hours = Math.max(1, Math.ceil((new Date(d.nextAt).getTime() - now.getTime()) / 3600_000));
    return `You can run one analysis a day. The next is available in about ${hours} hour${hours === 1 ? "" : "s"}, or you can ask For Granted to run it sooner.`;
  }
  return `This analysis would read about ${d.pages} new page${d.pages === 1 ? "" : "s"}, and ${d.monthPagesUsed} of this month's `
    + `${ANALYSIS_CAP.pagesPerMonth} have been used. Ask For Granted to run it for you.`;
}
