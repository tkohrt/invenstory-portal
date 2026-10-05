// Phase C: the client's eligibility confirmations and what opens up.
import { describe, expect, test } from "vitest";
import { openSuggestions, applySuggestion, suggestionKey, unlocks } from "@/lib/analysis-client";
import type { Suggestion } from "@/lib/analysis-derive";
import { EMPTY_PROFILE } from "@/lib/eligibility-fields";

const src = [{ id: "d1", title: "Proposal", quote: "EIN 12-3456789" }];
const sug = (over: Partial<Suggestion>): Suggestion => ({
  field: "ein", label: "EIN", values: [{ value: "12-3456789", display: "12-3456789", sources: src }],
  conflicting: false, compare: "new", current: [], ...over,
});

describe("openSuggestions", () => {
  test("a value already in the profile needs no answer", () => {
    expect(openSuggestions([sug({ current: ["123456789"], compare: "matches" })], [])).toEqual([]);
  });

  test("a value the client turned down is not offered again; others still are", () => {
    const s = sug({
      field: "populations", label: "Populations served", compare: "new",
      values: [
        { value: "Older adults", display: "Older adults", sources: src },
        { value: "Caregivers", display: "Caregivers", sources: src },
      ],
    });
    const open = openSuggestions([s], [{ field: "populations", valueKey: "older adults", decision: "rejected" }]);
    expect(open).toHaveLength(1);
    expect(open[0].open.map(v => v.value)).toEqual(["Caregivers"]);
  });

  test("EIN identity ignores punctuation", () => {
    expect(suggestionKey("ein", "12-3456789")).toBe(suggestionKey("ein", "123456789"));
  });
});

describe("applySuggestion", () => {
  test("a list field gains the value once", () => {
    const p = { ...EMPTY_PROFILE, populations: ["Caregivers"] };
    const next = applySuggestion(p, "populations", "Older adults");
    expect(next.populations).toEqual(["Caregivers", "Older adults"]);
    expect(applySuggestion(next, "populations", "older adults").populations).toEqual(["Caregivers", "Older adults"]);
  });

  test("a one-value field takes the value", () => {
    expect(applySuggestion({ ...EMPTY_PROFILE, state_code: "KY" }, "state_code", "OH").state_code).toBe("OH");
  });
});

describe("unlocks", () => {
  test("Funder Matches needs eligibility confirmed and every Essential at least thin", () => {
    expect(unlocks({ analysed: true, eligibilityConfirmed: true, essentialsThin: true }).funderMatches).toBe(true);
    const u = unlocks({ analysed: true, eligibilityConfirmed: false, essentialsThin: false });
    expect(u.funderMatches).toBe(false);
    expect(u.funderMatchesWaitingOn).toHaveLength(2);
    expect(u.storyCards).toBe(true);
  });
});
