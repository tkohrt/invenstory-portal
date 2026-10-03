// The rule for which Story Cards may go into a grant answer (2 October 2026).
import { describe, expect, test } from "vitest";
import { placeIssue, canPlace, finishBlockers, describeBlockers, type GateCard } from "@/lib/card-gate";

const verified: GateCard = { status: "verified" };
const suggested: GateCard = { status: "suggested" };

describe("placeIssue", () => {
  test("only a verified card may be placed", () => {
    expect(placeIssue(verified)).toBeNull();
    expect(canPlace(verified)).toBe(true);
    expect(placeIssue(suggested)).toBe("unverified");
    expect(canPlace(suggested)).toBe(false);
  });

  test("retired or missing cards are retired", () => {
    expect(placeIssue({ status: "retired" })).toBe("retired");
    expect(placeIssue(undefined)).toBe("retired");
    expect(placeIssue(null)).toBe("retired");
  });

  test("a sensitive card needs its decision even when verified", () => {
    expect(placeIssue({ status: "verified", sensitive: true, sensitiveCleared: null })).toBe("sensitive");
    expect(placeIssue({ status: "verified", sensitive: true, sensitiveCleared: "consent" })).toBeNull();
    expect(placeIssue({ status: "suggested", sensitive: true, sensitiveCleared: null })).toBe("sensitive");
  });
});

describe("finishBlockers", () => {
  const sections = [{ id: "s1", prompt: "Need" }, { id: "s2", prompt: "Program" }];
  const cards: Record<string, GateCard> = { a: verified, b: suggested, c: { status: "verified", sensitive: true } };

  test("lists every card that stops the answers leaving, in question order", () => {
    const list = finishBlockers(sections, [
      { sectionId: "s2", kind: "card", cardId: "b", text: "B" },
      { sectionId: "s1", kind: "card", cardId: "a", text: "A" },
      { sectionId: "s1", kind: "human", cardId: null, text: "my words" },
      { sectionId: "s1", kind: "card", cardId: "gone", text: "G" },
      { sectionId: "s1", kind: "card", cardId: "c", text: "C" },
    ], id => cards[id]);
    expect(list.map(b => [b.question, b.cardId, b.issue])).toEqual([
      [1, "gone", "retired"], [1, "c", "sensitive"], [2, "b", "unverified"],
    ]);
  });

  test("blocks from other drafts are ignored, and clean answers pass", () => {
    expect(finishBlockers(sections, [{ sectionId: "elsewhere", kind: "card", cardId: "b", text: "" }], id => cards[id])).toEqual([]);
    expect(finishBlockers(sections, [{ sectionId: "s1", kind: "card", cardId: "a", text: "" }], id => cards[id])).toEqual([]);
  });

  test("the refusal says how many, of what, and where", () => {
    const list = finishBlockers(sections, [
      { sectionId: "s1", kind: "card", cardId: "b", text: "" },
      { sectionId: "s2", kind: "card", cardId: "b2", text: "" },
    ], id => (id === "b" ? suggested : undefined));
    expect(describeBlockers(list)).toBe("2 cards in this application need attention first (1 not yet verified, 1 retired from the library), in questions 1, 2.");
    expect(describeBlockers([])).toBe("");
  });
});
