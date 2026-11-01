/**
 * International eligibility (patch 1 of the 1 November 2026 build): a profile
 * that says where an organization is with a country, not only a US state.
 */
import { describe, expect, test } from "vitest";
import {
  EMPTY_PROFILE, cleanProfileInput, computeCompleteness, structuralGaps, homeLabel, homeCountry,
  wantsInternational, reachLabels, profileChips, type EligibilityProfile,
} from "@/lib/eligibility-fields";
import { screenGrant, needText, placeNamed } from "@/lib/grant-screen";
import { COUNTRIES, COUNTRY_NAME, REGIONS, isCountryCode, textNames, countryNames, regionsOf } from "@/lib/countries";

const TODAY = new Date("2026-11-01T00:00:00Z");

const kenyan: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "for_profit", tax_status: "none", country_code: "KE",
  countries_served: ["UG", "TZ"], regions_served: ["east_africa"],
  cause_areas: ["technical assistance"], populations: ["small businesses"], budget_band: "100k_500k",
};
const ohio: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "nonprofit_501c3", tax_status: "501c3", state_code: "OH",
  service_area: ["OH"], cause_areas: ["youth"], populations: ["teens"], budget_band: "500k_1m",
};

describe("the country list", () => {
  test("every code is two capital letters and appears once", () => {
    const codes = COUNTRIES.map(([c]) => c);
    expect(codes.every(c => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });
  test("names funders write, without ampersands or curly quotes", () => {
    expect(COUNTRY_NAME.KE).toBe("Kenya");
    expect(COUNTRY_NAME.CD).toBe("Democratic Republic of the Congo");
    expect(COUNTRIES.some(([, n]) => /&|’/.test(n))).toBe(false);
  });
  test("every region member is a real country code", () => {
    for (const r of REGIONS) for (const m of r.members) expect(isCountryCode(m)).toBe(true);
    expect(regionsOf("KE")).toEqual(["east_africa"]);
  });
  test("names are found on word edges, aliases included", () => {
    expect(textNames("Consulting services, DRC health programme", countryNames("CD"))).toBe("drc");
    expect(textNames("Ivory Coast agribusiness", countryNames("CI"))).toBe("ivory coast");
    expect(textNames("Kenyatta University", countryNames("KE"))).toBeNull();
  });
});

describe("a profile registered outside the US", () => {
  test("is complete without a US state", () => {
    expect(computeCompleteness(kenyan)).toBe(100);
  });
  test("is not told to add a primary state", () => {
    const keys = structuralGaps(kenyan).map(g => g.key);
    expect(keys).not.toContain("location");
    expect(keys).not.toContain("service_area");
  });
  test("a US profile with no state is still told to add one", () => {
    expect(structuralGaps({ ...ohio, state_code: null }).map(g => g.key)).toContain("location");
  });
  test("reads as Kenya, and works across its countries and region", () => {
    expect(homeLabel(kenyan)).toBe("Kenya");
    expect(reachLabels(kenyan)).toEqual(["Uganda", "Tanzania", "East Africa"]);
    expect(profileChips(kenyan)).toContain("Kenya");
  });
  test("looks abroad without being asked", () => {
    expect(wantsInternational(kenyan)).toBe(true);
    expect(wantsInternational({ ...ohio, countries_served: ["KE"] })).toBe(true);
    expect(wantsInternational({ ...ohio, regions_served: ["north_america"] })).toBe(false);
    expect(wantsInternational(ohio)).toBe(false);
    expect(wantsInternational({ ...ohio, international: true })).toBe(true);
  });
});

describe("a profile saved before countries existed", () => {
  test("is read as the United States, exactly as before", () => {
    expect(homeCountry(ohio)).toBe("US");
    expect(homeLabel(ohio)).toBe("OH");
    expect(computeCompleteness(ohio)).toBe(100);
  });
  test("its funder query is unchanged", () => {
    expect(needText(ohio, "Acme", "funders")).toBe(
      "Acme, a nonprofit — 501(c)(3) based in OH working on youth serving teens across OH");
  });
});

describe("cleanProfileInput", () => {
  test("drops a state for an organization registered abroad", () => {
    const p = cleanProfileInput({ ...kenyan, state_code: "OH", service_area: ["OH"] });
    expect(p.state_code).toBeNull();
    expect(p.service_area).toEqual(["OH"]);   // states served are a fact, not a home
  });
  test("refuses codes that are not countries or regions", () => {
    const p = cleanProfileInput({ ...kenyan, country_code: "XX", countries_served: ["UG", "ZZ", "uganda"], regions_served: ["east_africa", "mars"] });
    expect(p.country_code).toBeNull();
    expect(p.countries_served).toEqual(["UG"]);
    expect(p.regions_served).toEqual(["east_africa"]);
  });
  test("keeps the state for a US organization and only real states served", () => {
    const p = cleanProfileInput({ ...ohio, country_code: "US", service_area: ["OH", "Ontario"] });
    expect(p.state_code).toBe("OH");
    expect(p.service_area).toEqual(["OH"]);
  });
  test("international is only ever a real true", () => {
    expect(cleanProfileInput({ ...ohio, international: "yes" as unknown as boolean }).international).toBe(false);
    expect(cleanProfileInput({ ...ohio, international: true }).international).toBe(true);
  });
  test("computes completeness", () => {
    expect(cleanProfileInput(kenyan).completeness).toBe(100);
  });
});

describe("the screen reads countries and regions", () => {
  test("an opportunity naming a country they work in gains a signal", () => {
    const r = screenGrant({ title: "Technical assistance for SMEs", eligibility: "Firms operating in Uganda", close_date: "2026-12-01" }, kenyan, TODAY);
    expect(r?.reason).toContain("names Uganda");
    expect(r?.verdict).toBe("likely");
  });
  test("a region name counts, an unrelated country does not", () => {
    expect(placeNamed("Open to consultancies across East Africa", kenyan)).toBe("East Africa");
    expect(placeNamed("Open to firms in Peru", kenyan)).toBeNull();
  });
  test("the United States never counts as a signal", () => {
    expect(placeNamed("Open to organizations in the United States", { ...ohio, countries_served: ["US"] })).toBeNull();
  });
  test("the funder query says Kenya, not a state", () => {
    expect(needText(kenyan, "Berman Consulting", "funders")).toContain("based in Kenya");
    expect(needText(kenyan, "Berman Consulting", "funders")).toContain("across Uganda, Tanzania, East Africa");
  });
});
