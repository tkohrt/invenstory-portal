import { describe, expect, it } from "vitest";
import { asksOutcomeAtUpload, isWinning, OUTCOMES, outcomeChangeRefusal, parseOutcome } from "@/lib/doc-outcome";

describe("document outcomes (Auto-Draft patch 2)", () => {
  it("knows the four outcomes the database allows, in order", () => {
    expect(OUTCOMES.map(o => o.key)).toEqual(["won", "not_funded", "pending", "unknown"]);
  });

  it("reads untrusted input, treating anything unrecognised as none", () => {
    expect(parseOutcome("won")).toBe("won");
    expect(parseOutcome("not_funded")).toBe("not_funded");
    expect(parseOutcome("Won")).toBeNull();
    expect(parseOutcome("winning")).toBeNull();
    expect(parseOutcome("")).toBeNull();
    expect(parseOutcome(null)).toBeNull();
    expect(parseOutcome(3)).toBeNull();
    expect(parseOutcome("toString")).toBeNull();
  });

  it("calls a document a winning grant only when its outcome is Won", () => {
    expect(isWinning({ outcome: "won" })).toBe(true);
    for (const o of ["not_funded", "pending", "unknown", null, undefined]) expect(isWinning({ outcome: o })).toBe(false);
    expect(isWinning({})).toBe(false);
  });

  it("asks for an outcome at upload only for a past grant application", () => {
    expect(asksOutcomeAtUpload("past_application")).toBe(true);
    expect(asksOutcomeAtUpload("budget")).toBe(false);
    expect(asksOutcomeAtUpload("")).toBe(false);
    expect(asksOutcomeAtUpload(null)).toBe(false);
  });

  describe("who may change an outcome", () => {
    it("lets For Granted change any outcome", () => {
      expect(outcomeChangeRefusal({ role: "admin", userId: "a1", setBy: "a2", setByRole: "admin" })).toBeNull();
      expect(outcomeChangeRefusal({ role: "admin", userId: "a1", setBy: "c1", setByRole: "client" })).toBeNull();
    });
    it("lets a client set an unset outcome, or change one they or a colleague set", () => {
      expect(outcomeChangeRefusal({ role: "client", userId: "c1", setBy: null, setByRole: null })).toBeNull();
      expect(outcomeChangeRefusal({ role: "client", userId: "c1", setBy: "c1", setByRole: "client" })).toBeNull();
      expect(outcomeChangeRefusal({ role: "client", userId: "c1", setBy: "c2", setByRole: "client" })).toBeNull();
    });
    it("stops a client overwriting For Granted's outcome", () => {
      expect(outcomeChangeRefusal({ role: "client", userId: "c1", setBy: "a1", setByRole: "admin" }))
        .toMatch(/For Granted set this document's outcome/);
    });
  });
});
