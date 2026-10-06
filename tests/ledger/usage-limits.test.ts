// Client AI limits and the cost meter (6 October 2026).
import { describe, expect, test } from "vitest";
import { decideChat, decideReprocess, uploadReadNow, LIMITS, monthKey, monthStart } from "@/lib/usage-limits";
import { costMicros, rateFor, dollars } from "@/lib/ai-pricing";

const quiet = { minute: 0, day: 0, month: 0 };

describe("chat limits", () => {
  test("admins are never limited, whatever the counts or length", () => {
    expect(decideChat("admin", 100_000, { minute: 99, day: 999, month: 99_999 })).toEqual({ ok: true, unlimited: true });
  });
  test("a long question is refused for a client", () => {
    const d = decideChat("client", LIMITS.chatQuestionChars + 1, quiet);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("too_long");
  });
  test("50 a day per person, 500 a month per client", () => {
    expect(LIMITS.chatPerDayPerPerson).toBe(50);
    expect(LIMITS.chatPerMonthPerClient).toBe(500);
    const day = decideChat("client", 10, { minute: 0, day: 50, month: 60 });
    expect(day.ok === false && day.reason).toBe("day");
    if (!day.ok) expect(day.canRequest).toBe(false);
    const month = decideChat("client", 10, { minute: 0, day: 3, month: 500 });
    expect(month.ok === false && month.reason).toBe("month");
    if (!month.ok) expect(month.canRequest).toBe(true);
  });
  test("a grant from For Granted raises the month's limit", () => {
    expect(decideChat("client", 10, { minute: 0, day: 3, month: 500, monthExtra: 250 }).ok).toBe(true);
  });
  test("the burst guard still holds", () => {
    const d = decideChat("client", 10, { minute: 12, day: 12, month: 12 });
    expect(d.ok === false && d.reason).toBe("minute");
  });
  test("a warning appears near the month's limit, and not before", () => {
    const early = decideChat("client", 10, { minute: 0, day: 1, month: 10 });
    expect(early.ok && !early.unlimited && early.warning).toBeNull();
    const late = decideChat("client", 10, { minute: 0, day: 1, month: 420 });
    expect(late.ok && !late.unlimited && late.warning).toContain("79 questions left for your organization");
  });
});

describe("documents", () => {
  test("process again: 5 a day for a client, unlimited for admins", () => {
    expect(decideReprocess("client", 4).ok).toBe(true);
    expect(decideReprocess("client", 5).ok).toBe(false);
    expect(decideReprocess("admin", 500).ok).toBe(true);
  });
  test("readiness reads of uploads wait past 30 a day; admins never wait", () => {
    expect(uploadReadNow("client", 29)).toBe(true);
    expect(uploadReadNow("client", 30)).toBe(false);
    expect(uploadReadNow("admin", 300)).toBe(true);
  });
  test("months are calendar months in Eastern time, daylight saving included", () => {
    // 1 November 00:30 UTC is still 31 October in New York (EDT, UTC-4).
    expect(monthKey(new Date("2026-11-01T00:30:00Z"))).toBe("2026-10");
    expect(monthKey(new Date("2026-11-01T04:30:00Z"))).toBe("2026-11");
    // October starts at 04:00 UTC (EDT); December at 05:00 UTC (EST).
    expect(monthStart(new Date("2026-10-15T12:00:00Z")).toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(monthStart(new Date("2026-12-15T12:00:00Z")).toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });
});

describe("cost", () => {
  test("Sonnet 4.5 on a US profile carries the 10% regional premium", () => {
    const id = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
    expect(rateFor(id).premium).toBe(true);
    // 1M in + 1M out = $3 + $15, plus 10%.
    expect(dollars(costMicros(id, 1_000_000, 1_000_000))).toBeCloseTo(19.8, 5);
  });
  test("a global profile has no premium; Haiku 4.5 is a third of Sonnet", () => {
    expect(dollars(costMicros("global.anthropic.claude-sonnet-4-5-20250929-v1:0", 1_000_000, 0))).toBeCloseTo(3, 5);
    expect(dollars(costMicros("us.anthropic.claude-haiku-4-5-20251001-v1:0", 1_000_000, 0))).toBeCloseTo(1.1, 5);
  });
  test("an older model on Vertex has no premium; an unknown model is priced as Sonnet", () => {
    expect(rateFor("claude-sonnet-4@20250514").premium).toBe(false);
    expect(dollars(costMicros("something-new", 1_000_000, 0))).toBeCloseTo(3, 5);
  });
  test("a typical chat message costs about a cent", () => {
    const c = dollars(costMicros("us.anthropic.claude-sonnet-4-5-20250929-v1:0", 2300, 240));
    expect(c).toBeGreaterThan(0.01);
    expect(c).toBeLessThan(0.013);
  });
});
