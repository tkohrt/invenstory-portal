import "server-only";
// Funder matching: eligibility filter -> alignment rank -> evidence boost.
//
// The pipeline from the architecture doc, in that order:
//   1. ELIGIBILITY (hard filter, rules not fingerprints) — drop what the org
//      cannot win. This exclusion is the value competitors skip.
//   2. ALIGNMENT (soft rank, fingerprints) — done inside the Ledger, which
//      embeds our query text with its own model and ranks against its own
//      vectors. The portal never reconciles two embedding spaces.
//   3. EVIDENCE (graph boost) — funders already funding orgs like this one.
//
// Everything the Ledger returns is a June 2026 lead, never a fact. Verdicts
// below say "check" whenever the rules cannot honestly say more.
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";
import { getApprovedOverlay, mergeOverlay } from "./ledger-overlay";
import {
  findGrants, findFunders, fundersLikeMine, ledgerConfigured, LedgerUnavailable,
} from "./ledger";
import type { GrantCard, FunderCard, RawGrantResult } from "@/lib/ledger-types";
// Signal 1 is pure and lives outside server-only so it can be unit tested.
import { screenGrant, needText, typicalGrantSize, normalizeGrant } from "@/lib/grant-screen";
import type { Verdict, ScreenedGrant } from "@/lib/grant-screen";
export { screenGrant, needText } from "@/lib/grant-screen";
export type { Verdict, ScreenedGrant } from "@/lib/grant-screen";

export interface MatchRun {
  grants: ScreenedGrant[];
  funders: FunderCard[];
  evidence: FunderCard[];
  dropped: number;
  note?: string;
  ranAt: string;
}

/**
 * Run the full pipeline for one tenant and cache the grant verdicts.
 *
 * Overlay is merged over the Ledger's grant results before screening, so an FG
 * correction (a moved deadline, a fixed eligibility line) drives the verdict
 * rather than the stale June 2026 record.
 */
export async function runMatch(tenantId: string, orgName: string): Promise<MatchRun> {
  if (!ledgerConfigured()) throw new LedgerUnavailable("The Funder Ledger service is not configured yet.");

  const p = await getEligibilityProfile(tenantId);
  if (!p.org_type || !p.cause_areas.length) {
    throw new Error("Fill in at least the organization type and one cause area before matching.");
  }

  const need = needText(p, orgName);
  const size = typicalGrantSize(p.budget_band);

  const [grantsEnv, fundersEnv, evidenceEnv, overlay] = await Promise.all([
    findGrants({ need }),
    findFunders({ need, location: p.state_code ?? undefined, grant_size: size }),
    fundersLikeMine({ org_description: need, location: p.state_code ?? undefined }),
    getApprovedOverlay("grant"),
  ]);

  // The service's response shape differs from the published spec (prose in
  // close_date, "$500,000" strings for amounts, eligibility under a different
  // key). Normalize first, or the screener reads nothing and the DB rejects
  // the write.
  const normalized = (grantsEnv.results as unknown as RawGrantResult[]).map(normalizeGrant);

  // Merge FG corrections over the frozen base before anything is judged.
  const withIds = normalized.map(g => ({
    ...g, id: g.opportunity_number ?? g.title ?? Math.random().toString(36).slice(2),
  }));
  const merged = mergeOverlay(withIds, overlay);

  const screened: ScreenedGrant[] = [];
  let dropped = 0;
  for (const rec of merged) {
    const s = screenGrant(rec as unknown as GrantCard, p);
    if (!s) { dropped += 1; continue; }
    if (rec._overlay) s.from_overlay = true;
    screened.push(s);
  }

  // Sort by how confidently we can act: eligible, then likely, then check;
  // soonest deadline first inside each band, rolling last.
  const rank: Record<Verdict, number> = { eligible: 0, likely: 1, check: 2 };
  screened.sort((a, b) =>
    rank[a.verdict] - rank[b.verdict] ||
    (a.close_date ?? "9999").localeCompare(b.close_date ?? "9999"));

  const ranAt = new Date().toISOString();

  if (screened.length) {
    const { error } = await db.from("eligible_grant").upsert(
      screened.map(s => ({
        tenant_id: tenantId, grant_id: s.grant_id.slice(0, 400), verdict: s.verdict,
        reason: s.reason.slice(0, 500), close_date: s.close_date,
        award_ceiling: s.award_ceiling, matched_at: ranAt,
      })),
      { onConflict: "tenant_id,grant_id" });
    // Never report a successful run over a rejected write. The first version of
    // this swallowed the error and cheerfully claimed "15 opportunities kept"
    // while the table stayed empty.
    if (error) throw new Error(`Matching ran but could not be saved: ${error.message}`);
  }

  return {
    grants: screened, funders: fundersEnv.results, evidence: evidenceEnv.results,
    dropped, note: grantsEnv.note, ranAt,
  };
}

/** Cached verdicts from the last run, for rendering without hitting the Ledger. */
export async function getCachedMatches(tenantId: string) {
  const { data } = await db.from("eligible_grant")
    .select("*").eq("tenant_id", tenantId).order("close_date", { ascending: true, nullsFirst: false });
  return (data ?? []) as {
    grant_id: string; verdict: Verdict; reason: string | null;
    close_date: string | null; award_ceiling: number | null; matched_at: string;
  }[];
}

