import "server-only";
import { userClient } from "./supabase";
import { db } from "./db";
import { EMPTY_PROFILE, structuralGaps, type EligibilityProfile, type Gap } from "@/lib/eligibility-fields";
import { getContentCoverage, coverageGaps, readiness } from "./gap-agent";

/**
 * One client's eligibility profile. Pages read it as the signed-in person
 * (RLS). A scheduled run has nobody signed in, so RLS returns nothing and the
 * profile reads as empty: such a caller passes `asService` and the read is
 * made with the service role, scoped to the one tenant (patch 70: without
 * this the twice-weekly signals run screened nobody).
 */
export async function getEligibilityProfile(tenantId: string, asService = false): Promise<EligibilityProfile> {
  const s = asService ? db : await userClient();
  const { data } = await s.from("eligibility_profile").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!data) return { ...EMPTY_PROFILE };
  return {
    applicant_type: data.applicant_type ?? "organization",
    org_type: data.org_type, tax_status: data.tax_status, ein: data.ein, fiscal_sponsor: data.fiscal_sponsor,
    state_code: data.state_code, county: data.county,
    service_area: data.service_area ?? [], budget_band: data.budget_band,
    populations: data.populations ?? [], cause_areas: data.cause_areas ?? [],
    federal_registration: data.federal_registration ?? "none", match_capacity_pct: data.match_capacity_pct,
    completeness: data.completeness ?? 0,
    // International eligibility (0071). Absent before the migration runs, so
    // every read falls back to the US-only profile it was.
    country_code: data.country_code ?? null,
    countries_served: Array.isArray(data.countries_served) ? data.countries_served : [],
    regions_served: Array.isArray(data.regions_served) ? data.regions_served : [],
    international: data.international === true,
    // What it is looking for (0072). Grants when unset, as every profile was.
    funding_kinds: Array.isArray(data.funding_kinds) && data.funding_kinds.length ? data.funding_kinds : ["grants"],
    // The hardened screen's known facts (0091). Absent before the migration
    // runs, and null fires no rule either way.
    founded_year: typeof data.founded_year === "number" ? data.founded_year : null,
    audited_financials: typeof data.audited_financials === "boolean" ? data.audited_financials : null,
  };
}

// Full gap list + readiness for the Funding Eligibility page.
export async function getGaps(tenantId: string): Promise<{ gaps: Gap[]; computedAt: string | null; readiness: ReturnType<typeof readiness> }> {
  const [p, content] = await Promise.all([getEligibilityProfile(tenantId), getContentCoverage(tenantId)]);
  return { gaps: [...structuralGaps(p), ...coverageGaps(p.org_type, content.cov)], computedAt: content.computedAt, readiness: readiness(p.org_type, content.cov) };
}
