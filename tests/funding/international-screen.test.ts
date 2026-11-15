// The international screen (patch 47, 15 Nov 2026). Every case here was a
// real miss measured against the patch-45 screen with a Kenya-registered
// profile, or is a guard that a US client's results did not change.
import { describe, it, expect } from "vitest";
import { screenGrant } from "@/lib/grant-screen";
import { placeRestrictions, outsideRestriction, hasUsEntity, hasUsSponsor } from "@/lib/place-gate";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";

const TODAY = new Date("2026-11-15T12:00:00Z");
const KE_NGO: EligibilityProfile = { ...EMPTY_PROFILE, org_type: "nonprofit_501c3", tax_status: "other", country_code: "KE",
  county: "Nairobi County", countries_served: ["UG"], regions_served: ["east_africa"], international: true, budget_band: "100k_500k",
  populations: ["youth"], cause_areas: ["education"], funding_kinds: ["grants", "programs"] };
const KE_STARTUP: EligibilityProfile = { ...KE_NGO, org_type: "for_profit", tax_status: "none", cause_areas: ["agriculture"], populations: ["smallholder farmers"] };
const OH: EligibilityProfile = { ...EMPTY_PROFILE, org_type: "nonprofit_501c3", tax_status: "501c3", state_code: "OH", cause_areas: ["education"] };
type G = Parameters<typeof screenGrant>[0];
const g = (eligibility: string, extra: object = {}) => ({ id: "t1", title: "Education Fund", eligibility, close_date: "2027-03-01", ...extra }) as G;
const reviewed = { reviewed: true };

describe("US wording, read for a client registered abroad", () => {
  it("excludes a US state restriction instead of calling the location unknown", () => {
    expect(screenGrant(g("Open to nonprofit organizations located in Ohio."), KE_NGO, TODAY, reviewed)).toBeNull();
  });
  it("state priority language caps at check and names the country", () => {
    const s = screenGrant(g("Nonprofit organizations; priority is given to organizations based in Ohio."), KE_NGO, TODAY, reviewed);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("registered in Kenya");
  });
  it("a 501(c)(3) requirement excludes an NGO that is not one", () => {
    expect(screenGrant(g("Applicants must be 501(c)(3) organizations working in education."), KE_NGO, TODAY, reviewed)).toBeNull();
  });
  it("a 501(c)(3) requirement stands for an abroad client whose tax status is 501(c)(3)", () => {
    const s = screenGrant(g("Applicants must be 501(c)(3) organizations working in education internationally."), { ...KE_NGO, tax_status: "501c3" }, TODAY);
    expect(s?.verdict).toBe("eligible");
  });
  it("a US fiscal sponsor turns a 501(c)(3) requirement into a named check", () => {
    const p = { ...KE_NGO, fiscal_sponsor: "Sponsor Org Inc" };
    expect(hasUsSponsor(p)).toBe(true);
    const s = screenGrant(g("Applicants must be 501(c)(3) organizations working in education."), p, TODAY);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("through your US fiscal sponsor");
  });
  it.each([
    "Applicants must be U.S.-based organizations.",
    "Open to organizations in the United States only.",
    "Eligible: domestic public or private nonprofit entities.",
    "Applicants must be incorporated in the United States.",
    "Applicant must be a U.S. organization with a track record in education.",
  ])("excludes US-only wording: %s", text => {
    expect(screenGrant(g(text), KE_NGO, TODAY, reviewed)).toBeNull();
  });
  it("does not read 'United States or Kenya' as US-only", () => {
    expect(screenGrant(g("Open to nonprofit organizations registered in the United States or Kenya."), KE_NGO, TODAY, reviewed)).not.toBeNull();
  });
  it("'501(c)(3)' no longer counts as naming an NGO's organization type", () => {
    const s = screenGrant(g("Nonprofit organizations only. Education projects in Kenya."), KE_NGO, TODAY, reviewed);
    expect(s?.reason).toContain("restricted to nonprofits, which you are");
  });
  it("an NGO is invited by NGO words", () => {
    const s = screenGrant(g("Open to NGOs and civil society organisations serving communities in Kenya and Uganda."), KE_NGO, TODAY, reviewed);
    expect(s?.verdict).toBe("eligible");
    expect(s?.reason).toContain("names Kenya");
  });
});

describe("the country gate", () => {
  it.each([
    ["Open to organizations registered in India.", KE_NGO],
    ["Applicants must be registered charities in the United Kingdom.", KE_NGO],
    ["Open to startups and small businesses headquartered in Nigeria working in agriculture.", KE_STARTUP],
    ["Open to organizations based in West Africa.", KE_NGO],
    ["The company must be registered in Ghana, Rwanda, South Africa or Tanzania.", KE_STARTUP],
    ["Open to organizations based in sub-Saharan Africa working on education.", OH],
  ] as const)("excludes a closed list the client is outside: %s", (text, p) => {
    expect(screenGrant(g(text), p, TODAY, reviewed)).toBeNull();
  });
  it.each([
    ["The company must be registered in Ghana, Kenya, Rwanda, South Africa or Tanzania.", KE_STARTUP],
    ["Open to African-led organizations working in sub-Saharan Africa on education.", KE_NGO],
    ["Open to organizations based in East Africa.", KE_NGO],
    ["Projects in Uganda led by local organizations.", KE_NGO],
    ["Open to organizations based in Africa, Asia and Latin America.", KE_NGO],
  ] as const)("keeps a list the client is in: %s", (text, p) => {
    expect(screenGrant(g(text), p, TODAY, reviewed)).not.toBeNull();
  });
  it("registration wording is answered by the country of registration, not where the client works", () => {
    // Works in Uganda, registered in Kenya.
    expect(screenGrant(g("Applicants must be legally registered in Uganda."), KE_NGO, TODAY, reviewed)).toBeNull();
    expect(screenGrant(g("Organizations working in Uganda."), KE_NGO, TODAY, reviewed)).not.toBeNull();
  });
  it("priority wording caps at check", () => {
    const s = screenGrant(g("Open to NGOs; preference for organizations based in Nigeria."), KE_NGO, TODAY, reviewed);
    expect(s?.verdict).toBe("check");
    expect(s?.reason).toContain("gives priority to Nigeria");
  });
  it("an open list never excludes", () => {
    expect(outsideRestriction("Open to organizations in countries including Nigeria and Ghana.", KE_NGO)).toBeNull();
    expect(outsideRestriction("Organizations based in Nigeria, Ghana and other countries worldwide.", KE_NGO)).toBeNull();
  });
  it("a place must follow the restriction phrase directly", () => {
    expect(placeRestrictions("Organizations working in partnership with schools in China.")).toHaveLength(0);
    expect(placeRestrictions("A registered nonprofit working in education in Kenya.")).toHaveLength(0);
  });
  it("leaves US state clauses to the state rule (Lebanon, Ohio is not the country)", () => {
    expect(placeRestrictions("Organizations located in Lebanon, Ohio.")).toHaveLength(0);
    expect(placeRestrictions("Nonprofits based in New Mexico.")).toHaveLength(0);
  });
  it("a US organization that works in Kenya is inside 'working in Kenya' but outside 'registered in Kenya'", () => {
    const p = { ...OH, countries_served: ["KE"] };
    expect(outsideRestriction("Organizations working in Kenya.", p)).toBeNull();
    expect(outsideRestriction("Applicants must be registered in Kenya.", p)).not.toBeNull();
  });
});

describe("the US database default", () => {
  const base = (eligibility: string) => g(eligibility); // no source, no review: a Ground Truth base row
  it("drops a base record that says nothing about funding beyond the US", () => {
    expect(screenGrant(base("The foundation supports organizations improving education outcomes for youth."), KE_NGO, TODAY)).toBeNull();
    expect(screenGrant(base(""), KE_NGO, TODAY)).toBeNull();
  });
  it("keeps a base record that names the client's country or says it funds internationally", () => {
    expect(screenGrant(base("Supports nonprofit organizations improving education in Kenya."), KE_NGO, TODAY)).not.toBeNull();
    expect(screenGrant(base("Supports education organizations internationally."), KE_NGO, TODAY)).not.toBeNull();
  });
  it("never drops a record For Granted reviewed, or one from an international source", () => {
    const text = "The fund supports organizations improving education outcomes for youth.";
    expect(screenGrant(g(text), KE_NGO, TODAY, reviewed)).not.toBeNull();
    expect(screenGrant({ ...g(text), _overlay: { reviewed_at: "2026-11-01" } } as G, KE_NGO, TODAY)).not.toBeNull();
    expect(screenGrant(g(text, { source: "eu_ft" }), KE_NGO, TODAY)).not.toBeNull();
  });
  it("leaves base records alone for a client with a US entity or a US fiscal sponsor", () => {
    const text = "The foundation supports organizations improving education outcomes for youth.";
    expect(hasUsEntity({ ...KE_NGO, tax_status: "501c3" })).toBe(true);
    expect(screenGrant(base(text), { ...KE_NGO, tax_status: "501c3" }, TODAY)).not.toBeNull();
    expect(screenGrant(base(text), { ...KE_NGO, fiscal_sponsor: "Sponsor Org Inc" }, TODAY)).not.toBeNull();
  });
});

describe("a US client's results are unchanged", () => {
  it.each([
    ["Open to nonprofit organizations located in Ohio.", "eligible"],
    ["Applicants must be 501(c)(3) organizations working in education.", "eligible"],
    ["Applicants must be U.S.-based organizations working in education.", "likely"],
    ["The foundation supports organizations improving education outcomes for youth.", "likely"],
    ["Eligible: domestic public or private nonprofit entities working in education.", "likely"],
  ] as const)("%s", (text, verdict) => {
    expect(screenGrant(g(text), OH, TODAY)?.verdict).toBe(verdict);
  });
  it("still excludes another state", () => {
    expect(screenGrant(g("Open to nonprofit organizations located in Texas."), OH, TODAY)).toBeNull();
  });
});
