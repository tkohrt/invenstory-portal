/** Company setup on first sign-in: the rules (patch 14, onboarding build, 3 Nov 2026). */
import { describe, expect, test } from "vitest";
import {
  setupGate, resumeAt, stillToDo, stepsSettled, canSettle, goalPath, cleanRole, cleanKnownFunders, cleanDeadlines,
  cleanInvites, cleanWebsite, knownFunderMatch, goalsOn, SETUP_STEPS, type SetupState,
} from "@/lib/setup";

const base = (over: Partial<SetupState> = {}): SetupState => ({
  tenantId: "t", ownerUserId: null, status: "in_progress", steps: {}, answers: {},
  layer3ReadAt: null, legacy: false, completedAt: null, ...over,
});
const client = (id: string) => ({ id, role: "client" as const });

describe("setupGate", () => {
  test("nobody is sent into setup when it cannot be read (0077 not run)", () => {
    expect(setupGate(null, client("u1"))).toEqual({ kind: "none" });
  });
  test("a client from before the build, marked complete, is left alone", () => {
    expect(setupGate(base({ status: "complete", legacy: true }), client("u1"))).toEqual({ kind: "none" });
  });
  test("For Granted and the Brain are never sent in", () => {
    expect(setupGate(base(), { id: "a", role: "admin" })).toEqual({ kind: "none" });
    expect(setupGate(base(), client("u1"), true)).toEqual({ kind: "none" });
  });
  test("the first person, or the one who claimed it, runs it", () => {
    expect(setupGate(base(), client("u1")).kind).toBe("run");
    expect(setupGate(base({ ownerUserId: "u1" }), client("u1")).kind).toBe("run");
  });
  test("a teammate waits and is told how far it got", () => {
    expect(setupGate(base({ ownerUserId: "u1", steps: { you: "done", eligibility: "skipped" } }), client("u2")))
      .toEqual({ kind: "wait", done: 2, total: SETUP_STEPS.length });
  });
});

describe("progress", () => {
  test("resumes at the first step not yet settled", () => {
    expect(resumeAt({ steps: {} })).toBe("you");
    expect(resumeAt({ steps: { you: "done", eligibility: "skipped" } })).toBe("layer1");
    expect(resumeAt({ steps: Object.fromEntries(SETUP_STEPS.map(s => [s.key, "done"])) })).toBe("next");
  });
  test("skipped steps are still to do; done ones are not", () => {
    expect(stillToDo({ steps: { you: "done", layer3: "skipped", team: "skipped" } })).toEqual(["layer3", "team"]);
    expect(stepsSettled({ steps: { you: "done", layer3: "skipped" } })).toBe(2);
  });
  test("Layer III cannot be left until its explanation is read, even to skip", () => {
    expect(canSettle("layer3", "skipped", { layer3ReadAt: null })).toBe(false);
    expect(canSettle("layer3", "skipped", { layer3ReadAt: "2026-11-03T10:00:00Z" })).toBe(true);
    expect(canSettle("layer1", "skipped", { layer3ReadAt: null })).toBe(true);
    expect(canSettle("next", "skipped", { layer3ReadAt: null })).toBe(false);
  });
  test("each goal opens its tool; anything else opens the Inven(s)tory", () => {
    expect(goalPath("funders")).toBe("/funder-matches");
    expect(goalPath("draft")).toBe("/drafts");
    expect(goalPath("nonsense")).toBe("/invenstory");
  });
  test("a goal whose tool is switched off opens the Inven(s)tory, and is not offered", () => {
    expect(goalPath("draft", { drafts: false })).toBe("/invenstory");
    expect(goalsOn({ drafts: false })).toEqual(["funders", "organize"]);
    expect(goalsOn({})).toEqual(["funders", "draft", "organize"]);
  });
});

describe("cleaning what a client sends", () => {
  test("roles come only from the list", () => {
    expect(cleanRole("board")).toBe("board");
    expect(cleanRole("ceo; drop table")).toBeNull();
  });
  test("known funders: named, de-duplicated, relationship from the list", () => {
    expect(cleanKnownFunders([
      { name: "  Ohio Arts Council ", relationship: "funded" },
      { name: "ohio arts council", relationship: "declined" },
      { name: "", relationship: "funded" },
      { name: "Kresge", relationship: "bribed" },
    ])).toEqual([{ name: "Ohio Arts Council", relationship: "funded" }, { name: "Kresge", relationship: "known" }]);
    expect(cleanKnownFunders("x")).toEqual([]);
  });
  test("deadlines keep a real date or none", () => {
    expect(cleanDeadlines([{ what: "NEA", date: "2026-12-01" }, { what: "Joyce", date: "soon" }, { what: "", date: "2026-01-01" }]))
      .toEqual([{ what: "NEA", date: "2026-12-01" }, { what: "Joyce", date: null }]);
  });
  test("invites: valid emails, lower case, once each, at most ten", () => {
    const r = cleanInvites([{ email: "A@Org.org" }, { email: "a@org.org" }, { email: "not-an-email" }, { email: "b@org.org", access: "view" }], "now");
    expect(r).toEqual([{ email: "a@org.org", access: "edit", requested_at: "now" }, { email: "b@org.org", access: "view", requested_at: "now" }]);
    expect(cleanInvites(Array.from({ length: 20 }, (_, i) => ({ email: `p${i}@x.org` }))).length).toBe(10);
  });
  test("a website gets https:// when missing and must look like a domain", () => {
    expect(cleanWebsite("riverbend.org")).toBe("https://riverbend.org/");
    expect(cleanWebsite("http://riverbend.org/about")).toBe("http://riverbend.org/about");
    expect(cleanWebsite("localhost")).toBeNull();
    expect(cleanWebsite("")).toBeNull();
  });
});

describe("knownFunderMatch", () => {
  const known = [{ name: "The Kresge Foundation", relationship: "funded" as const }, { name: "Ohio Arts Council", relationship: "declined" as const }];
  test("matches the same funder written differently", () => {
    expect(knownFunderMatch("Kresge Foundation", known)?.relationship).toBe("funded");
    expect(knownFunderMatch("OHIO ARTS COUNCIL", known)?.relationship).toBe("declined");
  });
  test("does not match an unrelated funder or a short fragment", () => {
    expect(knownFunderMatch("Ford Foundation", known)).toBeNull();
    expect(knownFunderMatch("The Foundation", known)).toBeNull();
  });
});
