// Funding Eligibility — field option registry (shared client + server).
import { COUNTRY_NAME, REGION_LABEL, isCountryCode, isRegionKey, countryName } from "@/lib/countries";
export const ORG_TYPES = [
  { v: "nonprofit_501c3", l: "Nonprofit — 501(c)(3)" },
  { v: "for_profit", l: "For-profit / startup" },
  { v: "government", l: "Government / municipal" },
  { v: "school", l: "School / university" },
  { v: "tribal", l: "Tribal" },
  { v: "fiscally_sponsored", l: "Fiscally sponsored" },
  { v: "other", l: "Other" },
];
export const TAX_STATUS = [
  { v: "501c3", l: "501(c)(3) tax-exempt" },
  { v: "pending", l: "501(c)(3) pending" },
  // Also the honest answer for a registered charity or NGO outside the United
  // States (international eligibility, 1 Nov 2026): not a 501(c)(3), but not
  // a company either.
  { v: "other", l: "Other exemption (including a registered charity or NGO outside the US)" },
  { v: "none", l: "Not tax-exempt" },
];
export const BUDGET_BANDS = [
  { v: "lt_100k", l: "Under $100K" },
  { v: "100k_500k", l: "$100K–$500K" },
  { v: "500k_1m", l: "$500K–$1M" },
  { v: "1m_5m", l: "$1M–$5M" },
  { v: "5m_10m", l: "$5M–$10M" },
  { v: "gt_10m", l: "$10M+" },
];
export const FEDERAL_REG = [
  { v: "none", l: "Not registered" },
  { v: "sam_uei_active", l: "SAM.gov + UEI active" },
];
export const MATCH_CAPACITY = [
  { v: 0, l: "No match available" },
  { v: 10, l: "Up to 10%" },
  { v: 25, l: "Up to 25%" },
  { v: 50, l: "50%+" },
];
export const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

export interface EligibilityProfile {
  applicant_type: string; org_type: string | null; tax_status: string | null;
  ein: string | null; fiscal_sponsor: string | null;
  state_code: string | null; county: string | null;
  service_area: string[]; budget_band: string | null;
  populations: string[]; cause_areas: string[];
  federal_registration: string; match_capacity_pct: number | null;
  completeness: number;
  /**
   * Where the organization is registered, ISO 3166 alpha-2. Null on profiles
   * saved before 1 November 2026, which were all US: read through homeCountry,
   * never directly, so null keeps meaning the United States.
   */
  country_code: string | null;
  /** Countries it works in, ISO alpha-2. The US states served stay in service_area. */
  countries_served: string[];
  /** World regions it works across (lib/countries.ts REGIONS keys). */
  regions_served: string[];
  /** Asked to see funding from outside the United States. */
  international: boolean;
}

export const EMPTY_PROFILE: EligibilityProfile = {
  applicant_type: "organization", org_type: null, tax_status: null, ein: null, fiscal_sponsor: null,
  state_code: null, county: null, service_area: [], budget_band: null,
  populations: [], cause_areas: [], federal_registration: "none", match_capacity_pct: null, completeness: 0,
  country_code: null, countries_served: [], regions_served: [], international: false,
};

// ---- Place (international eligibility, 1 Nov 2026) ----

/** Where it is registered. A profile from before countries existed is US. */
export function homeCountry(p: Pick<EligibilityProfile, "country_code">): string {
  return p.country_code ?? "US";
}

export function isUsBased(p: Pick<EligibilityProfile, "country_code">): boolean {
  return homeCountry(p) === "US";
}

/**
 * Should a search look outside the United States?
 *
 * Yes when the client asked, and also when the facts say so without being
 * asked: an organization registered abroad, or one working in another country,
 * would otherwise be matched only against US money it mostly cannot use.
 */
export function wantsInternational(p: Pick<EligibilityProfile, "international" | "country_code" | "countries_served" | "regions_served">): boolean {
  if (p.international) return true;
  if (!isUsBased(p)) return true;
  if ((p.countries_served ?? []).some(c => c !== "US")) return true;
  return (p.regions_served ?? []).some(r => r !== "north_america");
}

/** "OH", or "Kenya": how a funder would read where this organization is. */
export function homeLabel(p: Pick<EligibilityProfile, "country_code" | "state_code">): string | null {
  if (isUsBased(p)) return p.state_code ?? (p.country_code ? "United States" : null);
  return countryName(p.country_code);
}

/** Every place it works, as words: states, then countries, then regions. */
export function reachLabels(p: Pick<EligibilityProfile, "service_area" | "countries_served" | "regions_served">): string[] {
  return [
    ...p.service_area,
    ...(p.countries_served ?? []).map(c => COUNTRY_NAME[c]).filter(Boolean),
    ...(p.regions_served ?? []).map(r => REGION_LABEL[r]).filter(Boolean),
  ];
}

/** Countries named anywhere in the profile, home first, de-duplicated. */
export function profileCountries(p: Pick<EligibilityProfile, "country_code" | "countries_served">): string[] {
  const out = [homeCountry(p), ...(p.countries_served ?? [])];
  return [...new Set(out)];
}

const cleanList = (a: unknown, max = 30): string[] =>
  Array.isArray(a) ? [...new Set(a.map(x => String(x).trim()).filter(Boolean))].slice(0, max) : [];

const inOptions = (v: unknown, set: { v: string | number }[]) => set.some(o => o.v === v);

/**
 * What a save may store, from whatever the form (or anyone posting to the
 * action) sent. Pure, so the rules are tested rather than trusted.
 *
 * A state only means something in the United States: an organization
 * registered elsewhere keeps no primary state, so the screen never reads "OH"
 * for a Nairobi consultancy that once had it set.
 */
export function cleanProfileInput(input: Partial<EligibilityProfile>): EligibilityProfile {
  const country = isCountryCode(input.country_code) ? input.country_code : null;
  const us = (country ?? "US") === "US";
  const p: EligibilityProfile = {
    applicant_type: input.applicant_type === "individual" ? "individual" : "organization",
    org_type: inOptions(input.org_type, ORG_TYPES) ? input.org_type! : null,
    tax_status: inOptions(input.tax_status, TAX_STATUS) ? input.tax_status! : null,
    ein: (input.ein ?? "").toString().trim().slice(0, 20) || null,
    fiscal_sponsor: (input.fiscal_sponsor ?? "").toString().trim().slice(0, 160) || null,
    state_code: us && US_STATES.includes(String(input.state_code)) ? input.state_code! : null,
    county: (input.county ?? "").toString().trim().slice(0, 120) || null,
    service_area: cleanList(input.service_area).filter(x => US_STATES.includes(x)),
    budget_band: inOptions(input.budget_band, BUDGET_BANDS) ? input.budget_band! : null,
    populations: cleanList(input.populations),
    cause_areas: cleanList(input.cause_areas),
    federal_registration: inOptions(input.federal_registration, FEDERAL_REG) ? input.federal_registration! : "none",
    match_capacity_pct: [0, 10, 25, 50].includes(Number(input.match_capacity_pct)) ? Number(input.match_capacity_pct) : null,
    completeness: 0,
    country_code: country,
    countries_served: cleanList(input.countries_served, 80).filter(isCountryCode),
    regions_served: cleanList(input.regions_served, 20).filter(isRegionKey),
    international: input.international === true,
  };
  p.completeness = computeCompleteness(p);
  return p;
}

// The 9 gating fields; completeness = filled / 9.
//
// Location is answered by a US state, or by a country outside the US (which has
// no state to give). Reach is answered by states, countries or regions served.
export function computeCompleteness(p: Partial<EligibilityProfile>): number {
  const abroad = !!p.country_code && p.country_code !== "US";
  const reach = (p.service_area?.length ?? 0) + (p.countries_served?.length ?? 0) + (p.regions_served?.length ?? 0);
  const checks = [
    !!p.applicant_type, !!p.org_type, !!p.tax_status, !!p.state_code || abroad,
    reach > 0, !!p.budget_band,
    (p.populations?.length ?? 0) > 0, (p.cause_areas?.length ?? 0) > 0,
    !!p.federal_registration,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// Human labels for the persistent chips.
export function profileChips(p: EligibilityProfile): string[] {
  const chips: string[] = [];
  const ot = ORG_TYPES.find(o => o.v === p.org_type); if (ot) chips.push(ot.l.replace(" — ", " "));
  if (!isUsBased(p)) { const c = countryName(p.country_code); if (c) chips.push(c); }
  else if (p.state_code) chips.push(p.state_code);
  const ts = TAX_STATUS.find(t => t.v === p.tax_status); if (ts && p.tax_status !== "none") chips.push(ts.l);
  const bb = BUDGET_BANDS.find(b => b.v === p.budget_band); if (bb) chips.push(bb.l);
  if (p.populations[0]) chips.push(p.populations[0]);
  return chips;
}

// ---- Gap detection ----
export type GapTier = "critical" | "essential" | "important" | "enriching";
export interface Gap { tier: GapTier; key: string; label: string; fix: "profile" | "upload"; layer?: "I" | "II" | "III"; weak?: boolean }

// Structural gaps come straight from the profile fields (free, always current).
export function structuralGaps(p: EligibilityProfile): Gap[] {
  const g: Gap[] = [];
  if (!p.org_type)   g.push({ tier: "critical", key: "org_type",   label: "Set your organization type — you can't be matched without it.", fix: "profile" });
  // Outside the US there is no state to give, so the country answers it.
  if (isUsBased(p) && !p.state_code) g.push({ tier: "critical", key: "location", label: "Add your primary state (or your country, if you are outside the US): funders gate hard on geography.", fix: "profile" });
  if (!p.tax_status) g.push({ tier: "critical", key: "tax_status", label: "Set your tax status — needed to screen 501(c)(3)-only grants.",   fix: "profile" });
  if (reachLabels(p).length === 0) g.push({ tier: "important", key: "service_area", label: isUsBased(p) ? "List the states or countries you serve." : "List the countries you work in.", fix: "profile" });
  if (!p.budget_band)              g.push({ tier: "important", key: "budget_band",  label: "Add your annual operating budget.",   fix: "profile" });
  if (p.populations.length === 0)  g.push({ tier: "important", key: "populations",  label: "Add the populations you serve.",      fix: "profile" });
  if (p.cause_areas.length === 0)  g.push({ tier: "important", key: "cause_areas",  label: "Add your cause areas.",              fix: "profile" });
  return g;
}
