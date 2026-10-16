// Form Items, step 1: sort, don't skip.
//
// The reader now returns every item on a funder's form, labelled written, fact
// or confirmation. These tests hold the code to the rule that matters: every
// item the reader proposes ends up in exactly one list, in form order, and an
// answer saved before kinds existed still reads as it did.
import { describe, it, expect } from "vitest";
import {
  readKind, readAnswerType, readOptions, answerTypeFor, reconciliationLine, MAX_OPTIONS,
} from "@/lib/form-items";
import { mergeWindows, parseWindowAnswer, type WindowAnswer } from "@/lib/application-parse";

const FORM = `Community Grant: Application Questions

1. Organization website

2. Year the organization was established

3. Organization's mission: Describe the organization's mission and charitable activities. (1,200 characters)

4. Project theme: Which theme will this project most closely address? (Education, Sustainability, Economic Vitality)

5. Reach: How many people will this project benefit in its first year?

6. Project description: Tell us about your project, including the project goals and activities. (2,000 characters)

7. Does your organization intend to use the requested funds to make cash grants to other organizations?

8. I certify that I have reviewed and agree to the Terms and Conditions.`;

const item = (prompt: string, extra: Record<string, unknown> = {}) =>
  ({ prompt, guidance: null, criteria: null, limit_value: null, limit_unit: null, ...extra });

describe("reading the reader's labels", () => {
  it("reads kinds leniently, and anything unknown or missing as written", () => {
    expect(readKind("fact")).toBe("fact");
    expect(readKind("Form field")).toBe("fact");
    expect(readKind("checkbox")).toBe("confirmation");
    expect(readKind("Certification")).toBe("confirmation");
    expect(readKind("written")).toBe("written");
    expect(readKind("narrative")).toBe("written");
    expect(readKind(undefined)).toBe("written");
    expect(readKind("something else")).toBe("written");
  });

  it("reads answer types, and anything unknown as a short answer", () => {
    expect(readAnswerType("yes/no")).toBe("yes_no");
    expect(readAnswerType("Yes_No")).toBe("yes_no");
    expect(readAnswerType("number")).toBe("number");
    expect(readAnswerType("select one")).toBe("choice");
    expect(readAnswerType("dropdown")).toBe("choice");
    expect(readAnswerType("date")).toBe("date");
    expect(readAnswerType("url")).toBe("short_text");
  });

  it("keeps a choice's options tidy: trimmed, no blanks, no repeats, capped", () => {
    expect(readOptions([" Education ", "", "education", "Sustainability", 4, null])).toEqual(["Education", "Sustainability"]);
    expect(readOptions("Education, Sustainability")).toEqual([]);
    expect(readOptions(Array.from({ length: 50 }, (_, i) => `Option ${i}`))).toHaveLength(MAX_OPTIONS);
  });

  it("gives a fact an answer type and a confirmation none", () => {
    expect(answerTypeFor("fact", null)).toBe("short_text");
    expect(answerTypeFor("fact", "number")).toBe("number");
    expect(answerTypeFor("confirmation", "yes_no")).toBeNull();
  });
});

describe("the sentence that accounts for every item", () => {
  it("adds up to what a person counts on the form", () => {
    expect(reconciliationLine({ written: 13, facts: 15, confirmations: 3, attachments: 0 }))
      .toBe("31 items found in the application: 13 to write, 15 form facts and 3 confirmations.");
  });
  it("leaves out empty kinds and counts attachments apart", () => {
    expect(reconciliationLine({ written: 5, facts: 0, confirmations: 1, attachments: 2 }))
      .toBe("6 items found in the application: 5 to write and 1 confirmation. Plus 2 attachments to upload.");
    expect(reconciliationLine({ written: 1, facts: 0, confirmations: 0, attachments: 0 }))
      .toBe("1 item found in the application: 1 to write.");
    expect(reconciliationLine({ written: 0, facts: 0, confirmations: 0, attachments: 0 })).toBe("No items found in the application.");
  });
});

describe("sorting the form's items", () => {
  it("puts every item in exactly one list, in form order, with its place on the form", () => {
    const raw = JSON.stringify({ title: "Community Grant", items: [
      item("Organization website", { kind: "fact", answer_type: "short_text" }),
      item("Year the organization was established", { kind: "fact", answer_type: "number" }),
      item("Organization's mission: Describe the organization's mission and charitable activities.", { kind: "written", limit_value: 1200, limit_unit: "characters" }),
      item("Project theme: Which theme will this project most closely address?", { kind: "fact", answer_type: "choice", options: ["Education", "Sustainability", "Economic Vitality"] }),
      item("Reach: How many people will this project benefit in its first year?", { kind: "fact", answer_type: "number" }),
      item("Project description: Tell us about your project, including the project goals and activities.", { kind: "written", limit_value: 2000, limit_unit: "characters" }),
      item("Does your organization intend to use the requested funds to make cash grants to other organizations?", { kind: "fact", answer_type: "yes/no" }),
      item("I certify that I have reviewed and agree to the Terms and Conditions.", { kind: "confirmation" }),
    ] });
    const r = mergeWindows([parseWindowAnswer(raw)], FORM);

    expect(r.sections.map(s => s.form_position)).toEqual([3, 6]);
    expect(r.sections.map(s => s.limit_value)).toEqual([1200, 2000]);
    expect(r.formItems.map(f => f.form_position)).toEqual([1, 2, 4, 5, 7, 8]);
    expect(r.formItems.map(f => f.kind)).toEqual(["fact", "fact", "fact", "fact", "fact", "confirmation"]);
    expect(r.formItems.map(f => f.answer_type)).toEqual(["short_text", "number", "choice", "number", "yes_no", null]);
    expect(r.formItems[2].options).toEqual(["Education", "Sustainability", "Economic Vitality"]);
    expect(r.formItems.every(f => f.in_source)).toBe(true);
    expect(r.stats).toMatchObject({ proposed: 8, written: 2, facts: 5, confirmations: 1 });
    expect(r.sections.length + r.formItems.length).toBe(r.stats.proposed - r.stats.duplicates);
  });

  it("keeps options only on a choice", () => {
    const raw = JSON.stringify({ items: [item("Organization website", { kind: "fact", answer_type: "short_text", options: ["stray"] })] });
    expect(mergeWindows([parseWindowAnswer(raw)], FORM).formItems[0].options).toEqual([]);
  });

  it("reads a window answer saved mid-read before kinds existed as all written, as it was", () => {
    const old: WindowAnswer = {
      title: null, funder: null, deadline: null, attachments: [], invalid: 0,
      questions: [item("Organization's mission: Describe the organization's mission and charitable activities.")] as unknown as WindowAnswer["questions"],
    };
    const r = mergeWindows([old], FORM);
    expect(r.sections).toHaveLength(1);
    expect(r.formItems).toHaveLength(0);
    expect(r.stats.written).toBe(1);
  });

  it("still reads the reader's old reply shape, `questions` with no kinds", () => {
    const a = parseWindowAnswer(JSON.stringify({ questions: [item("Organization website")] }));
    expect(a?.questions[0].kind).toBe("written");
  });

  it("merges an item seen in two overlapping windows once, keeping the first reading's kind", () => {
    const w1 = parseWindowAnswer(JSON.stringify({ items: [item("Reach: How many people will this project benefit in its first year?", { kind: "fact", answer_type: "number" })] }));
    const w2 = parseWindowAnswer(JSON.stringify({ items: [item("Reach: How many people will this project benefit in its first year?", { kind: "written" })] }));
    const r = mergeWindows([w1, w2], FORM);
    expect(r.formItems).toHaveLength(1);
    expect(r.sections).toHaveLength(0);
    expect(r.stats.duplicates).toBe(1);
  });

  it("keeps a label the form repeats under different headings: two contacts each have an Email and a Phone", () => {
    const form = "Primary contact\nEmail\nPhone\nSecondary contact\nEmail\nPhone";
    const raw = JSON.stringify({ items: ["Primary contact", "Email", "Phone", "Secondary contact", "Email", "Phone"]
      .map(p => item(p, { kind: "fact" })) });
    const r = mergeWindows([parseWindowAnswer(raw)], form);
    expect(r.formItems.map(f => f.prompt)).toEqual(["Primary contact", "Email", "Phone", "Secondary contact", "Email", "Phone"]);
    expect(r.stats.duplicates).toBe(0);
  });

  describe("across overlapping parts of a long form", () => {
    // Two parts (WINDOW_CHARS 16,000, overlap 1,500: part 2 starts at 14,500).
    // "Email" appears once at the very start, and once at 15,000, inside the
    // text both parts contain.
    const pad = (from: number, to: number) => "Background about the program and its history.\n".repeat(Math.ceil((to - from) / 47)).slice(0, to - from);
    const first = "Primary contact\nEmail\n";
    const source = first + pad(first.length, 15_000) + "Secondary contact\nEmail\n" + pad(15_024, 25_000);
    const answersFor = (p1: string[], p2: string[]) => [
      parseWindowAnswer(JSON.stringify({ items: p1.map(p => item(p, { kind: "fact" })) })),
      parseWindowAnswer(JSON.stringify({ items: p2.map(p => item(p, { kind: "fact" })) })),
    ];

    it("the source needs two parts and its second Email sits in their overlap", async () => {
      const { applicationWindows, WINDOW_OVERLAP } = await import("@/lib/application-parse");
      const { windows } = applicationWindows(source);
      expect(windows).toHaveLength(2);
      expect(windows[1].slice(0, WINDOW_OVERLAP)).toContain("Secondary contact\nEmail");
      expect(windows[0].indexOf("Email")).toBeLessThan(100);
    });

    it("merges a short label seen in both parts' shared overlap", () => {
      // Both parts read the secondary contact's Email: once at part 1's end, once at part 2's start.
      const r = mergeWindows(answersFor(["Primary contact", "Email", "Secondary contact", "Email"], ["Secondary contact", "Email"]), source);
      expect(r.formItems.map(f => f.prompt)).toEqual(["Primary contact", "Email", "Secondary contact", "Email"]);
      expect(r.stats.duplicates).toBe(2);
    });

    it("never merges an item with another read in the same part", () => {
      const r = mergeWindows(answersFor(["Email", "Email"], []), source);
      expect(r.formItems).toHaveLength(2);
    });
  });

  it("flags a form field it cannot find word for word, never drops it", () => {
    const raw = JSON.stringify({ items: [item("The applicant's web address", { kind: "fact" })] });
    const r = mergeWindows([parseWindowAnswer(raw)], FORM);
    expect(r.formItems).toHaveLength(1);
    expect(r.formItems[0].in_source).toBe(false);
    expect(r.stats.notInSource).toBe(1);
  });
});
