import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decode360Received, threeSixtyFunders, threeSixtyFunderRows, rangeText } from "@/lib/open-data";

const fixture = JSON.parse(readFileSync("tests/fixtures/open-data/360giving-received.json", "utf8"));

describe("360Giving grants_received decoder", () => {
  it("reads funder, recipient, amount, currency and year from the real response", () => {
    const g = decode360Received(fixture);
    expect(g.length).toBeGreaterThan(0);
    for (const x of g) {
      expect(x.funderId).toBeTruthy();
      expect(x.funderName).toBeTruthy();
      // The same charity is filed under its charity and its company number.
      expect(x.recipientName.toLowerCase()).toBe("christian aid");
    }
    expect(g.some(x => x.currency === "GBP" && (x.amount ?? 0) > 0)).toBe(true);
    expect(g.every(x => x.year === null || /^\d{4}$/.test(x.year))).toBe(true);
  });

  it("returns nothing for junk, never throws", () => {
    expect(decode360Received(null)).toEqual([]);
    expect(decode360Received({ results: "x" })).toEqual([]);
    expect(decode360Received({ results: [{}, { data: { fundingOrganization: [{}] } }] })).toEqual([]);
  });
});

describe("funders of the peers", () => {
  const g = (funderId: string, recipientId: string, year: string, amount = 10000) => ({
    funderId, funderName: funderId.toUpperCase(), recipientId, recipientName: recipientId, amount, currency: "GBP", year, title: null,
  });

  it("ranks funders of more peers first, drops old grants and peers funding peers", () => {
    const out = threeSixtyFunders([
      g("f-a", "GB-CHC-1", "2024"), g("f-a", "GB-CHC-2", "2023"),
      g("f-b", "GB-CHC-1", "2025"),
      g("f-old", "GB-CHC-1", "2009"),
      g("GB-CHC-2", "GB-CHC-1", "2024"),
    ], ["GB-CHC-1", "GB-CHC-2"]);
    expect(out.map(f => f.funder_id)).toEqual(["360g:f-a", "360g:f-b"]);
    expect(out[0].peerCount).toBe(2);
    expect(out[0].grants[0].year).toBe("2024");
  });

  it("builds funder rows from the graph, labelled with their source", () => {
    const funders = threeSixtyFunders(decode360Received(fixture), ["GB-CHC-1105851"]);
    const rows = threeSixtyFunderRows(funders, "Kenya");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.funder_id.startsWith("360g:")).toBe(true);
      expect(r.source).toBe("threesixty");
      expect(r.from_graph).toBe(true);
      expect(r.match_reason).toContain("Kenya");
      expect(r.match_reason).not.toMatch(/—/);
    }
  });

  it("counts one charity filed under two ids as one peer, named once", () => {
    const funders = threeSixtyFunders(decode360Received(fixture), ["GB-CHC-1105851", "GB-COH-05171525"]);
    const fcdo = funders.find(f => /Foreign/.test(f.name));
    expect(fcdo?.peerCount).toBe(1);
    const row = threeSixtyFunderRows(fcdo ? [fcdo] : [], "")[0];
    expect(row.match_reason.match(/christian aid/gi)?.length).toBe(1);
  });

  it("states ranges in the grant currency", () => {
    expect(rangeText([{ amount: 16000, currency: "GBP" }, { amount: 150000, currency: "GBP" }])).toBe("£16K to £150K");
    expect(rangeText([{ amount: 2_500_000, currency: "GBP" }])).toBe("£2.5M");
    expect(rangeText([{ amount: null, currency: null }])).toBeNull();
  });
});
