import { describe, expect, it } from "vitest";
import { parseSuggestReply, pendingSuggestion, screenSuggestions, suggestUser, suggestionRefusal } from "@/lib/suggest-wording";

const card = "Our mentors meet each of the 240 students in the program every week during the school year.";

describe("suggested wording on a card (Auto-Draft patch 8)", () => {
  describe("the check every suggestion passes", () => {
    it("lets through the same card, reworded", () => {
      expect(suggestionRefusal(card, "Every week of the school year, our mentors meet each of the 240 students in the program.")).toBeNull();
    });
    it("refuses the same words again", () => {
      expect(suggestionRefusal(card, `  ${card.toUpperCase()} `)).toBe("same");
    });
    it("refuses a changed or added number, a new name, or a changed quotation", () => {
      expect(suggestionRefusal(card, "Our mentors meet each of the 250 students in the program every week during the school year.")).toBe("number");
      expect(suggestionRefusal(card, "Our Kresge mentors meet each of the 240 students in the program every week during the school year.")).toBe("name");
      expect(suggestionRefusal('Ana said "it changed my life" after the program.', 'Ana said "it changed everything" after the program.')).toBe("quote");
    });
    it("refuses wording that adds or drops a negative, turning the claim around", () => {
      expect(suggestionRefusal("Most participants did not drop out of the program last year.", "Most participants did drop out of the program last year.")).toBe("negation");
      expect(suggestionRefusal("Families never wait for a placement in the program.", "Families wait for a placement in the program.")).toBe("negation");
      expect(suggestionRefusal("Families don't wait for a placement in the program.", "Families do not wait for a placement in the program.")).toBeNull();
    });
    it("refuses wording much longer or much shorter than the card", () => {
      expect(suggestionRefusal(card, `${card} ${"Mentors build lasting trust with students and families over many months. ".repeat(2)}`)).toBe("long");
      expect(suggestionRefusal(card, "Mentors meet weekly.")).toBe("short");
    });
    it("refuses wording that keeps too few of the card's own words to be the same card", () => {
      expect(suggestionRefusal(card, "Volunteers coach every learner across the term, building confidence through practice sessions daily.")).toBe("drift");
    });
  });

  describe("reading the reply", () => {
    it("reads suggestions by card number", () => {
      const r = parseSuggestReply('Sure: {"suggestions":[{"n":2,"text":"  New   words. "}]}', 3);
      expect([...r!]).toEqual([[2, "New words."]]);
    });
    it("reads an empty list as nothing to suggest", () => {
      expect(parseSuggestReply('{"suggestions": []}', 3)?.size).toBe(0);
    });
    it("skips a number off the list, a repeat, or a suggestion with no text", () => {
      const r = parseSuggestReply('{"suggestions":[{"n":4,"text":"x"},{"n":1,"text":"a"},{"n":1,"text":"b"},{"n":2}]}', 3);
      expect([...r!]).toEqual([[1, "a"]]);
    });
    it("is null when there is no usable reply", () => {
      expect(parseSuggestReply("no json", 3)).toBeNull();
      expect(parseSuggestReply('{"text":"x"}', 3)).toBeNull();
    });
  });

  it("keeps only suggestions that pass, and counts the rest", () => {
    const s = screenSuggestions([card, card], new Map([[1, "Mentors meet weekly."], [2, "Every week of the school year, our mentors meet each of the 240 students in the program."]]));
    expect([...s.kept.keys()]).toEqual([2]);
    expect(s.refused).toBe(1);
  });

  it("waits on a person only on an unedited card with a suggestion", () => {
    expect(pendingSuggestion({ kind: "card", edited: false, suggested: "x" })).toBe(true);
    expect(pendingSuggestion({ kind: "card", edited: true, suggested: "x" })).toBe(false);
    expect(pendingSuggestion({ kind: "card", edited: false, suggested: null })).toBe(false);
    expect(pendingSuggestion({ kind: "human", edited: false, suggested: "x" })).toBe(false);
  });

  it("builds a prompt that sends only what is given", () => {
    const u = suggestUser({ question: "Describe  your program.", guidance: null, answer: "A. B.",
      cards: [{ n: 1, kindLabel: "Program model", text: "We teach coding." }], voiceProfile: "", funderContext: "", clientContext: "" });
    expect(u).toContain("1. [Program model, 3 words] We teach coding.");
    expect(u).not.toContain("<voice_profile>");
    expect(u).not.toContain("<funder_context>");
  });
});
