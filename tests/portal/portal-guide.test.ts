/** The Portal Guide and the chat suggestions (patch 16, onboarding build, 3 Nov 2026). */
import { describe, expect, test } from "vitest";
import {
  looksLikePortalQuestion, looksLikeOrgQuestion, guideButtons, statusLines, searchMissing, fallbackAnswer, GUIDE_TEXT, GUIDE_SYSTEM,
  HANDOVER_TO_GUIDE, type GuideStatus,
} from "@/lib/portal-guide";
import { invenstorySuggestions, guideSuggestions } from "@/lib/chat-suggestions";

const status = (over: Partial<GuideStatus> = {}): GuideStatus => ({
  orgName: "Riverbend Youth Arts", role: "client", setupSkipped: [],
  eligibility: { orgType: true, causeAreas: true, country: true, kinds: true },
  docs: { I: 3, II: 1, III: 0, reading: 0 }, hasMatches: false,
  tools: { chat: true, funder_matches: true, drafts: true, card_review: true, eligibility: true },
  selfSearch: true, ...over,
});

describe("which tab a question belongs in", () => {
  test.each([
    "How do I run a search?", "how can I upload our budget", "Where is the fit report?", "Why can't I search for funding yet?",
    "How do I invite a teammate?", "show me around", "How do Sources work?",
  ])("portal: %s", q => expect(looksLikePortalQuestion(q)).toBe(true));
  test.each([
    "What is our mission?", "What did you learn from our strategic plan?", "Share a story about our impact.", "Which funder fits us best, and why?",
  ])("not portal: %s", q => expect(looksLikePortalQuestion(q)).toBe(false));
  test("organization questions are sent to the Inven(s)tory tab, how-tos are not", () => {
    expect(looksLikeOrgQuestion("What is our mission?")).toBe(true);
    expect(looksLikeOrgQuestion("What did you learn from the strategic plan?")).toBe(true);
    expect(looksLikeOrgQuestion("How do I upload our budget?")).toBe(false);
    expect(looksLikeOrgQuestion("How do Sources work?")).toBe(false);
  });
  test("the hand-over names the organization", () => {
    expect(HANDOVER_TO_GUIDE("Riverbend Youth Arts")).toContain("Riverbend Youth Arts’ documents".replace("’", "'"));
    expect(HANDOVER_TO_GUIDE("Friends of the Parks")).toContain("Friends of the Parks' documents");
  });
});

describe("buttons under a guide answer", () => {
  test("a search question gets the Funder Matches tour, and Funding Eligibility when a search is blocked", () => {
    const b = guideButtons("Why can't I search for funding yet?", status({ eligibility: { orgType: true, causeAreas: false, country: true, kinds: true } }));
    expect(b.map(x => x.label)).toEqual(["Open Funding Eligibility", "Show me around Funding"]);
  });
  test("no tour for a tool that is switched off", () => {
    const b = guideButtons("How do I run a search?", status({ tools: { chat: true, funder_matches: false, drafts: true, card_review: true, eligibility: true } }));
    expect(b.find(x => x.kind === "tour" && x.tour === "funder_matches")).toBeUndefined();
  });
  test("at most three, never twice", () => {
    const b = guideButtons("how do I upload documents and search funders and draft an application in chat", status());
    expect(b.length).toBeLessThanOrEqual(3);
    expect(new Set(b.map(x => x.label)).size).toBe(b.length);
  });
});

describe("what the guide is told", () => {
  test("status says what a search still needs, and holds no document content", () => {
    const s = status({ eligibility: { orgType: false, causeAreas: false, country: true, kinds: true }, setupSkipped: ["layer3"] });
    expect(searchMissing(s)).toEqual(["your organization type", "at least one cause area"]);
    const lines = statusLines(s).join("\n");
    expect(lines).toContain("cannot search yet");
    expect(lines).toContain("Layer III (living voice)");
  });
  test("the guide names every tool and has no em dashes", () => {
    for (const t of ["THE INVEN(S)TORY", "FUNDING ELIGIBILITY", "FUNDING", "CHAT", "STORY CARDS", "DRAFTS", "HELP"]) expect(GUIDE_TEXT).toContain(t);
    expect(GUIDE_TEXT + GUIDE_SYSTEM).not.toMatch(/—/);
  });
  test("without the model, the closest guide section is given", () => {
    expect(fallbackAnswer("how do sources and the fit report work")).toContain("Sources");
    expect(fallbackAnswer("zzzz")).toContain("could not write an answer");
  });
});

describe("suggestions", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  test("a document added in the last three days leads", () => {
    const s = invenstorySuggestions({ recentDoc: { title: "Strategic Plan 2026", at: "2026-11-02T10:00:00Z" }, hasMatches: true, docCount: 4, now });
    expect(s.why).toContain("Strategic Plan 2026");
    expect(s.items.map(i => i.text)).toEqual(["What did you learn from Strategic Plan 2026?", "What is missing before we can apply?", "Which funder fits us best, and why?"]);
  });
  test("an older document does not", () => {
    expect(invenstorySuggestions({ recentDoc: { title: "Old", at: "2026-10-01T00:00:00Z" }, hasMatches: false, docCount: 4, now }).why).toBe("Suggested to get you started");
  });
  test("an empty Inven(s)tory says so", () => {
    expect(invenstorySuggestions({ recentDoc: null, hasMatches: false, docCount: 0, now }).why).toContain("no documents yet");
  });
  test("the guide leads with what blocks a search, offering the tour", () => {
    const g = guideSuggestions(status({ eligibility: { orgType: true, causeAreas: false, country: true, kinds: true } }));
    expect(g.why).toContain("cannot search yet");
    expect(g.items[2].tour).toBe("funder_matches");
  });
  test("never offers a tool that is switched off", () => {
    const g = guideSuggestions(status({ tools: { chat: true, funder_matches: false, drafts: false, card_review: true, eligibility: true } }));
    expect(g.items.some(i => i.tour === "funder_matches" || /search/i.test(i.text))).toBe(false);
  });
  test("then what setup left for later", () => {
    expect(guideSuggestions(status({ setupSkipped: ["team"] })).why).toContain("setup steps");
  });
});
