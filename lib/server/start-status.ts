import "server-only";
import { userClient } from "./supabase";
import { getGaps } from "./eligibility";
import { startSteps, type StartStep } from "@/lib/living-voice";

/**
 * P1.5 (patch 38): the Getting Started card left the Inven(s)tory page and
 * became a slim banner the Shell shows on every page until setup is done or
 * hidden. This computes the banner's facts once per page view, and the same
 * read answers whether the Funding tools are unlocked (eligibility answered
 * and a readiness check run), so the layout pays for one helper, not two.
 */
export interface StartStatus {
  steps: StartStep[];
  outstanding: number;
  /** Funding tools open when the critical eligibility answers are in and a readiness check has run. */
  fundingUnlocked: boolean;
}

export async function getStartStatus(tenantId: string): Promise<StartStatus | null> {
  try {
    const s = await userClient();
    const [gapData, docsRes] = await Promise.all([
      getGaps(tenantId),
      s.from("document").select("layer").eq("tenant_id", tenantId),
    ]);
    const docs = (docsRes.data ?? []) as { layer: string }[];
    const criticalGaps = gapData.gaps.filter(g => g.tier === "critical").length;
    const readinessRun = !!gapData.computedAt;
    const steps = startSteps({
      criticalGaps,
      layerCounts: {
        I: docs.filter(d => d.layer === "I").length,
        II: docs.filter(d => d.layer === "II").length,
        III: docs.filter(d => d.layer === "III").length,
      },
      readinessRun,
    });
    return {
      steps,
      outstanding: steps.filter(x => !x.done).length,
      fundingUnlocked: criticalGaps === 0 && readinessRun,
    };
  } catch {
    // Best-effort: a failed read never breaks the layout. No banner, no lock.
    return null;
  }
}
