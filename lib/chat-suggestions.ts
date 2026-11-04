// Three suggested questions for each chat tab, each set with a line saying
// why (patch 16, onboarding build, 3 November 2026). Pure, tested in
// tests/portal/portal-guide.test.ts.
import { searchMissing, type GuideStatus } from "./portal-guide";
import type { TourKey } from "./tours";

export interface Suggestion { text: string; tour?: TourKey }
export interface SuggestionSet { why: string; items: Suggestion[] }

const DAY = 24 * 3600_000;

export function invenstorySuggestions(a: { recentDoc: { title: string; at: string } | null; hasMatches: boolean; docCount: number; now?: Date }): SuggestionSet {
  const now = a.now ?? new Date();
  const fitQ = a.hasMatches ? "Which funder fits us best, and why?" : "What would a funder want to know about us first?";
  if (a.recentDoc && now.getTime() - Date.parse(a.recentDoc.at) < 3 * DAY) {
    const t = a.recentDoc.title.length > 60 ? `${a.recentDoc.title.slice(0, 57)}...` : a.recentDoc.title;
    return {
      why: `Suggested because you just added ${t}`,
      items: [{ text: `What did you learn from ${t}?` }, { text: "What is missing before we can apply?" }, { text: fitQ }],
    };
  }
  if (a.docCount === 0) {
    return {
      why: "Suggested because your Inven(s)tory has no documents yet, so answers will be thin",
      items: [{ text: "What kinds of documents should we add first?" }, { text: "What is our mission?" }, { text: "What is missing before we can apply?" }],
    };
  }
  return {
    why: "Suggested to get you started",
    items: [{ text: "What is our mission?" }, { text: "Share a story about our impact." }, { text: fitQ }],
  };
}

export function guideSuggestions(s: GuideStatus): SuggestionSet {
  if (s.tools.funder_matches && searchMissing(s).length) {
    return {
      why: "Suggested because Funder Matches cannot search yet",
      items: [{ text: "Why can't I search for funding yet?" }, { text: "How do Sources work?" }, { text: "Show me around Funder Matches", tour: "funder_matches" }],
    };
  }
  if (s.setupSkipped.length) {
    return {
      why: "Suggested because some setup steps are still to do",
      items: [{ text: "What is left to set up, and why does it matter?" }, { text: "What should go in Layer III?" }, { text: "Show me around the Inven(s)tory", tour: "invenstory" }],
    };
  }
  if (s.tools.funder_matches) {
    return {
      why: "Suggested to get you started",
      items: [
        { text: s.hasMatches ? "How do I read the fit report?" : s.selfSearch ? "How do I run a search?" : "How do I see the funders found for us?" },
        { text: "How do Story Cards work?" },
        { text: "Show me around Funder Matches", tour: "funder_matches" },
      ],
    };
  }
  return {
    why: "Suggested to get you started",
    items: [{ text: "What should go in each layer?" }, { text: "How do Story Cards work?" }, { text: "Show me around the Inven(s)tory", tour: "invenstory" }],
  };
}
