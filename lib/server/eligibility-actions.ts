"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { cleanProfileInput, type EligibilityProfile } from "@/lib/eligibility-fields";

export async function saveEligibilityProfileAction(input: Partial<EligibilityProfile>) {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  // The rules for what may be stored are pure and tested (lib/eligibility-fields.ts).
  const p: EligibilityProfile = cleanProfileInput(input);
  const { error } = await db.from("eligibility_profile").upsert({ tenant_id: s.tenantId, ...p, updated_by: s.user.id, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  // Said, not swallowed: before 0071 is applied the new columns do not exist and
  // the whole save is refused, which used to look like a save that worked.
  if (error) {
    console.error("[eligibility] save refused", error.message);
    return { ok: false as const, error: "Your answers could not be saved. Please try again, or tell your For Granted team.", completeness: p.completeness };
  }
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "eligibility_save", detail: `completeness=${p.completeness}` });
  // A profile change invalidates any cached matches.
  await db.from("eligible_grant").delete().eq("tenant_id", s.tenantId);
  revalidatePath("/funding-eligibility"); revalidatePath("/invenstory");
  return { ok: true as const, error: null, completeness: p.completeness };
}
