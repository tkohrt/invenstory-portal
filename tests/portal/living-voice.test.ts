/**
 * The Living Voice questions and Getting started (patch 3 of the 1 Nov 2026 build).
 */
import { describe, expect, test } from "vitest";
import {
  voiceSections, allPrompts, promptsAsText, answersToText, answeredCount, startSteps, showStart,
} from "@/lib/living-voice";

describe("the questions", () => {
  test("cover why they started, what drives them, who they work with and where", () => {
    const titles = voiceSections("nonprofit").map(s => s.title);
    expect(titles).toEqual(["Where it started", "What drives you", "Who you work with", "Where you work, and why there", "What comes next", "In your own words"]);
  });
  test("a company is also asked why it is a company", () => {
    const keys = allPrompts("startup").map(p => p.key);
    expect(keys).toContain("why_company");
    expect(allPrompts("nonprofit").map(p => p.key)).not.toContain("why_company");
  });
  test("every key is unique, so answers cannot collide", () => {
    const keys = allPrompts("startup").map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  test("copy text holds every question and no em dash", () => {
    const t = promptsAsText("startup");
    for (const p of allPrompts("startup")) expect(t).toContain(p.question);
    expect(t).not.toContain("—");
  });
});

describe("written answers", () => {
  test("become Q and A text in question order, unanswered left out", () => {
    const t = answersToText("nonprofit", { funding: "Open two more sites.", why_start: "  Our town had no clinic. " });
    expect(t.indexOf("Our town had no clinic.")).toBeLessThan(t.indexOf("Open two more sites."));
    expect(t.startsWith("Q: Why did you start this work?")).toBe(true);
    expect(t).not.toContain("Q: Was there a moment");
    expect(answeredCount("nonprofit", { funding: "x", why_start: " " })).toBe(1);
  });
  test("nothing answered is nothing to file", () => {
    expect(answersToText("nonprofit", {})).toBe("");
  });
});

describe("Getting started", () => {
  const fresh = { criticalGaps: 2, layerCounts: { I: 0, II: 0, III: 0 }, readinessRun: false };
  test("a new client has five steps to do", () => {
    const s = startSteps(fresh);
    expect(s).toHaveLength(5);
    expect(s.every(x => !x.done)).toBe(true);
    expect(showStart(s, false)).toBe(true);
  });
  test("each step is done by the fact it names", () => {
    const s = startSteps({ criticalGaps: 0, layerCounts: { I: 1, II: 0, III: 2 }, readinessRun: true });
    expect(Object.fromEntries(s.map(x => [x.key, x.done]))).toEqual({ eligibility: true, layer1: true, layer2: false, layer3: true, readiness: true });
  });
  test("goes away when everything is done, or when hidden", () => {
    const all = startSteps({ criticalGaps: 0, layerCounts: { I: 1, II: 1, III: 1 }, readinessRun: true });
    expect(showStart(all, false)).toBe(false);
    expect(showStart(startSteps(fresh), true)).toBe(false);
  });
});
