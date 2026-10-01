import { describe, expect, test } from "vitest";
import { assembleAnswer, countFor, limitState, moveItem, parseTidy, sameOrder, shortFrom } from "@/lib/section-answer";

describe("assembleAnswer", () => {
  test("joins blocks with a space, and a blank line where a block starts a paragraph", () => {
    const text = assembleAnswer([
      { kind: "card", text: "First claim.", breakBefore: false },
      { kind: "card", text: "Second  claim,\nwrapped.", breakBefore: false },
      { kind: "human", text: "A new\nparagraph.", breakBefore: true },
    ]);
    expect(text).toBe("First claim. Second claim, wrapped.\n\nA new\nparagraph.");
  });
  test("a break on the first block does not open with a blank line; empty blocks vanish", () => {
    expect(assembleAnswer([
      { kind: "human", text: "  ", breakBefore: false },
      { kind: "card", text: "Only.", breakBefore: true },
    ])).toBe("Only.");
  });
});

describe("countFor and limitState", () => {
  test("counts words as runs of non-space and characters including spaces", () => {
    expect(countFor("One two\n\nthree.", "words")).toBe(3);
    expect(countFor("", "words")).toBe(0);
    expect(countFor("ab c", "characters")).toBe(4);
  });
  test("near is the last tenth; over is past the limit; no limit is none", () => {
    expect(limitState(80, 100)).toBe("under");
    expect(limitState(90, 100)).toBe("near");
    expect(limitState(100, 100)).toBe("near");
    expect(limitState(101, 100)).toBe("over");
    expect(limitState(500, null)).toBe("none");
  });
});

describe("moveItem", () => {
  test("moves, and ignores out-of-range moves", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    const same = ["a"];
    expect(moveItem(same, 0, 3)).toBe(same);
  });
});

describe("parseTidy accepts only a reordering", () => {
  const ids = ["x", "y", "z"];
  test("a valid permutation, with prose around the JSON", () => {
    const p = parseTidy('Here you go: {"order":[2,3,1],"rationale":"Lead with the need, then the model."} done', ids);
    expect(p).toEqual({ order: ["y", "z", "x"], rationale: "Lead with the need, then the model." });
  });
  test("refuses a dropped block, a duplicate, an out-of-range number or no rationale", () => {
    expect(parseTidy('{"order":[1,2],"rationale":"r"}', ids)).toBeNull();
    expect(parseTidy('{"order":[1,1,2],"rationale":"r"}', ids)).toBeNull();
    expect(parseTidy('{"order":[1,2,4],"rationale":"r"}', ids)).toBeNull();
    expect(parseTidy('{"order":[1,2,3]}', ids)).toBeNull();
    expect(parseTidy("no json", ids)).toBeNull();
  });
  test("sameOrder", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
  });
});

describe("shortFrom", () => {
  test("keeps whole sentences from the first paragraph within the word budget", () => {
    expect(shortFrom("One two three. Four five six. Seven.\n\nLater.", 6)).toBe("One two three. Four five six.");
    expect(shortFrom("A very long first sentence here.", 2)).toBe("A very long first sentence here.");
  });
});
