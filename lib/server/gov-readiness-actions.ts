"use server";
// The RFP Engine switch, the interest question and the six gates (patch 53,
// 16 Nov 2026). Every action returns { ok: false, error } rather than throwing,
// because production hides a thrown reason.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { getTenant } from "./data";
import { tenantIsBrain } from "./brain";
import { notifyClientRequest } from "./notify";
import { resolveBySource } from "./requests";
import { rfpEngineOn, getGovReadiness } from "./gov-readiness";
import { RFP_ENGINE_KEY, cleanGovInput, type GovInput, type GovAnswers } from "@/lib/gov-readiness";

type Result = { ok: true } | { ok: false; error: string };
/** The Requests inbox row a client's "yes" raises; closed when the switch goes on or the answer changes. */
const INTEREST_SOURCE = "gov_interest";

/**
 * For Granted only: turn the RFP Engine on or off for one client. Turning it on
 * is a scope-of-engagement decision, so nothing else in the portal ever does it.
 */
export async function setRfpEngineAction(tenantId: string, on: boolean): Promise<Result> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "Only For Granted can change this." };
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { ok: false, error: "That client could not be found." };
  if (await tenantIsBrain(tenantId)) return { ok: false, error: "The Brain is not a client, so it has no RFP Engine." };
  const { error } = await db.from("feature_visibility").upsert({
    tenant_id: tenantId, feature_key: RFP_ENGINE_KEY, visible: !!on, updated_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,feature_key" });
  if (error) return { ok: false, error: "Could not save the switch." };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: "feature_visibility", detail: `${RFP_ENGINE_KEY}=${on ? "visible" : "hidden"}` });
  if (on) await resolveBySource(tenantId, INTEREST_SOURCE, "RFP Engine turned on for this client.");
  revalidatePath(`/admin/clients/${tenantId}`); revalidatePath("/funding-eligibility");
  return { ok: true };
}

/**
 * The interest question on Funding Eligibility. A client's yes tells For
 * Granted (Requests inbox, email, Slack) and turns nothing on.
 */
export async function answerGovInterestAction(answer: "yes" | "no"): Promise<Result> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  if (answer !== "yes" && answer !== "no") return { ok: false, error: "Choose yes or no." };
  const before = await getGovReadiness(s.tenantId);
  if (!before.available) return { ok: false, error: "That could not be saved yet. Please tell your For Granted team." };
  const now = new Date().toISOString();
  const { error } = await db.from("gov_readiness").upsert({
    tenant_id: s.tenantId, interest: answer, interest_by: s.user.id, interest_at: now, updated_by: s.user.id, updated_at: now,
  }, { onConflict: "tenant_id" });
  if (error) { console.error("[gov-readiness] interest not saved", error.message); return { ok: false, error: "Your answer could not be saved. Please try again." }; }
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "gov_interest", detail: `interest=${answer}` });

  // Only a client's own answer is news to For Granted, and only when it changed.
  if (s.role === "client" && before.interest !== answer) {
    if (answer === "yes" && !(await rfpEngineOn(s.tenantId))) {
      const tenant = await getTenant(s.tenantId).catch(() => null);
      await notifyClientRequest({
        org: tenant?.name ?? "A client", requester: s.user.full_name ?? s.user.email ?? "A teammate",
        what: "said they sell, or want to sell, to government buyers. Nothing was turned on: decide whether government RFPs are in scope, then switch the RFP Engine on from their client page.",
        tenantId: s.tenantId, inbox: { kind: "gov_interest", sourceKey: INTEREST_SOURCE },
      }).catch(e => console.error("[gov-readiness] notify failed", e));
    } else if (answer === "no") {
      await resolveBySource(s.tenantId, INTEREST_SOURCE, "The client changed their answer to no.");
    }
  }
  revalidatePath("/funding-eligibility"); revalidatePath(`/admin/clients/${s.tenantId}`);
  return { ok: true };
}

/**
 * Save the six gates. Open to the client, and to For Granted while viewing the
 * client (each changed answer is stamped with whoever saved it). Refused while
 * the RFP Engine is off: the section is not on the page then.
 */
export async function saveGovReadinessAction(input: GovInput): Promise<{ ok: true; answers: GovAnswers; problems: string[] } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  if (!(await rfpEngineOn(s.tenantId))) return { ok: false, error: "Government readiness is not switched on for this account." };
  const before = await getGovReadiness(s.tenantId);
  if (!before.available) return { ok: false, error: "Your answers could not be saved yet. Please tell your For Granted team." };
  const { answers, problems, changed } = cleanGovInput(input, before.answers, { by: s.user.id, role: s.role === "admin" ? "admin" : "client" });
  if (changed.length === 0) return { ok: true, answers, problems };
  const now = new Date().toISOString();
  const { error } = await db.from("gov_readiness").upsert({
    tenant_id: s.tenantId, answers, updated_by: s.user.id, updated_at: now,
  }, { onConflict: "tenant_id" });
  if (error) { console.error("[gov-readiness] save refused", error.message); return { ok: false, error: "Your answers could not be saved. Please try again, or tell your For Granted team." }; }
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "gov_readiness_save", detail: `gates changed: ${changed.join(", ")}` });
  revalidatePath("/funding-eligibility"); revalidatePath(`/admin/clients/${s.tenantId}`);
  return { ok: true, answers, problems };
}
