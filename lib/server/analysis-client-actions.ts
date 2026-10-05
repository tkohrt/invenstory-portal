"use server";
// Inven(s)tory Analysis, Phase C: what the client does on the Analyze page, and
// For Granted's answer to a request.
//
// Every action checks the session itself, and a client only reaches any of them
// while the per-client switch ('analysis') is on for their account.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { getTenant, getFeatureVisible } from "./data";
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";
import { saveEligibilityProfileAction } from "./eligibility-actions";
import { analysedDocs } from "./analysis-client-read";
import { notifyAnalysisRequest } from "./notify";
import { deriveEligibility, type EligField } from "@/lib/analysis-derive";
import { openSuggestions, applySuggestion, suggestionKey, type SuggestionDecision } from "@/lib/analysis-client";

const PAGE = "/analysis";

async function clientOrAdmin() {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  if (s.role !== "admin" && !(await getFeatureVisible(s.tenantId, "analysis"))) {
    throw new Error("Inven(s)tory Analysis is not turned on for this account yet.");
  }
  return s;
}

async function currentOpen(tenantId: string) {
  const [{ docs }, profile, { data: decRows }] = await Promise.all([
    analysedDocs(tenantId),
    getEligibilityProfile(tenantId),
    db.from("analysis_suggestion_decision").select("field, value_key, decision").eq("tenant_id", tenantId),
  ]);
  const decisions: SuggestionDecision[] = ((decRows ?? []) as { field: string; value_key: string; decision: "confirmed" | "rejected" }[])
    .map(r => ({ field: r.field, valueKey: r.value_key, decision: r.decision }));
  return { profile, open: openSuggestions(deriveEligibility(docs, profile), decisions) };
}

/** Ask For Granted to run an analysis past the fair-use cap. One pending request at a time. */
export async function requestAnalysisAction(note?: string | null) {
  const s = await clientOrAdmin();
  const { data: pending } = await db.from("analysis_request").select("id")
    .eq("tenant_id", s.tenantId).eq("status", "pending").limit(1);
  if (pending?.length) return { ok: true, already: true };
  const clean = note?.trim() ? note.trim().slice(0, 1000) : null;
  const { error } = await db.from("analysis_request").insert({ tenant_id: s.tenantId, requested_by: s.user.id, note: clean });
  if (error) throw new Error(`Could not send the request: ${error.message}`);
  const tenant = await getTenant(s.tenantId);
  await notifyAnalysisRequest({ org: tenant?.name ?? "A client", requester: s.user.full_name ?? "A client user", note: clean });
  revalidatePath(PAGE);
  return { ok: true, already: false };
}

/**
 * Confirm or turn down one eligibility answer the analysis found. Confirming
 * saves it to the Funding Eligibility profile, through the profile's own save
 * (same checks, same audit line, matches refreshed). Only a value the analysis
 * is actually suggesting can be confirmed here.
 */
export async function decideSuggestionAction(field: string, value: string, decision: "confirmed" | "rejected") {
  const s = await clientOrAdmin();
  if (decision !== "confirmed" && decision !== "rejected") throw new Error("Choose confirm or not right.");
  const { profile, open } = await currentOpen(s.tenantId);
  const sug = open.find(x => x.field === field);
  const match = sug?.open.find(v => v.value === value);
  if (!sug || !match) throw new Error("That answer is no longer waiting. Reload the page to see what is.");
  const f = field as EligField;
  if (decision === "confirmed") {
    await saveEligibilityProfileAction(applySuggestion(profile, f, match.value));
  }
  const { error } = await db.from("analysis_suggestion_decision").upsert({
    tenant_id: s.tenantId, field: f, value_key: suggestionKey(f, match.value), decision,
    decided_by: s.user.id, decided_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,field,value_key" });
  if (error) throw new Error(`Could not record that: ${error.message}`);
  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: s.tenantId, action: "analysis_eligibility",
    detail: `${f}=${decision}`,
  });
  revalidatePath(PAGE);
}

/** "These answers are right": the client has been through every suggestion. */
export async function confirmEligibilityAction() {
  const s = await clientOrAdmin();
  const { open } = await currentOpen(s.tenantId);
  if (open.length) throw new Error(`${open.length} answer${open.length === 1 ? " is" : "s are"} still waiting for you above.`);
  const { error } = await db.from("analysis_client_state").upsert({
    tenant_id: s.tenantId, eligibility_confirmed_at: new Date().toISOString(), eligibility_confirmed_by: s.user.id,
  }, { onConflict: "tenant_id" });
  if (error) throw new Error(`Could not save that: ${error.message}`);
  revalidatePath(PAGE); revalidatePath("/funding-eligibility");
}

/**
 * For Granted's answer to a request. Approving lets one press through the cap;
 * the admin page then runs it straight away, so the client need not come back.
 */
export async function decideAnalysisRequestAction(id: string, approve: boolean) {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("For Granted only.");
  const { data, error } = await db.from("analysis_request").update({
    status: approve ? "approved" : "declined", decided_by: s.user.id, decided_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", id).eq("status", "pending").select("id");
  if (error) throw new Error(`Could not save that: ${error.message}`);
  if (!data?.length) throw new Error("That request has already been answered.");
  revalidatePath("/admin/analysis"); revalidatePath(PAGE);
}
