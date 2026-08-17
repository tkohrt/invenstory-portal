// Funding Eligibility — field option registry (shared client + server).
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
  { v: "other", l: "Other exemption" },
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
}

export const EMPTY_PROFILE: EligibilityProfile = {
  applicant_type: "organization", org_type: null, tax_status: null, ein: null, fiscal_sponsor: null,
  state_code: null, county: null, service_area: [], budget_band: null,
  populations: [], cause_areas: [], federal_registration: "none", match_capacity_pct: null, completeness: 0,
};

// The 9 gating fields; completeness = filled / 9.
export function computeCompleteness(p: Partial<EligibilityProfile>): number {
  const checks = [
    !!p.applicant_type, !!p.org_type, !!p.tax_status, !!p.state_code,
    (p.service_area?.length ?? 0) > 0, !!p.budget_band,
    (p.populations?.length ?? 0) > 0, (p.cause_areas?.length ?? 0) > 0,
    !!p.federal_registration,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// Human labels for the persistent chips.
export function profileChips(p: EligibilityProfile): string[] {
  const chips: string[] = [];
  const ot = ORG_TYPES.find(o => o.v === p.org_type); if (ot) chips.push(ot.l.replace(" — ", " "));
  if (p.state_code) chips.push(p.state_code);
  const ts = TAX_STATUS.find(t => t.v === p.tax_status); if (ts && p.tax_status !== "none") chips.push(ts.l);
  const bb = BUDGET_BANDS.find(b => b.v === p.budget_band); if (bb) chips.push(bb.l);
  if (p.populations[0]) chips.push(p.populations[0]);
  return chips;
}

// ---- Gap detection ----
export type GapTier = "red" | "yellow" | "low";
export interface Gap { tier: GapTier; key: string; label: string; fix: "profile" | "upload"; layer?: "I" | "II" | "III" }

// Structural gaps come straight from the profile fields (free, always current).
export function structuralGaps(p: EligibilityProfile): Gap[] {
  const g: Gap[] = [];
  if (!p.org_type)   g.push({ tier: "red", key: "org_type",   label: "Set your organization type — you can't be matched without it.", fix: "profile" });
  if (!p.state_code) g.push({ tier: "red", key: "location",   label: "Add your primary state — funders gate hard on geography.",       fix: "profile" });
  if (!p.tax_status) g.push({ tier: "red", key: "tax_status", label: "Set your tax status — needed to screen 501(c)(3)-only grants.",   fix: "profile" });
  if (p.service_area.length === 0) g.push({ tier: "yellow", key: "service_area", label: "List the states you serve.",          fix: "profile" });
  if (!p.budget_band)              g.push({ tier: "yellow", key: "budget_band",  label: "Add your annual operating budget.",   fix: "profile" });
  if (p.populations.length === 0)  g.push({ tier: "yellow", key: "populations",  label: "Add the populations you serve.",      fix: "profile" });
  if (p.cause_areas.length === 0)  g.push({ tier: "yellow", key: "cause_areas",  label: "Add your cause areas.",              fix: "profile" });
  return g;
}
