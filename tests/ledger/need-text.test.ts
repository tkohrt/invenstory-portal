/**
 * The query text is the single highest-leverage input to matching. A run for a
 * healthtech startup returned patient-assistance funds and scholarships because
 * the grants query described who the client serves rather than what the client
 * needs funded. These tests pin that distinction down.
 */
import { describe, expect, test } from "vitest";
import { needText } from "@/lib/grant-screen";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";

const startup: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "for_profit", state_code: "OH", budget_band: "lt_100k",
  cause_areas: ["health care coordination"], populations: ["patients in recovery"],
};
const nonprofit: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "nonprofit_501c3", tax_status: "501c3", state_code: "OH",
  budget_band: "100k_500k", cause_areas: ["addiction recovery"], populations: ["people in recovery"],
};

describe("needText for grants", () => {
  test("does not lead with the population served", () => {
    const t = needText(startup, "RE-Assist", "grants");
    expect(t).not.toContain("patients in recovery");
  });

  test("describes a for-profit as a company seeking commercialization funding", () => {
    const t = needText(startup, "RE-Assist", "grants");
    expect(t).toMatch(/company/i);
    expect(t).toMatch(/SBIR|commercializ|pilot/i);
  });

  test("describes a nonprofit as seeking programme and operating funding", () => {
    const t = needText(nonprofit, "Fund The Climb", "grants");
    expect(t).toMatch(/nonprofit/i);
    expect(t).toMatch(/operating|programme|capacity/i);
    expect(t).not.toMatch(/SBIR/i);
  });

  test("carries the budget band through as a stage descriptor", () => {
    expect(needText(startup, "RE-Assist", "grants")).toMatch(/early-stage/i);
  });

  test("keeps geography, which funders and programmes both care about", () => {
    expect(needText(startup, "RE-Assist", "grants")).toContain("OH");
  });
});

describe("needText for funders", () => {
  test("DOES include the population, because who a funder backs depends on it", () => {
    const t = needText(nonprofit, "Fund The Climb", "funders");
    expect(t).toContain("people in recovery");
    expect(t).toContain("Fund The Climb");
  });

  test("the two purposes produce genuinely different text", () => {
    expect(needText(startup, "RE-Assist", "grants")).not.toBe(needText(startup, "RE-Assist", "funders"));
  });
});
