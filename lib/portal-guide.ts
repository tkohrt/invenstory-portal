// The Portal Guide (patch 16, onboarding build, 3 November 2026).
//
// The second chat tab: questions about using the portal, answered from the
// guide below and from where the account stands (setup, eligibility, which
// tools are on). It never reads the client's documents, and its cost is never
// counted against the client's AI allowance (recorded as For Granted's own,
// actor "system", feature "portal_guide"). A per-person limit keeps it from
// being used as free general-purpose AI.
//
// Questions in the wrong tab are handed over, decided here without any AI.
// Pure and free of `server-only`, tested in tests/portal/portal-guide.test.ts.
import type { TourKey } from "./tours";

export const GUIDE_LIMITS = { questionChars: 600, perHour: 30, perDay: 100 } as const;

export interface GuideStatus {
  orgName: string;
  role: "admin" | "client";
  /** Setup steps the client skipped (lib/setup.ts keys). */
  setupSkipped: string[];
  eligibility: { orgType: boolean; causeAreas: boolean; country: boolean; kinds: boolean };
  docs: { I: number; II: number; III: number; reading: number };
  hasMatches: boolean;
  /** Tools switched on for this client. */
  tools: { chat: boolean; funder_matches: boolean; drafts: boolean; card_review: boolean; eligibility: boolean };
  selfSearch: boolean;
}

export interface GuideAction { kind: "tour"; tour: TourKey; label: string }
export interface GuideLink { kind: "link"; href: string; label: string }
export type GuideButton = GuideAction | GuideLink;

const norm = (q: string) => q.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

const PORTAL_WORDS = /\b(portal|button|tab|page|menu|sidebar|tour|upload|log ?in|sign ?in|password|account|invite|teammate|login|setting|sources?|fit report|funder matches|storyboard(ing)?|story cards?|readiness check|getting started|funding eligibility|allowance|chat|draft an application|search(es|ing)?|run (a|the) search|layer (i{1,3}|1|2|3)|the plant|garden)\b/;
const HOW_TO = /^(how (do|can|should) (i|we)|where (do|can|is|are)|why (can't|cannot|can i not|won't|isn't|is it not)|what (does|do) (the|this|that) .*(do|mean)|can (i|we) (upload|add|change|delete|invite|search|export|download|print|share)|what happens (when|if) i|is there a way to)\b/;

/** A question about using the portal, not about the organization. */
export function looksLikePortalQuestion(q: string): boolean {
  const t = norm(q);
  if (!t) return false;
  if (HOW_TO.test(t) && PORTAL_WORDS.test(t)) return true;
  if (/^how (does|do) (the )?[a-z()' ]{2,30} work\b/.test(t) && PORTAL_WORDS.test(t)) return true;
  return /^(show me around|give me a tour|take the tour|how does (the )?portal work)/.test(t);
}

const ORG_WORDS = /\b(our|my organi[sz]ation'?s?|we|us)\b.*\b(mission|vision|history|founding|founder|budget|revenue|programs?|outcomes?|impact|board|staff|team|strategy|strategic plan|theory of change|story|stories|population|community|partners?|evaluation|results|numbers)\b|\bwhat did you learn from\b|\bsummari[sz]e (our|the) /;

/** A question about the organization's own story, which only the Inven(s)tory tab can answer. */
export function looksLikeOrgQuestion(q: string): boolean {
  const t = norm(q);
  if (looksLikePortalQuestion(t)) return false;
  return ORG_WORDS.test(t);
}

/** What Funder Matches still needs before a search can run. */
export function searchMissing(s: GuideStatus): string[] {
  const out: string[] = [];
  if (!s.eligibility.orgType) out.push("your organization type");
  if (!s.eligibility.causeAreas) out.push("at least one cause area");
  return out;
}

/** Buttons under an answer: a tour, or the page that fixes what is missing. */
export function guideButtons(q: string, s: GuideStatus): GuideButton[] {
  const t = norm(q);
  const out: GuideButton[] = [];
  const missing = searchMissing(s);
  const about = (re: RegExp) => re.test(t);
  if (about(/\b(search|funder|funders|match|matches|sources?|fit report|open calls?)\b/)) {
    if (missing.length && s.tools.eligibility) out.push({ kind: "link", href: "/funding-eligibility", label: "Open Funding Eligibility" });
    if (s.tools.funder_matches) out.push({ kind: "tour", tour: "funder_matches", label: "Show me around Funding" });
  }
  if (about(/\b(upload|document|documents|layer|layers|readiness|getting started|inven\(s\)tory|invenstory)\b/)) {
    out.push({ kind: "tour", tour: "invenstory", label: "Show me around the Inven(s)tory" });
  }
  if (about(/\b(draft|drafts|application|applications|storyboard)/) && s.tools.drafts) {
    out.push({ kind: "tour", tour: "drafts", label: "Show me around Drafts" });
  }
  if (about(/\b(chat|ask|question|portal guide|allowance)\b/) && s.tools.chat) {
    out.push({ kind: "tour", tour: "chat", label: "Show me around Chat" });
  }
  if (about(/^(show me around|give me a tour|take the tour)/) && !out.length) {
    out.push({ kind: "tour", tour: "invenstory", label: "Show me around the Inven(s)tory" });
  }
  const seen = new Set<string>();
  return out.filter(b => { const k = b.kind === "tour" ? b.tour : b.href; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
}

/** Where the account stands, as plain lines for the model. Never document content. */
export function statusLines(s: GuideStatus): string[] {
  const missing = searchMissing(s);
  const lines = [
    `Organization: ${s.orgName}. The person asking is ${s.role === "admin" ? "on the For Granted team" : "a client"}.`,
    missing.length
      ? `Funding cannot search yet: Funding Eligibility still needs ${missing.join(" and ")}.`
      : "Funding Eligibility has what a search needs.",
    `Documents: Layer I ${s.docs.I}, Layer II ${s.docs.II}, Layer III ${s.docs.III}${s.docs.reading ? `, ${s.docs.reading} still being read` : ""}.`,
    s.hasMatches ? "Funding has results." : "Funding has no results yet.",
    s.selfSearch ? "This client can run searches themselves." : "Searches are run by the For Granted team for this client.",
  ];
  const off = Object.entries(s.tools).filter(([, on]) => !on).map(([k]) => TOOL_NAME[k as keyof GuideStatus["tools"]]);
  if (off.length) lines.push(`Switched off for this client: ${off.join(", ")}.`);
  if (s.setupSkipped.length) lines.push(`Setup steps left for later: ${s.setupSkipped.map(k => SETUP_NAME[k] ?? k).join(", ")}.`);
  return lines;
}

const TOOL_NAME: Record<keyof GuideStatus["tools"], string> = {
  chat: "Chat", funder_matches: "Funding", drafts: "Drafts", card_review: "Story Cards", eligibility: "Funding Eligibility",
};
const SETUP_NAME: Record<string, string> = {
  eligibility: "Funding Eligibility", layer1: "Layer I documents", layer2: "Layer II documents", layer3: "Layer III (living voice)",
  funding: "funders already known", team: "adding teammates",
};

/**
 * The guide to the portal. Facts about how it works today, nothing promised.
 * Update this when a tool changes; the tests check it names every tool.
 */
export const GUIDE_TEXT = `
THE PORTAL
For Granted's client portal. The person brings their organization's story; the portal's AI tools help them find funders and draft from it. For Granted's team works alongside them.
The search bar at the top suggests as the person types: documents by name (opening in the reader), grants from their Funding page (open calls, watchlist and saved), matched funders, and drafts where visible. Choosing a suggestion goes straight to the thing; "Search everything" opens the full Search page, which also looks inside document text.

THE INVEN(S)TORY (sidebar: the organization's Inven(s)tory)
Everything that makes the organization fundable, in three layers. Layer I, public story: what the world can see, such as annual reports, the tax filing, press, the website. Layer II, internal strategy: plans, budgets, past applications, board minutes. Layer III, living voice: why the work matters, in the founder's or leader's own words, from an interview, a transcript, or written answers to the Living Voice questions.
Upload with the "+ Upload" button, choosing a layer. Accepted: PDF, Word, text, CSV, HTML, Excel. Audio files are accepted but cannot be read yet: upload a transcript instead, or email the recording to info@forgranted.com. Images and slide decks can be emailed to info@forgranted.com. Up to 25 MB a file. Each document is read so chat, Story Cards and drafts can quote it. A document can be dragged to another layer.
Getting started lists the first things to do. The readiness check shows what funders usually ask for and whether the Inven(s)tory holds it; "Run Readiness Check" refreshes it.

FUNDING ELIGIBILITY
Who can fund the organization: organization type, where it is registered, cause areas, and what kind of money it wants (grants, contracts and RFPs, accelerators and prizes). Optional answers sharpen matches: budget, other countries, federal (SAM.gov) registration, ability to match funds. A search needs at least the organization type and one cause area.

FUNDING
One page, two modes, switched with the Grants and Funders pills at the top (each mode can be turned on separately per client). GRANTS MODE (Grant Finder): open calls screened against Funding Eligibility first, then the soonest deadline, with a snapshot of counts above the table. Below the open calls, "Not open now, worth watching" lists closed calls that screened as a real fit, most recently closed first; funders often run the same programme each year. A Save star on any grant row keeps it in "Saved for later", a bucket that survives every new search, so a call that reopens is already flagged: each search rechecks the saved list, marks a saved grant "Open again" when its call is live once more, and the page's notification bar leads with that news. The bar shows at most one notice per visit (a reopened saved grant, a deadline within two weeks on a saved grant, a newly verified funder, or a search gone stale) and each can be dismissed for good. FUNDERS MODE (Funder Compass): funders whose giving lines up with the organization's work, with the evidence of who they already fund. The left rail lists every past search with its date and counts; "Current results" on top says how fresh the page is. Selecting a past search opens a short read-only summary: what it kept, what was new, what dropped off, and which sources answered.
"Your matching profile" (the button beside the Grants/Funders switch) shows every fact the searches run on, each with the verbatim line from the person's own documents it came from, and which search it feeds. Three verbs: Confirm stamps a fact as right; Remove takes it out of the searches instantly (one click, no reason needed, undoable; For Granted is notified); "Not right" flags wording that reads wrong for For Granted, who fix it at the source so the profile stays backed by evidence. There is no direct edit box, on purpose. "Search for funding" runs a search of both modes at once (or the For Granted team runs it, for clients without self-service search). Sources shows every database searched, whether it is on, and why; Automatic follows Funding Eligibility. Mark a lead "Worth a look" or "Not for us" and the For Granted team sees it. "Open the fit report" puts every lead on one printable page, grouped into Apply, Approach and Research first. Every match is a lead: check deadlines and eligibility on the funder's own site.

CHAT
Two tabs. "Chat with your Inven(s)tory" answers questions about the organization from its own Story Cards and documents, naming each source; select a source to open the document. Its questions count toward the monthly AI allowance. "Portal Guide" answers how to use the portal and never counts against the allowance. Enter sends; Shift and Enter makes a new line; Stop ends an answer being written. Past conversations are kept in the side panel; "+ New chat" starts another.

STORY CARDS
Short, sourced statements drawn from the documents (a fact, a number, a story, a quote), each tracing to where it came from. The client can confirm a card, edit it, or mark it out of date. Drafts are built from Story Cards.

DRAFTS AND THE STORYBOARDING TOOL
Grant applications being prepared with For Granted, soonest deadline first. The Storyboarding Tool turns a funder's questions into answers built from Story Cards, then drafts and polishes them. For now the For Granted team starts new applications.

ACCOUNT AND TEAM
Account holds the person's name and preferences. Teammates are added by the For Granted team: during setup the client lists them, or emails info@forgranted.com. There is no view-only login yet.

HELP
The "?" in the top bar: a tour of the current page, this Portal Guide, and email to For Granted (info@forgranted.com).
`.trim();

export const GUIDE_SYSTEM = `You are the Portal Guide inside For Granted's client portal. Answer questions about how to use the portal, using only the GUIDE and the ACCOUNT STATUS given. Rules:
- Two to five short sentences, plain words, no headings, no lists unless steps are needed. Never use em dashes.
- Say exactly where to click, using the button names in the GUIDE.
- Use the ACCOUNT STATUS to make the answer specific (for example, what a search still needs).
- If the GUIDE does not say, say you are not sure and suggest emailing info@forgranted.com. Never invent a feature, a price, a date or a promise.
- You cannot see the organization's documents. If asked about the organization's own story, numbers or programs, say that the "Chat with your Inven(s)tory" tab answers those.
- Do not answer questions unrelated to the portal or the organization's funding work; say briefly that you only help with the portal.`;

export function guideUserPrompt(q: string, s: GuideStatus): string {
  return `GUIDE\n${GUIDE_TEXT}\n\nACCOUNT STATUS\n${statusLines(s).join("\n")}\n\nQUESTION\n${q}`;
}

/** When the model is unavailable: the guide section the question is most about. */
export function fallbackAnswer(q: string): string {
  const t = norm(q);
  const sections = GUIDE_TEXT.split(/\n\n+/).map(sec => {
    const [head, ...rest] = sec.split("\n");
    return { head, body: rest.join(" ") };
  });
  const STOP = new Set(["what", "when", "where", "does", "work", "with", "about", "have", "this", "that", "there", "your", "they", "from", "into", "should", "could", "would", "which"]);
  const words = t.split(/[^a-z0-9()]+/).filter(w => w.length > 3 && !STOP.has(w));
  let best = sections[0], score = -1;
  for (const sec of sections) {
    const hay = `${sec.head} ${sec.body}`.toLowerCase();
    const n = words.reduce((k, w) => k + (hay.includes(w) ? 1 : 0), 0);
    if (n > score) { best = sec; score = n; }
  }
  return score > 0
    ? `The Portal Guide could not write an answer just now, so here is the part of the guide that seems closest. ${best.body}`
    : "The Portal Guide could not write an answer just now. Try again in a moment, or email info@forgranted.com.";
}

export const HANDOVER_TO_GUIDE = (org: string) =>
  `That is a question about using the portal. I answer only from ${org}${org.endsWith("s") ? "'" : "'s"} documents, so the Portal Guide is the better place for it.`;
export const HANDOVER_TO_INVENSTORY =
  "That is a question about your organization. I cannot see your documents, so Chat with your Inven(s)tory is the better place for it.";
