/**
 * Signal 1 of the matching pipeline: the eligibility hard filter. This is the
 * step that decides what a client never sees, so it gets tested without a
 * network or a database.
 */
import { describe, expect, test } from "vitest";
import { screenGrant, needText } from "@/lib/grant-screen";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";
import type { GrantCard } from "@/lib/ledger-types";

const TODAY = new Date("2026-08-28T00:00:00Z");
const nonprofit: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "nonprofit_501c3", tax_status: "501c3",
  state_code: "OH", cause_areas: ["addiction recovery"], populations: ["people in recovery"],
};
const startup: EligibilityProfile = { ...EMPTY_PROFILE, org_type: "for_profit", state_code: "OH" };

const grant = (o: Partial<GrantCard>): GrantCard => ({ title: "Test Grant", ...o });

describe("screenGrant", () => {
  test("drops an opportunity whose deadline has passed", () => {
    expect(screenGrant(grant({ close_date: "2026-07-01" }), nonprofit, TODAY)).toBeNull();
  });

  test("keeps a rolling opportunity (no close date)", () => {
    expect(screenGrant(grant({}), nonprofit, TODAY)).not.toBeNull();
  });

  test("keeps a future deadline", () => {
    const r = screenGrant(grant({ close_date: "2026-12-01" }), nonprofit, TODAY);
    expect(r?.close_date).toBe("2026-12-01");
  });

  test("a 501(c)(3)-only grant is eligible for a nonprofit and dropped for a startup", () => {
    const g = grant({ eligibility: "Open to 501(c)(3) organizations only." });
    expect(screenGrant(g, nonprofit, TODAY)?.verdict).toBe("eligible");
    expect(screenGrant(g, startup, TODAY)).toBeNull();
  });

  test("government-only is dropped for a nonprofit", () => {
    const g = grant({ eligibility: "Eligible applicants are units of local government." });
    expect(screenGrant(g, nonprofit, TODAY)).toBeNull();
  });

  test("federal money without SAM/UEI is flagged, not hidden", () => {
    const r = screenGrant(grant({ agency: "SAMHSA", eligibility: "See grants.gov" }), nonprofit, TODAY);
    expect(r?.verdict).toBe("check");
    expect(r?.reason).toMatch(/SAM\.gov/);
  });

  test("'federal poverty level' in an assistance program is not a federal opportunity", () => {
    const g = grant({ agency: "kfohio.org", eligibility: "Applicants must be at or below 200% of the federal poverty level." });
    const r = screenGrant(g, nonprofit, TODAY);
    expect(r?.reason).not.toMatch(/SAM\.gov/);
  });

  test("a real federal marker still flags", () => {
    const g = grant({ agency: "grants.gov", eligibility: "See the NOFO." });
    expect(screenGrant(g, nonprofit, TODAY)?.reason).toMatch(/SAM\.gov/);
  });

  test("federal money with SAM/UEI active is not flagged for registration", () => {
    const p = { ...nonprofit, federal_registration: "sam_uei_active" };
    const r = screenGrant(grant({ agency: "SAMHSA", eligibility: "See grants.gov" }), p, TODAY);
    expect(r?.reason).not.toMatch(/SAM\.gov/);
  });

  test("a match requirement is surfaced when the org has no match capacity", () => {
    const p = { ...nonprofit, match_capacity_pct: 0 };
    const r = screenGrant(grant({ eligibility: "Requires a 25% cost match." }), p, TODAY);
    expect(r?.verdict).toBe("check");
    expect(r?.reason).toMatch(/cost match/);
  });

  test("defaults to check, never to eligible, when the rules cannot decide", () => {
    const r = screenGrant(grant({ eligibility: "Applicants should serve the community." }), nonprofit, TODAY);
    expect(r?.verdict).toBe("check");
  });

  test("award ceiling is read from either field name", () => {
    expect(screenGrant(grant({ max_award: 50000 }), nonprofit, TODAY)?.award_ceiling).toBe(50000);
    expect(screenGrant(grant({ award_ceiling: 75000 }), nonprofit, TODAY)?.award_ceiling).toBe(75000);
  });
});

describe("needText", () => {
  test("builds a plain-English query from the profile", () => {
    const t = needText(nonprofit, "Fund The Climb");
    expect(t).toContain("Fund The Climb");
    expect(t).toContain("addiction recovery");
    expect(t).toContain("OH");
  });
});
