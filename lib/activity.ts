// The rules behind Admin, Client activity (decided 6 October 2026).
//
// Months are Eastern time, the same as the usage limits. Chat is shown as counts
// and broad topics only: questions are sorted into topics here, by keywords,
// on the server, and only the counts leave it. A grant draft is flagged when it
// has stalled near its deadline. Pure, so it is tested without a database.
import { monthKey, monthStart, PORTAL_TIME_ZONE } from "./usage-limits";

// ---------------------------------------------------------------------------
// Months and days, Eastern time.
// ---------------------------------------------------------------------------

export function isMonthKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** The instants a month runs between, [start, end), for "YYYY-MM" in Eastern time. */
export function monthRange(key: string): { start: Date; end: Date } {
  const [y, m] = key.split("-").map(Number);
  const start = monthStart(new Date(Date.UTC(y, m - 1, 15, 12)));
  const end = monthStart(new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 15, 12)));
  return { start, end };
}

/** The last `n` months up to the one containing `now`, oldest first. */
export function recentMonths(n: number, now = new Date()): string[] {
  const [y, m] = monthKey(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** The Eastern-time day a moment falls on, "YYYY-MM-DD". */
export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PORTAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Chat topics: counts only, never the text.
// ---------------------------------------------------------------------------

export const CHAT_TOPICS: { key: string; label: string; words: RegExp }[] = [
  { key: "funders", label: "Funders and grants", words: /\b(funders?|grants?|foundations?|rfps?|deadlines?|applications?|apply|award(s|ed)?|sponsor(s|ship)?|donors?)\b/i },
  { key: "finances", label: "Budget and finances", words: /\b(budget|financ\w*|revenue|cost|costs|expenses?|funding|money|dollars?|income|990|audit|raise|raised|valuation|investors?)\b/i },
  { key: "impact", label: "Outcomes and impact", words: /\b(outcomes?|impact|results?|metrics?|data|evaluation|measure\w*|served|success(es)?|statistics?)\b/i },
  { key: "programs", label: "Programs and services", words: /\b(programs?|services?|product|platform|model|how (do|does) (we|it)|offer\w*|pilot)\b/i },
  { key: "people", label: "Team and leadership", words: /\b(team|staff|board|founder|leadership|ceo|director|employees?|hire|hiring|volunteers?)\b/i },
  { key: "partners", label: "Partners", words: /\b(partners?(hips?)?|collaborat\w*|mou|letters? of support)\b/i },
  { key: "eligibility", label: "Eligibility and registration", words: /\b(eligib\w*|ein|uei|sam\.gov|sam|501\(?c\)?|tax.?exempt|registration|incorporat\w*|state)\b/i },
  { key: "story", label: "Mission and story", words: /\b(mission|vision|story|history|founded|why|values?|origin)\b/i },
  { key: "documents", label: "About the documents", words: /\b(documents?|uploads?|files?|summar\w*|transcript|deck|report)\b/i },
];

/** The topic of one question: the first that matches, in the order above, else "other". */
export function chatTopic(question: string): string {
  for (const t of CHAT_TOPICS) if (t.words.test(question)) return t.key;
  return "other";
}

export const TOPIC_LABEL: Record<string, string> = {
  ...Object.fromEntries(CHAT_TOPICS.map(t => [t.key, t.label])), other: "Other",
};

/** Counts by topic, largest first. Takes the questions, returns no text. */
export function topicCounts(questions: string[]): { key: string; label: string; count: number }[] {
  const by = new Map<string, number>();
  for (const q of questions) { const k = chatTopic(q); by.set(k, (by.get(k) ?? 0) + 1); }
  return [...by].map(([key, count]) => ({ key, label: TOPIC_LABEL[key] ?? key, count })).sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// A grant draft stalled near its deadline.
// ---------------------------------------------------------------------------

export const STALL = { deadlineWithinDays: 21, idleDays: 7 } as const;
const OPEN = new Set(["drafting", "client_review"]);

export type StallState = { stalled: false } | { stalled: true; daysToDeadline: number; idleDays: number; pastDue: boolean };

/**
 * Stalled: still open, due within 21 days (or already past due), and nothing in
 * it has changed for 7 days. `lastEdit` is the latest change anywhere in the
 * draft: the draft itself, its questions, or a card placed or moved.
 */
export function stallState(d: { status: string; deadline: string | null; lastEdit: string }, now = new Date()): StallState {
  if (!OPEN.has(d.status) || !d.deadline) return { stalled: false };
  const day = 24 * 3600_000;
  const due = new Date(`${d.deadline.slice(0, 10)}T23:59:59Z`).getTime();
  const daysToDeadline = Math.ceil((due - now.getTime()) / day);
  const idleDays = Math.floor((now.getTime() - new Date(d.lastEdit).getTime()) / day);
  if (daysToDeadline > STALL.deadlineWithinDays || idleDays < STALL.idleDays) return { stalled: false };
  return { stalled: true, daysToDeadline, idleDays, pastDue: daysToDeadline < 0 };
}

// ---------------------------------------------------------------------------
// Visits (patch 2): which part of the portal a page is, with ids removed.
// ---------------------------------------------------------------------------

/** A person's use of one part of the portal is recorded at most this often. */
export const VISIT_GAP_MINUTES = 30;

export const FEATURES: { key: string; label: string; prefix: string }[] = [
  { key: "invenstory", label: "Inven(s)tory", prefix: "/invenstory" },
  { key: "chat", label: "Ask your Inven(s)tory", prefix: "/chat" },
  { key: "search", label: "Search", prefix: "/search" },
  { key: "eligibility", label: "Funding Eligibility", prefix: "/funding-eligibility" },
  { key: "funder_matches", label: "Funder Matches", prefix: "/funder-matches" },
  { key: "story_cards", label: "Story Cards", prefix: "/story-cards" },
  { key: "analysis", label: "Analyze my Inven(s)tory", prefix: "/analysis" },
  { key: "drafts", label: "Drafts", prefix: "/drafts" },
  { key: "story_intelligence", label: "Story Intelligence", prefix: "/story-intelligence" },
  { key: "garden", label: "Garden", prefix: "/plant" },
  { key: "account", label: "Account", prefix: "/account" },
];
export const FEATURE_LABEL: Record<string, string> = Object.fromEntries(FEATURES.map(f => [f.key, f.label]));

/** The path as recorded: no query string or fragment, ids and long tokens replaced. */
export function cleanPath(raw: string): string {
  const path = (raw.split(/[?#]/)[0] || "/").slice(0, 200);
  return path.split("/").map(seg =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || /^\d+$/.test(seg) || seg.length > 40 ? ":id" : seg,
  ).join("/") || "/";
}

/** Which part of the portal a path belongs to, or null for pages not worth recording (admin, sign-in). */
export function featureForPath(path: string): string | null {
  if (path.startsWith("/admin") || path.startsWith("/auth") || path === "/") return null;
  const f = FEATURES.find(x => path === x.prefix || path.startsWith(`${x.prefix}/`));
  return f ? f.key : "other";
}
