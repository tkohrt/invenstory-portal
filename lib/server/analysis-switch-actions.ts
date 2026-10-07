"use server";
// Inven(s)tory Analysis, Phase D: For Granted switching the client being viewed
// over to the analysis, or back. Admin only. EVERY export of a "use server"
// module is a public endpoint, so none of these take a tenant id: the tenant
// comes from the session.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { getAnalysisTrial } from "./analysis-read";
import { getAnalysisComparison } from "./analysis-compare";
import { switchOn, switchOff, switchStatus, previewSwitch } from "./analysis-switch";
import { switchGate, PROVING_TENANT_ID, type GateInput, type GateResult } from "@/lib/analysis-switch";

async function adminSession() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("For Granted only.");
  return s;
}

/** The gate for this client, worked out live. Shared by the page and the action, so they cannot disagree. */
export async function switchGateFor(tenantId: string): Promise<GateResult & { input: GateInput }> {
  const s = await adminSession();
  if (s.tenantId !== tenantId) throw new Error("Switch to that client first.");
  const [status, preview] = await Promise.all([switchStatus(tenantId), previewSwitch(tenantId)]);
  const input: GateInput = {
    tenantId, pendingDocs: preview.pendingDocs, analysedDocs: preview.analysedDocs, proofAt: status.proofAt,
  };
  if (tenantId === PROVING_TENANT_ID) {
    const [trial, compare] = await Promise.all([
      getAnalysisTrial(tenantId).catch(() => null),
      getAnalysisComparison(tenantId).catch(() => null),
    ]);
    if (trial) input.review = { passes: trial.tally.passes, reviewed: trial.tally.reviewed, target: trial.tally.target, supportedPct: trial.tally.supportedPct };
    if (compare) input.compare = compare.readiness.gate;
  }
  return { ...switchGate(input), input };
}

const PATHS = ["/admin/analysis", "/invenstory", "/funding-eligibility", "/analysis", "/story-cards", "/admin/card-library", "/funder-matches"];

/** Switch the client being viewed to the analysis. Checked on the server, whatever the page shows. */
export async function switchToAnalysisAction() {
  const s = await adminSession();
  const status = await switchStatus(s.tenantId);
  if (status.switchedAt) return { ok: true as const, already: true, text: "Already on the analysis." };
  const gate = await switchGateFor(s.tenantId);
  // Returned, not thrown: in production Next.js hides a thrown action's message.
  if (!gate.allowed) return { ok: false as const, error: gate.reasons.join(" ") };
  const snapshot = s.tenantId === PROVING_TENANT_ID
    ? { review: gate.input.review ?? null, compare: gate.input.compare ?? null, at: new Date().toISOString(), by: s.user.id }
    : null;
  const r = await switchOn(s.tenantId, s.user.id, snapshot);
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "analysis_switch_on", detail: r.text.slice(0, 500) });
  for (const p of PATHS) revalidatePath(p);
  return { ok: true as const, already: false, text: r.text };
}

/** Back to the old reads, exactly as they were before the switch. */
export async function switchBackAction() {
  const s = await adminSession();
  const m = await switchOff(s.tenantId);
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "analysis_switch_off", detail: `${m.cards} live cards` });
  for (const p of PATHS) revalidatePath(p);
  return { ok: true as const };
}
