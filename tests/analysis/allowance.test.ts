// The monthly AI allowance (decisions 24, 30 and 32): a soft line with a hard ceiling.
import { describe, expect, test } from "vitest";
import {
  ALLOWANCE, MICROS_PER_CENT, IN_FLIGHT_MARGIN, lineMicros, ceilingMicros, shareUsed, levelOf, decideAllowance,
  centsFromDollars, usdFromCents, NOTE_OVER, MESSAGE_CEILING, NOTE_CEILING_BUILD,
} from "@/lib/allowance";

const dollars = (d: number) => Math.round(d * 100 * MICROS_PER_CENT);
const state = (spentDollars: number, monthlyCents: number = ALLOWANCE.defaultCents, extraCents = 0, ceilingCents: number | null = null) =>
  ({ spentMicros: dollars(spentDollars), monthlyCents, extraCents, ceilingCents });
const chat = { kind: "interactive" as const };
const build = { kind: "build" as const };

describe("the line and the ceiling", () => {
  test("the default is $20, with a hard ceiling at twice that", () => {
    expect(ALLOWANCE.defaultCents).toBe(2000);
    expect(lineMicros(state(0))).toBe(dollars(20));
    expect(ceilingMicros(state(0))).toBe(dollars(40));
  });

  test("extra granted raises the line and the ceiling by the same amount", () => {
    expect(lineMicros(state(0, 2000, 1000))).toBe(dollars(30));
    expect(ceilingMicros(state(0, 2000, 1000))).toBe(dollars(50));
  });

  test("For Granted's own ceiling replaces twice the allowance, and is never below the line", () => {
    expect(ceilingMicros(state(0, 2000, 0, 2500))).toBe(dollars(25));
    expect(ceilingMicros(state(0, 2000, 0, 1000))).toBe(dollars(20));
  });

  test("levels", () => {
    expect(levelOf(state(10))).toBe("fine");
    expect(levelOf(state(16))).toBe("near");
    expect(levelOf(state(20))).toBe("over");
    expect(levelOf(state(39.99))).toBe("over");
    expect(levelOf(state(40))).toBe("ceiling");
  });
});

describe("decideAllowance", () => {
  test("admins are never limited, however much has been spent", () => {
    expect(decideAllowance("admin", state(5000), chat)).toEqual({ ok: true, unlimited: true });
  });

  test("under 80% there is nothing to say", () => {
    expect(decideAllowance("client", state(15.99), chat)).toEqual({ ok: true, level: "fine", warning: null });
  });

  test("from 80% the client gets a heads-up, as a share and never in dollars", () => {
    const d = decideAllowance("client", state(16.9), chat);
    expect(d).toEqual({ ok: true, level: "near", warning: "Your organization has used 84% of this month's AI allowance." });
  });

  test("past the allowance nothing stops: the client is told For Granted knows", () => {
    const d = decideAllowance("client", state(25), chat);
    expect(d).toEqual({ ok: true, level: "over", warning: NOTE_OVER });
    expect(NOTE_OVER).not.toContain("$");
  });

  test("at the ceiling a new interactive step stops, with Request more", () => {
    const d = decideAllowance("client", state(40), chat);
    expect(d).toEqual({ ok: false, level: "ceiling", message: MESSAGE_CEILING, canRequest: true });
    expect(MESSAGE_CEILING).not.toContain("$");
  });

  test("a conversation under way carries on past the ceiling, to a margin", () => {
    expect(decideAllowance("client", state(41), { kind: "interactive", inFlight: true }).ok).toBe(true);
    expect(decideAllowance("client", state(40 * (1 + IN_FLIGHT_MARGIN)), { kind: "interactive", inFlight: true }).ok).toBe(false);
  });

  test("building the Inven(s)tory is never stopped, even far past the ceiling", () => {
    expect(decideAllowance("client", state(500), build)).toEqual({ ok: true, level: "ceiling", warning: NOTE_CEILING_BUILD });
  });

  test("a grant lifts a client off the ceiling", () => {
    expect(decideAllowance("client", state(45), chat).ok).toBe(false);
    expect(decideAllowance("client", state(45, 2000, 1000), chat).ok).toBe(true);
  });

  test("a $0 allowance and limit: every interactive step needs a grant, building still works", () => {
    expect(decideAllowance("client", state(0, 0, 0, 0), chat).ok).toBe(false);
    expect(decideAllowance("client", state(0, 0, 0, 0), build).ok).toBe(true);
    expect(shareUsed(state(0, 0))).toBe(0);
  });
});

describe("amounts For Granted types", () => {
  test("dollars become cents", () => {
    expect(centsFromDollars("20")).toBe(2000);
    expect(centsFromDollars("$12.50")).toBe(1250);
    expect(centsFromDollars("1,000")).toBe(100000);
    expect(centsFromDollars(7.5)).toBe(750);
  });
  test("nonsense, negatives and too much are refused; zero only where allowed", () => {
    expect(centsFromDollars("twenty")).toBeNull();
    expect(centsFromDollars("-5")).toBeNull();
    expect(centsFromDollars("10001")).toBeNull();
    expect(centsFromDollars("0")).toBeNull();
    expect(centsFromDollars("0", { allowZero: true })).toBe(0);
  });
  test("cents show as dollars", () => {
    expect(usdFromCents(2000)).toBe("$20.00");
    expect(usdFromCents(1250)).toBe("$12.50");
  });
});
