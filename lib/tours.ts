// First-use tours and the "?" help menu (patch 15, onboarding build, 3 Nov 2026).
// Mockup "Portal Setup and Tours Mockup", Tour-FunderMatches.
//
// One short tour per tool, shown the first time a client opens it and again
// from the "?" menu. Each step points at an element marked data-tour="<target>";
// a step whose element is not on the page is left out, so a page that is
// empty or switched off never shows an arrow pointing at nothing.
// Pure and free of `server-only`, tested in tests/portal/tours.test.ts.

export interface TourStep { target: string; title: string; body: string }
export interface Tour { key: TourKey; path: string; name: string; steps: TourStep[] }

export const TOUR_KEYS = ["invenstory", "chat", "funder_matches", "drafts"] as const;
export type TourKey = (typeof TOUR_KEYS)[number];

export const TOURS: Record<TourKey, Tour> = {
  invenstory: {
    key: "invenstory", path: "/invenstory", name: "The Inven(s)tory",
    steps: [
      { target: "inv-start", title: "Getting started", body: "The first things to do, each with a button that does it. It goes away once they are done, or when you hide it." },
      { target: "inv-readiness", title: "The readiness check", body: "What funders usually ask for, and whether your Inven(s)tory already holds it. Anything missing says how to add it." },
      { target: "inv-upload", title: "Add documents", body: "Upload files to any layer. Each one is read, so chat, Story Cards and drafts can quote it." },
      { target: "inv-layers", title: "The three layers", body: "Layer I is your public story, Layer II how you work inside, Layer III your living voice. Drag a document to move it between layers." },
    ],
  },
  chat: {
    key: "chat", path: "/chat", name: "Chat",
    steps: [
      { target: "chat-tabs", title: "Two kinds of question", body: "Chat with your Inven(s)tory answers questions about your organization, from your documents. Portal Guide answers how the portal works, and never counts against your AI allowance." },
      { target: "chat-input", title: "Ask anything", body: "Enter sends, Shift and Enter starts a new line. Answers name the documents they came from; select one to open it." },
      { target: "chat-history", title: "Past conversations", body: "Every conversation is kept here. Start a new one whenever the subject changes." },
    ],
  },
  funder_matches: {
    key: "funder_matches", path: "/funding", name: "Funding",
    steps: [
      { target: "fm-search", title: "Search for funding", body: "Runs a search for your organization. Every result is screened against your Funding Eligibility first." },
      { target: "fm-sources", title: "Sources", body: "Every database we search, whether it is on, and why. Automatic follows what you told us you are looking for." },
      { target: "fm-results", title: "Open calls and funders", body: "Open calls you can apply to now, then funders to approach. Each one says why it fits. Mark anything Worth a look or Not for us, and your For Granted team sees it." },
      { target: "fm-report", title: "The fit report", body: "Every lead on one page you can print or share, grouped into Apply, Approach and Research first." },
    ],
  },
  drafts: {
    key: "drafts", path: "/drafts", name: "Drafts",
    steps: [
      { target: "drafts-head", title: "Your applications", body: "Every application your For Granted team is preparing with you, soonest deadline first." },
      { target: "drafts-filter", title: "Find one quickly", body: "Filter by where each application stands, or sort by when it was last edited." },
    ],
  },
};

export function isTourKey(v: unknown): v is TourKey {
  return typeof v === "string" && (TOUR_KEYS as readonly string[]).includes(v);
}

/** The tour for a page, by exact path or a path inside it. */
export function tourForPath(path: string): Tour | null {
  return Object.values(TOURS).find(t => path === t.path) ?? null;
}

/** The ui_prefs key that records a tour as seen. */
export function tourPrefKey(key: TourKey): string {
  return `tour_${key}`;
}

/** Shown on its own only to a client, and only once. `settingUp` holds it back (not used yet: teammates waiting on setup do get tours). */
export function autoStartTour(a: { key: TourKey; role: "admin" | "client"; prefs: Record<string, unknown> | null; settingUp?: boolean }): boolean {
  if (a.role !== "client" || a.settingUp) return false;
  return a.prefs?.[tourPrefKey(a.key)] !== true;
}

/** Keep only the steps whose element is on the page. */
export function presentSteps(steps: TourStep[], has: (target: string) => boolean): TourStep[] {
  return steps.filter(s => has(s.target));
}

/**
 * Where the step's card goes, beside a highlighted box. Below when there is
 * room, otherwise above; kept inside the window.
 */
export function placeCard(box: { top: number; left: number; width: number; height: number }, view: { width: number; height: number }, card = { width: 320, height: 190 }): { top: number; left: number } {
  const gap = 14;
  const below = box.top + box.height + gap;
  const top = below + card.height <= view.height ? below : Math.max(8, box.top - gap - card.height);
  const left = Math.min(Math.max(8, box.left + box.width - card.width), view.width - card.width - 8);
  return { top, left: Math.max(8, left) };
}

/** Start a tour from anywhere (the "?" menu, Portal Guide). */
export const TOUR_EVENT = "portal:tour";

/** Switch the chat page to a tab ("invenstory" or "guide") while already on it. */
export const CHAT_TAB_EVENT = "portal:chat-tab";
