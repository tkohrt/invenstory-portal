// Cutting the text into the reader's pieces.
import { describe, expect, test } from "vitest";
import { segment, step } from "@/lib/reader-segments";

const join = (segs: { start: number; end: number }[]) => segs.map(s => `${s.start}-${s.end}`).join(",");

describe("segment", () => {
  test("no highlights: one piece per page, each page start marked", () => {
    const segs = segment(30, [{ page: 1, start: 0, end: 10 }, { page: 2, start: 12, end: 30 }], [], []);
    expect(join(segs)).toBe("0-12,12-30");
    expect(segs.map(s => s.pageStart)).toEqual([1, 2]);
  });

  test("overlapping cards are cut where either starts or ends, and each piece knows its cards", () => {
    const segs = segment(20, [], [{ cardId: "a", start: 2, end: 10 }, { cardId: "b", start: 6, end: 14 }], []);
    expect(join(segs)).toBe("0-2,2-6,6-10,10-14,14-20");
    expect(segs.map(s => s.cards)).toEqual([[], ["a"], ["a", "b"], ["b"], []]);
  });

  test("the same card twice (a quote in pieces) and a search match across a card's edge", () => {
    const segs = segment(20, [], [{ cardId: "a", start: 0, end: 4 }, { cardId: "a", start: 8, end: 12 }], [{ start: 3, end: 9 }]);
    expect(join(segs)).toBe("0-3,3-4,4-8,8-9,9-12,12-20");
    expect(segs.map(s => s.match)).toEqual([-1, 0, 0, 0, -1, -1]);
    expect(segs.map(s => s.cards.join(""))).toEqual(["a", "a", "", "a", "a", ""]);
  });

  test("the pieces cover the text exactly, with nothing lost or doubled", () => {
    const segs = segment(50, [{ page: 1, start: 0, end: 20 }, { page: 2, start: 22, end: 50 }],
      [{ cardId: "x", start: 15, end: 30 }, { cardId: "y", start: -5, end: 3 }, { cardId: "z", start: 40, end: 99 }], [{ start: 25, end: 26 }]);
    expect(segs[0].start).toBe(0);
    expect(segs[segs.length - 1].end).toBe(50);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end);
  });

  test("empty and inverted ranges are ignored", () => {
    expect(join(segment(10, [], [{ cardId: "a", start: 5, end: 5 }, { cardId: "b", start: 8, end: 2 }], []))).toBe("0-10");
    expect(segment(0, [], [], [])).toEqual([]);
  });
});

test("step wraps both ways and starts from either end", () => {
  expect(step(-1, 5, 1)).toBe(0);
  expect(step(-1, 5, -1)).toBe(4);
  expect(step(4, 5, 1)).toBe(0);
  expect(step(0, 5, -1)).toBe(4);
  expect(step(2, 0, 1)).toBe(-1);
});
