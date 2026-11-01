/**
 * What kind of money a client is looking for (patch 2 of the 1 Nov 2026 build).
 */
import { describe, expect, test } from "vitest";
import { EMPTY_PROFILE, cleanProfileInput, kindsSought, isFundingKind, FUNDING_KINDS } from "@/lib/eligibility-fields";

describe("kindsSought", () => {
  test("a profile that has not said looks for grants", () => {
    expect(kindsSought({})).toEqual(["grants"]);
    expect(kindsSought({ funding_kinds: [] })).toEqual(["grants"]);
    expect(kindsSought(EMPTY_PROFILE)).toEqual(["grants"]);
  });
  test("keeps known kinds once, in the order given", () => {
    expect(kindsSought({ funding_kinds: ["contracts", "grants", "contracts", "lottery"] })).toEqual(["contracts", "grants"]);
  });
  test("every option is a kind", () => {
    expect(FUNDING_KINDS.every(k => isFundingKind(k.v))).toBe(true);
    expect(isFundingKind("lottery")).toBe(false);
  });
});

describe("saving", () => {
  test("stores what was chosen, and grants when nothing valid was", () => {
    expect(cleanProfileInput({ funding_kinds: ["contracts", "programs"] }).funding_kinds).toEqual(["contracts", "programs"]);
    expect(cleanProfileInput({ funding_kinds: ["nonsense"] }).funding_kinds).toEqual(["grants"]);
    expect(cleanProfileInput({}).funding_kinds).toEqual(["grants"]);
  });
  test("does not count toward completeness", () => {
    const a = cleanProfileInput({ org_type: "for_profit" }).completeness;
    const b = cleanProfileInput({ org_type: "for_profit", funding_kinds: ["contracts"] }).completeness;
    expect(a).toBe(b);
  });
});
