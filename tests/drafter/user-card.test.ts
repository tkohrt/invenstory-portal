import { describe, expect, test } from "vitest";
import { defaultKind, isoDay, longDate, lookAlikes, sourceLine, userCardProblem, writerNote, USER_GENERATED } from "@/lib/user-card";
import { kindsFor, quoteInText } from "@/lib/story-card";

describe("user-generated Story Cards", () => {
  test("the label everywhere", () => { expect(USER_GENERATED).toBe("User-generated"); });

  test("text must be long enough to stand alone, short enough to be one card", () => {
    expect(userCardProblem("Too short here")).toMatch(/at least 5 words/);
    expect(userCardProblem("We have served families in Hamilton County since 2019.")).toBeNull();
    expect(userCardProblem(Array(151).fill("word").join(" "))).toMatch(/under 150/);
  });

  test("the kind defaults to the first kind the question asks for that this organization may have", () => {
    const nonprofit = kindsFor("nonprofit");
    expect(defaultKind(["traction", "program_model"], nonprofit)).toBe("program_model");
    expect(defaultKind([], nonprofit)).toBe(nonprofit[0].key);
  });

  test("the writer is the source, by name, organization and date (Eastern time)", () => {
    const d = new Date("2026-10-08T15:00:00Z");
    expect(longDate(d)).toBe("8 October 2026");
    expect(isoDay(new Date("2026-10-09T02:30:00Z"))).toBe("2026-10-08");
    expect(sourceLine("Shane Winnyk", "For Granted", d)).toBe("Written by Shane Winnyk, For Granted, 8 October 2026");
  });

  test("the Writer's note holds the text verbatim, so the card's quote is in its document", () => {
    const text = "Our nurse navigators call every   patient within 48 hours of discharge.";
    const n = writerNote({ text, kind: "program_model", source: "Written by Shane Winnyk, For Granted, 8 October 2026", saidBy: "Ashley Barrow, CEO", asOf: "2026-10-08" });
    expect(n.title).toBe("Writer's note: Program model");
    expect(n.body).toContain("In the words of: Ashley Barrow, CEO.");
    expect(n.body).toContain("True as of 2026-10-08.");
    expect(quoteInText(n.quote, n.body)).toBe(true);
  });

  test("cards that already say the same thing are offered first; retired ones are not", () => {
    const cards = [
      { id: "a", kind: "program_model", statement: "Nurse navigators call every patient within 48 hours of discharge.", status: "verified" },
      { id: "b", kind: "program_model", statement: "Nurse navigators call every patient within 48 hours of discharge from hospital.", status: "retired" },
      { id: "c", kind: "mission_values", statement: "We believe no one should leave the hospital alone.", status: "verified" },
    ];
    expect(lookAlikes("Our nurse navigators call every patient within 48 hours of discharge.", cards).map(c => c.id)).toEqual(["a"]);
  });
});
