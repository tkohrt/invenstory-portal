import "server-only";
import { userClient } from "./supabase";
import { EMPTY_PROFILE, structuralGaps, type EligibilityProfile, type Gap } from "@/lib/eligibility-fields";
import { getContentCoverage, coverageGaps, readiness } from "./gap-agent";

export async function getEligibilityProfile(tenantId: string): Promise<EligibilityProfile> {
  const s = await userClient();
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
  };
}

// Full gap list + readiness for the Funding Eligibility page.
export async function getGaps(tenantId: string): Promise<{ gaps: Gap[]; computedAt: string | null; readiness: ReturnType<typeof readiness> }> {
  const [p, content] = await Promise.all([getEligibilityProfile(tenantId), getContentCoverage(tenantId)]);
  return { gaps: [...structuralGaps(p), ...coverageGaps(p.org_type, content.cov)], computedAt: content.computedAt, readiness: readiness(p.org_type, content.cov) };
}
