import { describe, it, expect } from "vitest";
import { screenGrant } from "@/lib/grant-screen";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";

const TODAY = new Date("2026-11-14T12:00:00Z");
const NY: EligibilityProfile = { ...EMPTY_PROFILE, org_type: "nonprofit_501c3", tax_status: "501c3", state_code: "NY", cause_areas: ["youth"] };
const g = (eligibility: string, extra: object = {}) =>
  ({ id: "t1", title: "Youth Program Fund", eligibility, close_date: "2027-03-01", ...extra }) as Parameters<typeof screenGrant>[0];

describe("the geographic blocker (the Ohio/NY case)", () => {
  it("excludes a grant restricted to states that are not the client's", () => {
    expect(screenGrant(g("Eligible applicants must be 501(c)(3) organizations based in Ohio serving youth."), NY, TODAY)).toBeNull();
  });
  it("keeps a grant naming the client's own state", () => {
    const s = screenGrant(g("Organizations located in New York serving youth."), NY, TODAY);
    expect(s).not.toBeNull();
  });
  it("keeps a multi-state grant that includes the client", () => {
    expect(screenGrant(g("Nonprofits based in Ohio, New York or Pennsylvania."), NY, TODAY)).not.toBeNull();
  });
  it("priority language blocks to check instead of excluding", () => {
    const s = screenGrant(g("Youth nonprofits; priority is given to organizations based in Ohio."), NY, TODAY);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("priority");
  });
  it("unknown client location blocks to check, never likely", () => {
    const p = { ...NY, state_code: null };
    const s = screenGrant(g("Organizations located in Ohio serving youth."), p, TODAY);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("location is not on file");
  });
  it("a state name without restriction phrasing does not exclude", () => {
    expect(screenGrant(g("Funded in partnership with the Ohio History Connection. Open to youth nonprofits nationwide."), NY, TODAY)).not.toBeNull();
  });
});

describe("hard exclusions", () => {
  it("individuals-only never reaches an organization", () => {
    expect(screenGrant(g("Fellowships for individual artists only."), NY, TODAY)).toBeNull();
  });
  it("current-grantees-only is structurally closed", () => {
    expect(screenGrant(g("Open to current grantees only; youth organizations."), NY, TODAY)).toBeNull();
  });
});

describe("named blockers cap at check", () => {
  it("budget floor against the band", () => {
    const p = { ...NY, budget_band: "lt_100k" };
    const s = screenGrant(g("Youth nonprofits with annual budgets of at least $1,000,000."), p, TODAY);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("budget of at least");
  });
  it("budget ceiling against the band", () => {
    const p = { ...NY, budget_band: "gt_10m" };
    const s = screenGrant(g("For youth organizations with budgets under $500,000."), p, TODAY);
    expect(s?.verdict).toBe("check");
  });
  it("years in operation once the founding year is known", () => {
    const p = { ...NY, founded_year: 2025 };
    const s = screenGrant(g("Applicants must have at least three years of operating history. Youth welcome."), p, TODAY);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("3 years");
  });
  it("audit requirement when the profile says none", () => {
    const p = { ...NY, audited_financials: false };
    const s = screenGrant(g("Audited financial statements required. Youth programs."), p, TODAY);
    expect(s?.verdict).toBe("check");
  });
  it("audit requirement stays silent when unknown", () => {
    const s = screenGrant(g("Audited financial statements required. Youth programs."), NY, TODAY);
    expect(s?.reason ?? "").not.toContain("audited");
  });
  it("county restriction unresolved caps at check", () => {
    const s = screenGrant(g("Organizations in Cuyahoga County serving youth."), NY, TODAY);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("Cuyahoga County");
  });
  it("county match is a positive", () => {
    const p = { ...NY, state_code: "OH", county: "Cuyahoga" };
    const s = screenGrant(g("Organizations in Cuyahoga County serving youth."), p, TODAY);
    expect(s?.reason).toContain("where you are");
  });
  it("must-serve without an overlap caps at check", () => {
    const s = screenGrant(g("Applicants must primarily serve veterans. Youth programs also considered."), NY, TODAY);
    expect(s?.verdict).toBe("check");
  });
  it("must-serve matching the populations list is a positive", () => {
    const p = { ...NY, populations: ["veterans"] };
    const s = screenGrant(g("Applicants must primarily serve veterans."), p, TODAY);
    expect(s?.reason).toContain("veterans");
  });
});

describe("the missing-text cap", () => {
  it("no eligibility text never beats check", () => {
    const s = screenGrant(g("", { title: "Youth Opportunity Fund" }), NY, TODAY);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("human read");
  });
});
