import "server-only";
// Reading the RFP Engine switch and a client's government readiness (patch 53,
// 16 Nov 2026). Rules: lib/gov-readiness.ts. Writes: gov-readiness-actions.ts.
import { db } from "./db";
import { RFP_ENGINE_KEY, parseGovAnswers, type GovAnswers } from "@/lib/gov-readiness";

/**
 * Is the RFP Engine on for this client? Off unless For Granted turned it on.
 *
 * Read straight from feature_visibility, by tenant, rather than through
 * getFeatureVisible: that helper resolves only the keys registered as sidebar
 * features in lib/workspace.ts, and this switch is not a page. The service
 * client is used so the weekly cron (no session) can ask the same question.
 */
export async function rfpEngineOn(tenantId: string): Promise<boolean> {
  const { data, error } = await db.from("feature_visibility").select("visible")
    .eq("tenant_id", tenantId).eq("feature_key", RFP_ENGINE_KEY).maybeSingle();
  if (error) { console.error("[rfp-engine] switch not read", error.message); return false; }
  return (data as { visible: boolean } | null)?.visible === true;
}

export interface GovReadiness {
  /** False before migration 0094 is applied: the page then shows neither the question nor the section. */
  available: boolean;
  interest: "yes" | "no" | null;
  answers: GovAnswers;
  updatedAt: string | null;
}

export async function getGovReadiness(tenantId: string): Promise<GovReadiness> {
  const { data, error } = await db.from("gov_readiness").select("interest, answers, updated_at")
    .eq("tenant_id", tenantId).maybeSingle();
  if (error) { console.error("[gov-readiness] not read", error.message); return { available: false, interest: null, answers: {}, updatedAt: null }; }
  const row = data as { interest: string | null; answers: unknown; updated_at: string | null } | null;
  return {
    available: true,
    interest: row?.interest === "yes" || row?.interest === "no" ? row.interest : null,
    answers: parseGovAnswers(row?.answers),
    updatedAt: row?.updated_at ?? null,
  };
}
