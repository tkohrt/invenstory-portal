/**
 * These fixtures are transcripts, not inventions. Every payload below was
 * captured from the live service. That matters: the bug this file exists to
 * prevent was believing MCP_TOOLS.md instead of the wire, twice.
 */
import { describe, expect, test } from "vitest";
import { unwrapLedgerList, funderProfileFromPayload } from "@/lib/ledger-envelope";

// Verbatim from lookup_funder({ name: "cleveland" }), trimmed to two rows.
const LOOKUP_FUNDER = {
  candidates: [
    { name: "THE CLEVELAND FOUNDATION", ein: "340714588", funder_type: "community_foundation", location: "CLEVELAND, OH", has_grant_history: true },
    { name: "THE CLEVELAND EYE BANK FOUNDATION", ein: "340835578", funder_type: "private_foundation", location: "Cleveland, OH", has_grant_history: true },
  ],
  as_of: "2026-06",
  note: "Ordered: exact name, name-starts-with, whole-word, then fuzzy; within each tier, funders with real grant history first.",
};

// Verbatim from get_funder({ ein: "340714588" }), lists trimmed.
const GET_FUNDER = {
  profile: {
    organization_name: "THE CLEVELAND FOUNDATION",
    ein: "340714588",
    funder_type: "community_foundation",
    mission: "The Cleveland Foundation's core mission is to improve the lives of Clevelanders...",
    org_desc: "501(c)(3) Public Charity",
    ntee_description: "PSB-T31-RG: Public, Societal Benefit - Organizations that make grants for charitable purposes in a specific community or region.",
    city: "CLEVELAND",
    state_code: "OH",
    website: "https://WWW.CLEVELANDFOUNDATION.ORG",
    formation_year: 1914,
    principal_name: "SALLY GRIES",
    grant_size_minimum: 0,
    grant_size_maximum: 11049625,
  },
  officers_public_990: [{ name: "SALLY GRIES", title: "CHAIRMAN AND DIRECTOR" }],
  officers_total: 36,
  grant_history: [{ recipient: "UNIVERSITY HOSPITALS", total_usd: 13844459, grants: 2, latest_year: "2023" }],
  as_of: "2026-06",
  verify: "Point-in-time snapshot (June 2026). Verify eligibility and details on the funder's own site before applying.",
};

describe("unwrapLedgerList", () => {
  test("finds lookup_funder's list under `candidates` — the bug that shipped", () => {
    const env = unwrapLedgerList<{ ein: string }>(LOOKUP_FUNDER);
    expect(env.results).toHaveLength(2);
    expect(env.results[0].ein).toBe("340714588");
  });

  test("carries the metadata through", () => {
    const env = unwrapLedgerList(LOOKUP_FUNDER);
    expect(env.as_of).toBe("2026-06");
    expect(env.note).toContain("Ordered: exact name");
  });

  test("still reads a documented `results` envelope", () => {
    expect(unwrapLedgerList({ results: [{ a: 1 }], as_of: "2026-06" }).results).toHaveLength(1);
  });

  test("still reads a bare array", () => {
    expect(unwrapLedgerList([{ a: 1 }, { a: 2 }]).results).toHaveLength(2);
  });

  test("`results` wins over another list key when both are present", () => {
    const env = unwrapLedgerList<{ k: string }>({ results: [{ k: "right" }], candidates: [{ k: "wrong" }] });
    expect(env.results[0].k).toBe("right");
  });

  test("falls back to the first array-of-objects under an unknown key", () => {
    // Insurance against the next undocumented name. It cost us twice.
    const env = unwrapLedgerList<{ ein: string }>({ prospects: [{ ein: "1" }], as_of: "2026-06" });
    expect(env.results[0].ein).toBe("1");
  });

  test("never mistakes `suggestions` for the list", () => {
    const env = unwrapLedgerList({ suggestions: ["try a broader term"], as_of: "2026-06" });
    expect(env.results).toEqual([]);
    expect(env.suggestions).toEqual(["try a broader term"]);
  });

  test("an empty or malformed payload is an empty list, not a throw", () => {
    expect(unwrapLedgerList(null).results).toEqual([]);
    expect(unwrapLedgerList({}).results).toEqual([]);
    expect(unwrapLedgerList("nonsense").results).toEqual([]);
  });

  test("keeps the raw payload for callers that need the whole object", () => {
    expect(unwrapLedgerList(GET_FUNDER).raw).toBe(GET_FUNDER);
  });

  test("get_funder has no list, so results is empty — which is why raw exists", () => {
    expect(unwrapLedgerList(GET_FUNDER).results).toEqual([]);
  });
});

describe("funderProfileFromPayload", () => {
  const p = funderProfileFromPayload("340714588", GET_FUNDER);

  test("reads through the `profile` key", () => {
    expect(p.name).toBe("THE CLEVELAND FOUNDATION");
    expect(p.website).toBe("https://WWW.CLEVELANDFOUNDATION.ORG");
    expect(p.mission).toContain("improve the lives of Clevelanders");
  });

  test("builds location from city and state", () => {
    expect(p.location).toBe("CLEVELAND, OH");
  });

  test("uses the NTEE description as focus", () => {
    expect(p.focus).toContain("Public, Societal Benefit");
  });

  test("synthesises a range from grant_size_*, which get_funder has instead of typical_grant_range", () => {
    expect(p.typical_grant_range).toBe("Up to $11M");
  });

  test("a real floor produces a two-ended range", () => {
    const r = funderProfileFromPayload("1", { profile: { grant_size_minimum: 25000, grant_size_maximum: 500000 } });
    expect(r.typical_grant_range).toBe("$25K – $500K");
  });

  test("no size data means no invented range", () => {
    expect(funderProfileFromPayload("1", { profile: { organization_name: "X" } }).typical_grant_range).toBeUndefined();
  });

  test("a flat profile with no `profile` key still reads", () => {
    const r = funderProfileFromPayload("1", { organization_name: "Flat Fund", city: "Akron", state_code: "OH" });
    expect(r.name).toBe("Flat Fund");
    expect(r.location).toBe("Akron, OH");
  });

  test("the requested ein is kept when the payload is empty", () => {
    expect(funderProfileFromPayload("340714588", null).ein).toBe("340714588");
  });
});
