// Signal 1 of the matching pipeline: the eligibility hard filter, plus the
// query text the Ledger ranks against.
//
// Pure and free of `server-only` on purpose. This is the step that decides what
// an organization never sees, so it has to be unit-testable without a network
// or a database. The orchestration lives in lib/server/matching.ts.
import { ORG_TYPES, type EligibilityProfile } from "@/lib/eligibility-fields";
import type { GrantCard, RawGrantResult } from "@/lib/ledger-types";

/** "$500,000" -> 500000. Anything unparseable -> null, never NaN. */
export function parseMoney(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const digits = v.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * The Ledger puts prose in close_date ("no deadline listed", "rolling"). A
 * `date` column rejects that, which is how a whole match run silently failed
 * to save. Anything that isn't a real date becomes null, i.e. rolling.
 */
export function parseCloseDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : t.slice(0, 10);
}

/**
 * Federal programmes name their agency in the title, which is the only place a
 * real funder name reliably appears in a grant record. Everything else needs
 * the opportunity page fetched (see the enrichment stage in the fidelity spec).
 */
const AGENCY_IN_TITLE: [RegExp, string][] = [
  [/\bNHLBI\b/i, "NHLBI (NIH)"], [/\bNCI\b/i, "NCI (NIH)"], [/\bNIMH\b/i, "NIMH (NIH)"],
  [/\bNIDA\b/i, "NIDA (NIH)"], [/\bNIAAA\b/i, "NIAAA (NIH)"], [/\bNINDS\b/i, "NINDS (NIH)"],
  [/\bNIA\b/i, "NIA (NIH)"], [/\bNICHD\b/i, "NICHD (NIH)"], [/\bAHRQ\b/i, "AHRQ"],
  [/\bSAMHSA\b/i, "SAMHSA"], [/\bHRSA\b/i, "HRSA"], [/\bCDC\b/i, "CDC"],
  [/\bARPA-?H\b/i, "ARPA-H"], [/\bNSF\b|America'?s Seed Fund/i, "NSF"],
  [/\bNIH\b|\bR44\b|\bR43\b|\bR01\b|\bR18\b/i, "NIH"],
  [/\bDOE\b/i, "US Dept of Energy"], [/\bUSDA\b/i, "USDA"], [/\bEPA\b/i, "EPA"],
];

function funderFromTitle(title?: string): string | undefined {
  if (!title) return undefined;
  for (const [re, name] of AGENCY_IN_TITLE) if (re.test(title)) return name;
  return undefined;
}

/** Does this look like a scrape origin rather than an organisation's name? */
function looksLikeSite(v?: string): boolean {
  if (!v) return false;
  return /^https?:\/\//i.test(v) || /^www\./i.test(v) || /\.(org|com|gov|net|edu)\b/i.test(v);
}

/** Map the service's actual response onto the shape the screener expects. */
export function normalizeGrant(r: RawGrantResult): GrantCard {
  return {
    title: r.title,
    // The source link is the most stable identifier available; fall back to the
    // title so a card without a link still gets a usable key.
    opportunity_number: r.link || undefined,
    // r.source is the site the record was scraped from ("WWW.UAB.EDU/EYEDOC"),
    // not the funder. Showing it as the funder is worse than showing nothing:
    // "America's Seed Fund - NSF SBIR" is not funded by uab.edu. Resolve a real
    // agency from the title where we can, otherwise leave the funder unknown
    // until the opportunity page is fetched.
    agency: funderFromTitle(r.title) ?? (looksLikeSite(r.source) ? undefined : r.source),
    source_site: r.source,
    eligibility: r.eligibility_ai_extracted,
    close_date: parseCloseDate(r.close_date) ?? undefined,
    max_award: parseMoney(r.award_ceiling) ?? undefined,
    min_award: parseMoney(r.award_floor) ?? undefined,
    website: r.link,
    confidence: r.confidence as GrantCard["confidence"],
    caveat: r.caveat,
  };
}

export type Verdict = "eligible" | "likely" | "check";

export interface ScreenedGrant {
  grant_id: string; title: string; verdict: Verdict; reason: string;
  close_date: string | null; award_ceiling: number | null;
  funder?: string;              // who is distributing the money, when resolvable
  source_site?: string;         // where the record was listed. NOT the funder.
  website?: string; eligibility?: string; caveat?: string;
  rationale?: string;           // grounded "why this client fits", filled in later
  from_overlay?: boolean;
  verified_at?: string | null;  // when For Granted last confirmed this at the source
}

/**
 * The query text the Ledger ranks against.
 *
 * Two different questions, so two different texts:
 *   - GRANTS: what does this organization need funded? Describing *who they
 *     serve* here is what pulled back patient-assistance funds and scholarships
 *     for a healthtech company — the search faithfully found money for the
 *     beneficiaries rather than for the org.
 *   - FUNDERS: who a funder backs genuinely does depend on the population and
 *     cause, so beneficiaries belong in that one.
 */
export function needText(
  p: EligibilityProfile, orgName: string, purpose: "grants" | "funders" = "funders",
): string {
  const cause = p.cause_areas.length ? p.cause_areas.join(" and ") : "its mission";
  const geo = p.state_code ? ` based in ${p.state_code}` : "";

  if (purpose === "funders") {
    const orgType = ORG_TYPES.find(t => t.v === p.org_type)?.l ?? "organization";
    return [
      `${orgName}, a ${orgType.toLowerCase()}${geo}`,
      `working on ${cause}`,
      p.populations.length ? `serving ${p.populations.join(", ")}` : null,
      p.service_area.length ? `across ${p.service_area.join(", ")}` : null,
    ].filter(Boolean).join(" ");
  }

  // Grants: lead with the organization and the stage of funding it can use.
  const stage = STAGE_BY_BAND[p.budget_band ?? ""] ?? "";
  switch (p.org_type) {
    case "for_profit":
      return `${stage}${stage ? " " : ""}${cause} technology company${geo} `
        + `commercializing its product, seeking research, pilot, demonstration and `
        + `commercialization funding such as SBIR/STTR, innovation and translational awards`;
    case "government":
    case "tribal":
      return `a public agency${geo} seeking programme, capacity and infrastructure funding for ${cause}`;
    case "school":
      return `an educational institution${geo} seeking research, programme and capacity funding for ${cause}`;
    default:
      return `${stage}${stage ? " " : ""}nonprofit organization${geo} `
        + `seeking programme, operating, capacity-building and general support funding for its work on ${cause}`;
  }
}

/** How a funder would describe the organization's size, from the budget band. */
const STAGE_BY_BAND: Record<string, string> = {
  lt_100k: "an early-stage",
  "100k_500k": "a small",
  "500k_1m": "a growing",
  "1m_5m": "an established",
  "5m_10m": "a large",
  gt_10m: "a major",
};

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

// "federal" alone is a false-positive machine: "federal poverty level" appears
// in almost every assistance program's eligibility text, and flagged two Ohio
// family foundations as federal opportunities. Require a real federal marker.
const FEDERAL_HINT = /\b(grants\.gov|NOFO|CFDA|assistance listing|SAM\.gov|federal (grant|award|funding|agency|assistance)|HHS|SAMHSA|HRSA|NIH|NSF|DOJ|DOL|USDA|EPA|ARPA-H)\b/i;
const NONPROFIT_ONLY = /501\s*\(?c\)?\s*\(?3\)?|nonprofit organizations? only|tax-exempt organizations? only/i;
// Cost-share language varies a lot in real NOFOs: "25% cost match",
// "matching funds required", "non-federal share". Catch the common shapes.
const MATCH_REQUIRED = /\b(cost[ -]?(match|share)|match(ing)?[ -](funds?|requirement|share)|\d+\s*%\s*(cost[ -]?)?match|non-?federal\s+(match|share))\b/i;
// Language that affirmatively invites this kind of applicant. Distinct from the
// *_ONLY patterns above, which exclude: these are the phrases that let a match
// earn something better than "needs a check".
const INVITES: Record<string, RegExp> = {
  nonprofit_501c3: /\b(501\s*\(?c\)?\s*\(?3\)?|nonprofit organi[sz]ations?|not-for-profit|tax-exempt organi[sz]ations?|community-based organi[sz]ations?|faith-based)\b/i,
  for_profit: /\b(small business(es)?|for-profit|SBIR|STTR|start-?ups?|private compan(y|ies)|commercial entit(y|ies))\b/i,
  government: /\b(units? of local government|state agencies|governmental entities|municipalit(y|ies)|count(y|ies))\b/i,
  tribal: /\b(tribal (governments?|organi[sz]ations?|entities)|Alaska Native|Native Hawaiian)\b/i,
  school: /\b(institutions? of higher education|universit(y|ies)|colleges?|school districts?|local educational agenc)/i,
  fiscally_sponsored: /\bfiscal(ly)? sponsor/i,
};

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

  // Two separate ledgers: what stops this being actionable, and what makes it
  // look genuinely aligned. A blocker always wins.
  const blockers: string[] = [];
  const positives: string[] = [];

  const isNonprofit = p.org_type === "nonprofit_501c3" || p.tax_status === "501c3";
  if (NONPROFIT_ONLY.test(elig)) {
    if (isNonprofit) positives.push("restricted to 501(c)(3)s, which you are");
    else return null;                       // structurally impossible, not a "check"
  }
  if (GOV_ONLY.test(elig) && p.org_type !== "government" && p.org_type !== "tribal") return null;

  // Federal money needs SAM.gov + UEI. Not a disqualifier, but a real blocker
  // that should be visible before anyone starts writing.
  const looksFederal = FEDERAL_HINT.test(elig) || FEDERAL_HINT.test(g.agency ?? "");
  if (looksFederal && p.federal_registration !== "sam_uei_active") {
    blockers.push("federal opportunity and SAM.gov/UEI is not marked active");
  }

  // A match requirement the org cannot meet is worth surfacing early.
  if (p.match_capacity_pct === 0 && MATCH_REQUIRED.test(elig)) {
    blockers.push("appears to require a cost match; profile says none available");
  }

  // Affirmative signals. Each is weak alone; together they distinguish a lead
  // worth an hour from one worth a glance.
  const haystack = `${title} ${elig}`;
  const invite = p.org_type ? INVITES[p.org_type] : undefined;
  const invited = !!invite && invite.test(elig);
  if (invited) positives.push("eligibility text names your organization type");

  if (p.state_code && new RegExp(`\\b${p.state_code}\\b`).test(haystack)) {
    positives.push(`names ${p.state_code}`);
  }
  const cause = p.cause_areas.find(c => c.length > 3 && haystack.toLowerCase().includes(c.toLowerCase()));
  if (cause) positives.push(`cause overlap on ${cause}`);
  if (g.confidence === "strong") positives.push("strong alignment score from the Ledger");

  // eligible  = invited by name, with nothing blocking
  // likely    = nothing blocking and at least one real positive signal
  // check     = anything blocked, or nothing to go on but topical similarity
  let verdict: Verdict;
  if (blockers.length) verdict = "check";
  else if (invited) verdict = "eligible";
  else if (positives.length) verdict = "likely";
  else verdict = "check";

  const reasons = [...blockers, ...positives];
  if (!reasons.length) reasons.push("topical alignment only; eligibility text needs a human read");

  return {
    grant_id: id, title, verdict, reason: reasons.join("; "),
    close_date: g.close_date ?? null, award_ceiling: ceiling,
    funder: g.agency, source_site: g.source_site,
    website: g.website, eligibility: elig || undefined, caveat: g.caveat,
  };
}



/**
 * Make grant_id unique within one run.
 *
 * grant_id is the source link, because links are stable across runs in a way
 * that titles are not. But several distinct programmes often live on one
 * landing page, so a single run can produce the same link twice. Postgres
 * rejects a whole upsert batch that touches the same key twice ("ON CONFLICT
 * DO UPDATE command cannot affect row a second time"), which lost every match
 * in the run, not just the duplicate.
 *
 * So: drop rows that are genuinely the same opportunity (same link AND same
 * title), and keep the rest by qualifying the id with a slug of the title.
 * Two real programmes sharing a page both survive.
 */
export function dedupeScreened(list: ScreenedGrant[]): ScreenedGrant[] {
  const seenExact = new Set<string>();
  const usedIds = new Set<string>();
  const out: ScreenedGrant[] = [];

  for (const g of list) {
    const exact = `${g.grant_id}\u0000${g.title}`;
    if (seenExact.has(exact)) continue;          // same link, same title: one opportunity
    seenExact.add(exact);

    let id = g.grant_id;
    if (usedIds.has(id)) {
      const slug = g.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      id = `${g.grant_id}#${slug || usedIds.size}`;
      // Pathological case: same link, same slug, different title. Fall back to
      // a counter so the run still saves rather than failing outright.
      let n = 2;
      while (usedIds.has(id)) id = `${g.grant_id}#${slug}-${n++}`;
    }
    usedIds.add(id);
    out.push(id === g.grant_id ? g : { ...g, grant_id: id });
  }
  return out;
}
