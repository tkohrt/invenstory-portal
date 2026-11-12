import { describe, expect, test } from "vitest";
import { cleanSearchQuery, escapeLike } from "@/lib/search-clean";

// The dash bug (patch 31): websearch_to_tsquery reads "- word" as NOT word,
// and the house title convention uses spaced dashes everywhere. The cleaner
// must make a title searchable as itself.
describe("cleanSearchQuery", () => {
  test("spaced dashes become spaces (the title convention)", () => {
    expect(cleanSearchQuery("Layer II - N4HC Quarterly Update")).toBe("Layer II N4HC Quarterly Update");
  });
  test("hyphenated words lose the hyphen but keep both parts", () => {
    expect(cleanSearchQuery("non-profit budget")).toBe("non profit budget");
  });
  test("quoted phrases survive", () => {
    expect(cleanSearchQuery('"founding story" dispatch')).toBe('"founding story" dispatch');
  });
  test("whitespace collapses and trims", () => {
    expect(cleanSearchQuery("  a   -  b  ")).toBe("a b");
  });
});

describe("escapeLike", () => {
  test("escapes percent, underscore and backslash", () => {
    expect(escapeLike("50%_done\\now")).toBe("50\\%\\_done\\\\now");
  });
  test("leaves ordinary text alone", () => {
    expect(escapeLike("Annual Report 2026")).toBe("Annual Report 2026");
  });
});
