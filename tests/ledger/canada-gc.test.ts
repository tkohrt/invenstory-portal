import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeCanada, canadaProgrammes, canadaFunderRows, planOpenSources } from "@/lib/open-data";

const fixture = JSON.parse(readFileSync("tests/fixtures/open-data/canada-gc-kenya.json", "utf8"));

describe("Canada grants and contributions", () => {
  const rows = decodeCanada(fixture);

  it("decodes the real response, English names only", () => {
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.every(r => !r.department.includes("|"))).toBe(true);
    expect(rows.every(r => r.country === "KE")).toBe(true);
  });

  it("never throws on junk", () => {
    expect(decodeCanada(null)).toEqual([]);
    expect(decodeCanada({ result: { records: [{}, { owner_org_title: "x" }] } })).toEqual([]);
  });

  it("keeps programmes a client could apply to, not treaty dues or UN bodies", () => {
    const progs = canadaProgrammes(rows, ["democratic governance", "pastoralist rights"]);
    expect(progs.length).toBeGreaterThan(0);
    expect(progs.some(p => p.programme === "Canada Fund for Local Initiatives")).toBe(true);
    for (const p of progs) {
      expect(p.programme).not.toMatch(/convention|protocol|secretariat/i);
      for (const a of p.awards) expect(a.recipient).not.toMatch(/united nations|\bUNEP\b/i);
    }
    expect(progs[0].relevance).toBeGreaterThan(0);
  });

  it("builds funder rows in Canadian dollars, labelled with their source", () => {
    const out = canadaFunderRows(canadaProgrammes(rows, ["governance"]), c => (c === "KE" ? "Kenya" : c));
    for (const r of out) {
      expect(r.funder_id.startsWith("canada:")).toBe(true);
      expect(r.source).toBe("canada");
      expect(r.match_reason).toContain("Kenya");
      expect(r.match_reason).not.toMatch(/—/);
      if (r.typical_grant_range) expect(r.typical_grant_range).toMatch(/^CAD /);
    }
  });

  it("is planned for international grant seekers only", () => {
    const base = { org_type: "nonprofit_501c3", state_code: null, cause_areas: ["health"] } as never;
    expect(planOpenSources({ ...(base as object), countries_served: ["KE"], funding_kinds: ["grants"] } as never).canada)
      .toEqual({ countries: ["KE"] });
    expect(planOpenSources({ ...(base as object), countries_served: ["KE"], funding_kinds: ["contracts"] } as never).canada).toBeNull();
  });
});
