// Signal 1 of the matching pipeline: the eligibility hard filter, plus the
// query text the Ledger ranks against.
//
// Pure and free of `server-only` on purpose. This is the step that decides what
// an organization never sees, so it has to be unit-testable without a network
// or a database. The orchestration lives in lib/server/matching.ts.
import { ORG_TYPES, type EligibilityProfile } from "@/lib/eligibility-fields";
import type { GrantCard } from "@/lib/ledger-types";

export type Verdict = "eligible" | "likely" | "check";

export interface ScreenedGrant {
  grant_id: string; title: string; verdict: Verdict; reason: string;
  close_date: string | null; award_ceiling: number | null;
  website?: string; eligibility?: string; caveat?: string;
  from_overlay?: boolean;
}

/** Plain-English description of the org, used as the Ledger's query text. */
export function needText(p: EligibilityProfile, orgName: string): string {
  const orgType = ORG_TYPES.find(t => t.v === p.org_type)?.l ?? "organization";
  const bits = [
    `${orgName}, a ${orgType.toLowerCase()}`,
    p.state_code ? `based in ${p.state_code}` : null,
    p.cause_areas.length ? `working on ${p.cause_areas.join(", ")}` : null,
    p.populations.length ? `serving ${p.populations.join(", ")}` : null,
    p.service_area.length ? `across ${p.service_area.join(", ")}` : null,
  ].filter(Boolean);
  return bits.join(" ");
}

/** Rough dollar figure to aim funder search at, from the budget band. */
export function typicalGrantSize(band: string | null): number | undefined {
  switch (band) {
    case "lt_100k": return 10_000;
    case "100k_500k": return 25_000;
    case "500k_1m": return 50_000;
    case "1m_5m": return 100_000;
    case "5m_10m": return 250_000;
    case "gt_10m": return 500_000;
    default: return undefined;
  }
}

const FEDERAL_HINT = /\b(federal|grants\.gov|NOFO|CFDA|assistance listing|HHS|SAMHSA|HRSA|NIH|DOJ|DOL|USDA|EPA)\b/i;
const NONPROFIT_ONLY = /501\s*\(?c\)?\s*\(?3\)?|nonprofit organizations? only|tax-exempt organizations? only/i;
// Cost-share language varies a lot in real NOFOs: "25% cost match",
// "matching funds required", "non-federal share". Catch the common shapes.
const MATCH_REQUIRED = /\b(cost[ -]?(match|share)|match(ing)?[ -](funds?|requirement|share)|\d+\s*%\s*(cost[ -]?)?match|non-?federal\s+(match|share))\b/i;
const GOV_ONLY = /\b(units? of local government|state agencies only|governmental entities only|tribal governments only)\b/i;

/**
 * Signal 1. What the rules can actually decide, and nothing more.
 *
 * Returns null to DROP the opportunity outright (closed, or structurally
 * impossible). Otherwise a verdict: "eligible" only when a rule affirmatively
 * matched, "check" whenever the honest answer is that a human must read it.
 */
export function screenGrant(g: GrantCard, p: EligibilityProfile, today = new Date()): ScreenedGrant | null {
  const title = g.title ?? g.name ?? g.opportunity_number ?? "Untitled opportunity";
  const id = g.opportunity_number ?? `${title}`.slice(0, 120);
  const elig = g.eligibility ?? "";
  const ceiling = g.max_award ?? g.award_ceiling ?? null;

  // Closed is closed. Rolling opportunities carry no close_date and survive.
  if (g.close_date) {
    const d = new Date(g.close_date);
    if (!isNaN(d.getTime()) && d < today) return null;
  }

  const reasons: string[] = [];
  let verdict: Verdict = "check";

  const isNonprofit = p.org_type === "nonprofit_501c3" || p.tax_status === "501c3";
  if (NONPROFIT_ONLY.test(elig)) {
    if (isNonprofit) { verdict = "eligible"; reasons.push("restricted to 501(c)(3)s, which you are"); }
    else return null;                       // structurally impossible, not a "check"
  }
  if (GOV_ONLY.test(elig) && p.org_type !== "government" && p.org_type !== "tribal") return null;

  // Federal money needs SAM.gov + UEI. Not a disqualifier, but a real blocker
  // that should be visible before anyone starts writing.
  const looksFederal = FEDERAL_HINT.test(elig) || FEDERAL_HINT.test(g.agency ?? "");
  if (looksFederal && p.federal_registration !== "sam_uei_active") {
    verdict = "check";
    reasons.push("federal opportunity and SAM.gov/UEI is not marked active");
  }

  // A match requirement the org cannot meet is worth surfacing early.
  if (p.match_capacity_pct === 0 && MATCH_REQUIRED.test(elig)) {
    verdict = "check";
    reasons.push("appears to require a cost match; profile says none available");
  }

  if (!reasons.length) {
    reasons.push(g.match_reason ?? "aligned on cause and profile; eligibility text needs a human read");
  }

  return {
    grant_id: id, title, verdict, reason: reasons.join("; "),
    close_date: g.close_date ?? null, award_ceiling: ceiling,
    website: g.website, eligibility: elig || undefined, caveat: g.caveat,
  };
}

