"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { computeCompleteness, ORG_TYPES, TAX_STATUS, BUDGET_BANDS, FEDERAL_REG, US_STATES, type EligibilityProfile } from "@/lib/eligibility-fields";

const inSet = (v: unknown, set: { v: string | number }[]) => set.some(o => o.v === v);
const cleanList = (a: unknown): string[] =>
  Array.isArray(a) ? [...new Set(a.map(x => String(x).trim()).filter(Boolean))].slice(0, 30) : [];

export async function saveEligibilityProfileAction(input: Partial<EligibilityProfile>) {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const p: EligibilityProfile = {
    applicant_type: input.applicant_type === "individual" ? "individual" : "organization",
    org_type: inSet(input.org_type, ORG_TYPES) ? input.org_type! : null,
    tax_status: inSet(input.tax_status, TAX_STATUS) ? input.tax_status! : null,
    ein: (input.ein ?? "").toString().trim().slice(0, 20) || null,
    fiscal_sponsor: (input.fiscal_sponsor ?? "").toString().trim().slice(0, 160) || null,
    state_code: US_STATES.includes(String(input.state_code)) ? input.state_code! : null,
    county: (input.county ?? "").toString().trim().slice(0, 120) || null,
    service_area: cleanList(input.service_area).filter(x => US_STATES.includes(x)),
    budget_band: inSet(input.budget_band, BUDGET_BANDS) ? input.budget_band! : null,
    populations: cleanList(input.populations),
    cause_areas: cleanList(input.cause_areas),
    federal_registration: inSet(input.federal_registration, FEDERAL_REG) ? input.federal_registration! : "none",
    match_capacity_pct: [0, 10, 25, 50].includes(Number(input.match_capacity_pct)) ? Number(input.match_capacity_pct) : null,
    completeness: 0,
  };
  p.completeness = computeCompleteness(p);
  await db.from("eligibility_profile").upsert({ tenant_id: s.tenantId, ...p, updated_by: s.user.id, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "eligibility_save", detail: `completeness=${p.completeness}` });
  // A profile change invalidates any cached matches.
  await db.from("eligible_grant").delete().eq("tenant_id", s.tenantId);
  revalidatePath("/funding-eligibility"); revalidatePath("/invenstory");
  return { ok: true, completeness: p.completeness };
}
