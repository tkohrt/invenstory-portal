// Admin, Client activity: months, chat topics and stalled drafts (6 October 2026).
import { describe, expect, test } from "vitest";
import { monthRange, recentMonths, dayKey, isMonthKey, chatTopic, topicCounts, stallState, cleanPath, featureForPath } from "@/lib/activity";

describe("Eastern months", () => {
  test("a month runs from midnight Eastern on the 1st to the next", () => {
    const r = monthRange("2026-10");
    expect(r.start.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(monthRange("2026-12").end.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
  test("recent months, oldest first, across a year", () => {
    expect(recentMonths(3, new Date("2027-01-10T12:00:00Z"))).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
  test("days are Eastern days", () => {
    expect(dayKey(new Date("2026-10-07T02:00:00Z"))).toBe("2026-10-06");
  });
  test("only real month keys are accepted", () => {
    expect(isMonthKey("2026-10")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-10' or 1=1")).toBe(false);
  });
});

describe("chat topics", () => {
  test("questions are sorted into broad topics", () => {
    expect(chatTopic("Which foundations fund care coordination?")).toBe("funders");
    expect(chatTopic("What was our revenue last year?")).toBe("finances");
    expect(chatTopic("Who is on our board?")).toBe("people");
    expect(chatTopic("hello")).toBe("other");
  });
  test("counts carry no text", () => {
    const c = topicCounts(["What is our EIN?", "What is our UEI?", "Tell me our mission"]);
    expect(c).toEqual([
      { key: "eligibility", label: "Eligibility and registration", count: 2 },
      { key: "story", label: "Mission and story", count: 1 },
    ]);
  });
});

describe("stalled drafts", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  test("open, due within 21 days, untouched for 7: stalled", () => {
    const s = stallState({ status: "drafting", deadline: "2026-10-20", lastEdit: "2026-09-28T12:00:00Z" }, now);
    expect(s).toEqual({ stalled: true, daysToDeadline: 15, idleDays: 8, pastDue: false });
  });
  test("recently edited, far off, finished or undated: not stalled", () => {
    expect(stallState({ status: "drafting", deadline: "2026-10-20", lastEdit: "2026-10-03T12:00:00Z" }, now).stalled).toBe(false);
    expect(stallState({ status: "drafting", deadline: "2026-12-20", lastEdit: "2026-08-01T12:00:00Z" }, now).stalled).toBe(false);
    expect(stallState({ status: "submitted", deadline: "2026-10-10", lastEdit: "2026-08-01T12:00:00Z" }, now).stalled).toBe(false);
    expect(stallState({ status: "drafting", deadline: null, lastEdit: "2026-08-01T12:00:00Z" }, now).stalled).toBe(false);
  });
  test("past due and still open is flagged as past due", () => {
    const s = stallState({ status: "client_review", deadline: "2026-10-01", lastEdit: "2026-09-20T12:00:00Z" }, now);
    expect(s.stalled && s.pastDue).toBe(true);
  });
});

describe("visits", () => {
  test("paths are recorded without ids or query strings", () => {
    expect(cleanPath("/drafts/0b7695e3-9340-6eab-f2f1-964410f0f989?q=abc#x")).toBe("/drafts/:id");
    expect(cleanPath("/story-intelligence/themes")).toBe("/story-intelligence/themes");
  });
  test("pages map to parts of the portal; admin and sign-in pages are not recorded", () => {
    expect(featureForPath("/drafts/:id")).toBe("drafts");
    expect(featureForPath("/funding-eligibility")).toBe("eligibility");
    expect(featureForPath("/admin/clients")).toBeNull();
    expect(featureForPath("/")).toBeNull();
    expect(featureForPath("/something-new")).toBe("other");
  });
});
