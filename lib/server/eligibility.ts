import "server-only";
import { userClient } from "./supabase";
import { EMPTY_PROFILE, computeCompleteness, profileChips, structuralGaps, type EligibilityProfile, type Gap } from "@/lib/eligibility-fields";
import { getContentGaps } from "./gap-agent";

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

export interface EligibilitySummary { started: boolean; completeness: number; chips: string[]; eligibleCount: number | null; red: number; yellow: number; low: number }

export async function getEligibilitySummary(tenantId: string): Promise<EligibilitySummary> {
  const [p, content] = await Promise.all([getEligibilityProfile(tenantId), getContentGaps(tenantId)]);
  const started = p.completeness > 0 || p.org_type != null;
  const gaps: Gap[] = [...structuralGaps(p), ...content.gaps];
  const count = (t: string) => gaps.filter(g => g.tier === t).length;
  // eligibleCount stays null until the Ledger matching pipeline is wired.
  return { started, completeness: computeCompleteness(p), chips: profileChips(p), eligibleCount: null,
    red: count("red"), yellow: count("yellow"), low: count("low") };
}

// Full gap list for the Funding Eligibility page.
export async function getGaps(tenantId: string): Promise<{ gaps: Gap[]; computedAt: string | null }> {
  const [p, content] = await Promise.all([getEligibilityProfile(tenantId), getContentGaps(tenantId)]);
  return { gaps: [...structuralGaps(p), ...content.gaps], computedAt: content.computedAt };
}
