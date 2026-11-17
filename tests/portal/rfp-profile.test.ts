// A client's RFP profile (patch 58).
import { describe, it, expect } from "vitest";
import { parseNaics, parseKeywords, cleanRfpProfile, profileProblem, CAPABILITIES_MAX } from "@/lib/rfp-profile";

describe("parseNaics", () => {
  it("pulls 2- to 6-digit codes out of any separator, once each", () => {
    expect(parseNaics("541511, 541512;541511\n54 and 5415")).toEqual(["541511", "541512", "54", "5415"]);
    expect(parseNaics(["541519", "x"])).toEqual(["541519"]);
    expect(parseNaics("1234567 or 9")).toEqual([]);
    expect(parseNaics(null)).toEqual([]);
  });
  it("keeps at most 20", () => {
    expect(parseNaics(Array.from({ length: 30 }, (_, i) => String(541500 + i)).join(" "))).toHaveLength(20);
  });
});

describe("parseKeywords", () => {
  it("splits on lines, commas and semicolons, drops short ones and repeats, keeps case", () => {
    expect(parseKeywords("artificial intelligence\nAI, Machine Learning; machine learning\n  software   development ")).toEqual(
      ["artificial intelligence", "Machine Learning", "software development"]);
  });
  it("caps length and count", () => {
    expect(parseKeywords("x".repeat(100))[0]).toHaveLength(60);
    expect(parseKeywords(Array.from({ length: 40 }, (_, i) => `keyword ${i}`))).toHaveLength(30);
  });
});

describe("cleanRfpProfile and profileProblem", () => {
  it("cleans every field and survives junk", () => {
    expect(cleanRfpProfile({ capabilities: 7, naics: { a: 1 }, keywords: null })).toEqual({ capabilities: "", naics: [], keywords: [] });
    expect(cleanRfpProfile({ capabilities: "y".repeat(CAPABILITIES_MAX + 50) }).capabilities).toHaveLength(CAPABILITIES_MAX);
  });
  it("needs real capabilities and something to search on", () => {
    expect(profileProblem(cleanRfpProfile({ capabilities: "short", naics: "541511" }))).toMatch(/sentences/);
    const cap = "Custom software development; mobile and web applications; AI readiness assessments and proofs of concept.";
    expect(profileProblem(cleanRfpProfile({ capabilities: cap }))).toMatch(/NAICS code or keyword/);
    expect(profileProblem(cleanRfpProfile({ capabilities: cap, keywords: "artificial intelligence" }))).toBeNull();
  });
});
