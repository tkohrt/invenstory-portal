// Locating stored quotes and searches in a document's stored text.
import { describe, expect, test } from "vitest";
import { locateQuote, findAll, prepare, quotePieces, fold } from "@/lib/locate";
import { quoteInText } from "@/lib/story-card";

const TEXT = [
  "Franklinton High School (FHS) is a stand-alone, tuition free public high school.",
  "",
  "The student-run Morning Meeting sets the daily tone, with all students and staff attending.",
  "A June, 2020, report cited a Franklinton life expectancy of approximately 60 years,",
  "compared to 82 years in affluent suburbs just four miles away.",
].join("\n");

const at = (text: string, l: { status: string } & Partial<{ spans: { start: number; end: number }[] }>) =>
  l.status === "found" ? l.spans!.map(s => text.slice(s.start, s.end)) : null;

describe("locating a quote", () => {
  test("an exact quote maps back to the original positions", () => {
    const q = "The student-run Morning Meeting sets the daily tone";
    const l = locateQuote(TEXT, q);
    expect(at(TEXT, l)).toEqual([q]);
    expect(l.status === "found" && l.places).toBe(1);
  });

  test("case, curly quotes, dashes and spacing do not matter", () => {
    const text = "It’s a “stand‑alone”   school —\n  tuition   free.";
    const l = locateQuote(text, `it's a "stand-alone" school - tuition free.`);
    expect(at(text, l)).toEqual(["It’s a “stand‑alone”   school —\n  tuition   free."]);
  });

  test("Markdown emphasis in either the quote or the text is ignored", () => {
    const text = "We served **1,200** students last year in __three__ schools.";
    expect(at(text, locateQuote(text, "We served 1,200 students last year in three schools"))).toEqual([text.slice(0, -1)]);
    expect(locateQuote("We served 1,200 students last year.", "We served **1,200** students last year").status).toBe("found");
  });

  test("a quote joined with an ellipsis is located piece by piece, in order", () => {
    const q = "Franklinton High School (FHS) is a stand-alone … with all students and staff attending";
    const l = locateQuote(TEXT, q);
    expect(at(TEXT, l)).toEqual(["Franklinton High School (FHS) is a stand-alone", "with all students and staff attending"]);
    expect(quotePieces('"one ... two [...] three"')).toEqual(["one", "two", "three"]);
  });

  test("pieces out of order are not a match", () => {
    expect(locateQuote(TEXT, "with all students and staff attending … Franklinton High School (FHS)").status).toBe("missing");
  });

  test("a quote that ran two pages together is found by the spacing-blind pass", () => {
    const text = "the end of page one.\n\nThe start of page two follows.";
    const l = locateQuote(text, "the end of page one.The start of page two");
    expect(l.status === "found" && l.pass).toBe("spacing");
    expect(at(text, l)).toEqual(["the end of page one.\n\nThe start of page two"]);
  });

  test("a trailing full stop the text does not have is tolerated", () => {
    const text = "Approximately 60 years, compared to 82 years in suburbs";
    expect(locateQuote(text, "compared to 82 years in suburbs.").status).toBe("found");
  });

  test("a quote that is not there is missing, never a partial match", () => {
    expect(locateQuote(TEXT, "The Morning Meeting is held weekly in the gym.").status).toBe("missing");
    expect(locateQuote(TEXT, "").status).toBe("missing");
    expect(locateQuote(TEXT, "tone").status).toBe("missing"); // too short to place
  });

  test("a quote in two places reports both, and prefers the one nearest the hint", () => {
    const line = "Our mission is to prepare every student for life after high school.";
    const text = `${line}\n\nOther words here.\n\n${line}`;
    const second = text.lastIndexOf(line);
    const l1 = locateQuote(text, line);
    expect(l1.status === "found" && l1.places).toBe(2);
    expect(l1.status === "found" && l1.spans[0].start).toBe(0);
    const l2 = locateQuote(text, line, second + 3);
    expect(l2.status === "found" && l2.spans[0].start).toBe(second);
  });

  test("ligatures and other compatibility characters map back to the whole raw character", () => {
    const text = "The ofﬁce opened in 2019.";
    const l = locateQuote(text, "The office opened in 2019");
    expect(at(text, l)).toEqual(["The ofﬁce opened in 2019"]);
  });

  test("prepare() gives the same answers as raw text, for reuse across many quotes", () => {
    const p = prepare(TEXT);
    for (const q of ["life expectancy of approximately 60 years", "four miles away", "nowhere in the text at all"]) {
      expect(locateQuote(p, q)).toEqual(locateQuote(TEXT, q));
    }
  });

  test("every quote the quote check accepts, the locator finds", () => {
    const quotes = [
      "the student-run morning meeting sets the daily tone, with all students",
      "FHS) is a stand-alone, tuition free … report cited a Franklinton life expectancy",
      "compared to 82 years in affluent suburbs",
    ];
    for (const q of quotes) {
      expect(quoteInText(q, TEXT)).toBe(true);
      expect(locateQuote(TEXT, q).status).toBe("found");
    }
  });
});

describe("searching", () => {
  test("every match, case-insensitive, with positions in the raw text", () => {
    const m = findAll(TEXT, "life EXPECTANCY");
    expect(m.map(s => TEXT.slice(s.start, s.end))).toEqual(["life expectancy"]);
    expect(findAll(TEXT, "school").length).toBe(2);
  });

  test("match case", () => {
    expect(findAll(TEXT, "Franklinton", { matchCase: true }).length).toBe(2);
    expect(findAll(TEXT, "franklinton", { matchCase: true }).length).toBe(0);
  });

  test("whole word", () => {
    expect(findAll(TEXT, "high", { wholeWord: true }).length).toBe(2); // "High" and "high", both whole words
    expect(findAll("thigh high", "high", { wholeWord: true }).length).toBe(1);
    expect(findAll("thigh high", "high").length).toBe(2);
  });

  test("spacing in the query is loose, and an empty query finds nothing", () => {
    expect(findAll(TEXT, "  daily   tone ").length).toBe(1);
    expect(findAll(TEXT, "   ")).toEqual([]);
  });
});

describe("folding", () => {
  test("matches the quote check's normalisation", () => {
    expect(fold("  It’s  A\n“Test” — ok  ").s).toBe("it's a \"test\" - ok");
    expect(fold("a b\nc", { keepSpace: false }).s).toBe("abc");
  });
});

describe("tightened after review", () => {
  test("each piece of a quote joined with an ellipsis must be long enough to mean something", () => {
    expect(locateQuote("The program served many families in the year.", "program … a … y").status).toBe("missing");
  });
  test("the spacing-blind pass is for long quotes only", () => {
    expect(locateQuote("We inform the board each month.", "we in form the").status).toBe("missing");
  });
  test("a composed and a decomposed accent are the same letter", () => {
    const text = "Our caf\u00e9 programme runs on Saturdays for families.";
    expect(locateQuote(text, "Our cafe\u0301 programme runs on Saturdays").status).toBe("found");
  });
  test("underscores inside a word are kept, as the quote check keeps them", () => {
    const text = "Set the flag snake__case to true before running the import job.";
    expect(locateQuote(text, "flag snake__case to true before running").status).toBe("found");
    expect(fold("snake__case").s).toBe("snake__case");
    expect(fold("__bold__ word").s).toBe("bold word");
  });
  test("whole word treats letters outside the basic plane as letters", () => {
    expect(findAll("\u{1D400}high", "high", { wholeWord: true }).length).toBe(0);
    expect(findAll("x high", "high", { wholeWord: true }).length).toBe(1);
  });
});

