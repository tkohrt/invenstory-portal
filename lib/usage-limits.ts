// The client limits on AI use (decided 6 October 2026).
//
// Sized around 5 to 10 times real use, so a client doing real grant work never
// meets them; reaching one offers "Ask For Granted for more" rather than a dead
// end. For Granted's admins (Shane, Tyler) are never limited, by anything here.
//
// "A client" is a tenant: every client login belongs to exactly one tenant
// (app_user.tenant_id), so a per-client limit counts every login of that
// client together, and a per-person limit counts one login. Pure, so the page
// and the server agree, and it is tested without a database.

export const LIMITS = {
  /** Longest chat question, in characters (about a page). */
  chatQuestionChars: 2000,
  /** Per person: the burst guard that existed before. */
  chatPerMinutePerPerson: 12,
  /** Per person, rolling 24 hours. */
  chatPerDayPerPerson: 50,
  /** Per client (all of its logins), calendar month (Eastern time). */
  chatPerMonthPerClient: 500,
  /** "Process again" on a document, per client, rolling 24 hours. */
  reprocessPerDayPerClient: 5,
  /** Readiness reads of client uploads, per client, rolling 24 hours. Uploads themselves are never blocked. */
  uploadReadsPerDayPerClient: 30,
  /** Warn when this share of a limit is used. */
  warnAt: 0.8,
} as const;

export type Actor = "client" | "admin";

export interface ChatCounts {
  /** This person's questions in the last minute, and the last 24 hours. */
  minute: number; day: number;
  /** This client's questions this calendar month, all logins. */
  month: number;
  /** Extra questions For Granted granted this client this month. */
  monthExtra?: number;
}

export type ChatDecision =
  | { ok: true; unlimited: true }
  | { ok: true; unlimited?: false; dayLeft: number; monthLeft: number; warning: string | null }
  | { ok: false; reason: "too_long" | "minute" | "day" | "month"; message: string; canRequest: boolean };

/** May this person ask this question now? Counts are before this question. */
export function decideChat(actor: Actor, questionChars: number, c: ChatCounts): ChatDecision {
  if (actor === "admin") return { ok: true, unlimited: true };
  if (questionChars > LIMITS.chatQuestionChars) {
    return {
      ok: false, reason: "too_long", canRequest: false,
      message: `Please keep a question under ${LIMITS.chatQuestionChars.toLocaleString()} characters (about a page). `
        + "For a long document, upload it to your Inven(s)tory and ask about it here.",
    };
  }
  if (c.minute >= LIMITS.chatPerMinutePerPerson) {
    return { ok: false, reason: "minute", canRequest: false, message: "You're sending messages very quickly. Give it a moment." };
  }
  const monthCap = LIMITS.chatPerMonthPerClient + Math.max(0, c.monthExtra ?? 0);
  if (c.month >= monthCap) {
    return {
      ok: false, reason: "month", canRequest: true,
      message: `Your organization has used this month's ${monthCap.toLocaleString()} questions. `
        + "Ask For Granted for more and we'll add them, or they reset on the 1st.",
    };
  }
  if (c.day >= LIMITS.chatPerDayPerPerson) {
    return {
      ok: false, reason: "day", canRequest: false,
      message: `You've asked ${LIMITS.chatPerDayPerPerson} questions in the last 24 hours, the daily limit for each person. `
        + "More become available through the day, as earlier questions pass the 24-hour mark.",
    };
  }
  const dayLeft = LIMITS.chatPerDayPerPerson - c.day - 1;
  const monthLeft = monthCap - c.month - 1;
  const warning = monthLeft <= monthCap * (1 - LIMITS.warnAt)
    ? `${monthLeft.toLocaleString()} question${monthLeft === 1 ? "" : "s"} left for your organization this month.`
    : dayLeft <= LIMITS.chatPerDayPerPerson * (1 - LIMITS.warnAt)
      ? `${dayLeft} question${dayLeft === 1 ? "" : "s"} left for you today.`
      : null;
  return { ok: true, dayLeft, monthLeft, warning };
}

/** May this client process a document again now? */
export function decideReprocess(actor: Actor, lastDay: number): { ok: true } | { ok: false; message: string } {
  if (actor === "admin" || lastDay < LIMITS.reprocessPerDayPerClient) return { ok: true };
  return {
    ok: false,
    message: `Documents can be processed again ${LIMITS.reprocessPerDayPerClient} times a day. Try again tomorrow, or ask For Granted.`,
  };
}

/** Should a client upload be read for readiness now, or wait? Uploads are never blocked. */
export function uploadReadNow(actor: Actor, lastDay: number): boolean {
  return actor === "admin" || lastDay < LIMITS.uploadReadsPerDayPerClient;
}

/**
 * Months run on Eastern time (decided 6 October 2026), for the limits and the
 * dashboard alike: a month starts at midnight in New York on the 1st, daylight
 * saving included, which is how For Granted and its clients think of a month.
 */
export const PORTAL_TIME_ZONE = "America/New_York";

function zoned(d: Date): { y: number; m: number; offsetMin: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_TIME_ZONE, year: "numeric", month: "2-digit", timeZoneName: "shortOffset",
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const off = get("timeZoneName").match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  const offsetMin = off ? Number(off[1]) * 60 + Math.sign(Number(off[1])) * Number(off[2] ?? 0) : 0;
  return { y: Number(get("year")), m: Number(get("month")), offsetMin };
}

/** The month a moment belongs to, in Eastern time, as "YYYY-MM". */
export function monthKey(d: Date): string {
  const { y, m } = zoned(d);
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** The instant the month containing `d` began: midnight Eastern on the 1st. */
export function monthStart(d: Date): Date {
  const { y, m } = zoned(d);
  // The offset in force at that midnight. Probe near it (04:30 UTC is around
  // midnight in New York either side of daylight saving), never at midday: when
  // daylight saving ends on 1 November, midnight is still EDT but noon is EST.
  const probe = new Date(Date.UTC(y, m - 1, 1, 4, 30));
  return new Date(Date.UTC(y, m - 1, 1) - zoned(probe).offsetMin * 60_000);
}
