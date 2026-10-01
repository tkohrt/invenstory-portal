import { describe, expect, test } from "vitest";
import { assessSensitivity, personSignal, placeable, protectedTopics } from "@/lib/card-sensitivity";

const base = { kind: "program_model", subject: "organization" as const, quotes: [] as string[], modelFlag: false };

describe("assessSensitivity", () => {
  test("a population statement is not flagged", () => {
    expect(assessSensitivity({ ...base, statement: "Hope Town serves people in recovery across Northeast Ohio." }).sensitive).toBe(false);
    expect(assessSensitivity({ ...base, statement: "The program reaches 300 returning citizens each year." }).sensitive).toBe(false);
  });

  test("an individual tied to recovery is flagged, with the reason", () => {
    const r = assessSensitivity({ ...base, kind: "beneficiary_story",
      statement: "Terry completed the workforce course and has been in recovery for two years." });
    expect(r.sensitive).toBe(true);
    expect(r.reason).toMatch(/substance use or recovery/);
    expect(r.reason).toMatch(/particular person/);
  });

  test("a pronoun in any kind is enough of a person signal", () => {
    expect(assessSensitivity({ ...base, statement: "After leaving prison she found work through the program." }).sensitive).toBe(true);
  });

  test("a first-person quote about a health condition is flagged even when the statement is neutral", () => {
    const r = assessSensitivity({ ...base, kind: "leadership_team",
      statement: "RE-Assist's founder brings personal experience as a patient to the work.",
      quotes: ["I had cancer when I was fifteen, so I know what navigating care feels like."] });
    expect(r.sensitive).toBe(true);
  });

  test("the reader's flag alone is enough", () => {
    const r = assessSensitivity({ ...base, statement: "Mark joined the team in 2024 after the pilot.", modelFlag: true });
    expect(r).toEqual({ sensitive: true, reason: expect.stringMatching(/reader flagged/) });
  });

  test("a person without a protected topic is not flagged", () => {
    expect(assessSensitivity({ ...base, kind: "client_voice", statement: "A parent said the rides made school mornings calm again." }).sensitive).toBe(false);
  });
});

describe("helpers", () => {
  test("protectedTopics lists each topic once", () => {
    expect(protectedTopics("relapse, overdose and probation")).toEqual(["substance use or recovery", "criminal justice involvement"]);
  });
  test("Layer I is not first person", () => {
    expect(personSignal({ ...base, statement: "x", quotes: ["Layer I captures the public story."] })).toBeNull();
  });
  test("placeable", () => {
    expect(placeable({ sensitive: false })).toBe(true);
    expect(placeable({ sensitive: true })).toBe(false);
    expect(placeable({ sensitive: true, sensitiveCleared: "consent" })).toBe(true);
  });
});
