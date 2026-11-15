// Signal 1 of the matching pipeline: the eligibility hard filter, plus the
// query text the Ledger ranks against.
//
// Pure and free of `server-only` on purpose. This is the step that decides what
// an organization never sees, so it has to be unit-testable without a network
// or a database. The orchestration lives in lib/server/matching.ts.
import { ORG_TYPES, homeLabel, reachLabels, isUsBased, type EligibilityProfile } from "@/lib/eligibility-fields";
import { countryNames, regionNames, textNames, COUNTRY_NAME } from "@/lib/countries";
import { statesNamed } from "@/lib/us-states";
import { isAbroad, hasUsEntity, hasUsSponsor, outsideRestriction, US_ONLY, BEYOND_US } from "@/lib/place-gate";
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

export type Verdict = "eligible" | "likely" | "check" | "watch";

export interface ScreenedGrant {
  grant_id: string; title: string; verdict: Verdict; reason: string;
  close_date: string | null; award_ceiling: number | null;
  funder?: string;              // who is distributing the money, when resolvable
  source_site?: string;         // where the record was listed. NOT the funder.
  website?: string; eligibility?: string; caveat?: string;
  rationale?: string;           // grounded "why this client fits", filled in later
  /** llm = real; rule = deliberately rule-based and final; pending = not reached
   *  yet, because the run ran out of time. Only pending is worth resuming. */
  rationale_source?: "llm" | "rule" | "pending";
  from_overlay?: boolean;
  verified_at?: string | null;  // when For Granted last confirmed this at the source
  /** grants | contracts | programs (patch 4; investment removed 9 Nov 2026). Ground Truth rows are grants. */
  money_kind?: string;
  /** ISO currency of award_ceiling when it is not US dollars (EU calls are in euros). */
  currency?: string | null;
  /** ledger | worldbank | eu_ft (lib/open-data.ts SOURCE_LABEL). */
  source?: string;
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
  const home = homeLabel(p);
  const geo = home ? ` based in ${home}` : "";

  if (purpose === "funders") {
    const orgType = ORG_TYPES.find(t => t.v === p.org_type)?.l ?? "organization";
    return [
      `${orgName}, a ${orgType.toLowerCase()}${geo}`,
      `working on ${cause}`,
      p.populations.length ? `serving ${p.populations.join(", ")}` : null,
      reachLabels(p).length ? `across ${reachLabels(p).join(", ")}` : null,
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

// The international screen (patch 47). Outside the US a nonprofit is an NGO,
// a charity or a civil society organisation, and "501(c)(3)" in a call's text
// is a requirement it does not meet, never a sign it is invited.
const C3 = /501\s*\(?c\)?\s*\(?3\)?/i;
const NGO_INVITE = /\b(nonprofit organi[sz]ations?|non-profit organi[sz]ations?|not-for-profit|NGOs?|non-governmental organi[sz]ations?|civil society organi[sz]ations?|CSOs?|community-based organi[sz]ations?|CBOs?|charit(y|ies)|faith-based)\b/i;
const ENTERPRISE_INVITE = /\b(SMEs?|small and medium[- ]sized enterprises?|social enterprises?)\b/i;

const GOV_ONLY = /\b(units? of local government|state agencies only|governmental entities only|tribal governments only)\b/i;

// ---- The hardened screen's patterns (patch 44). Conservative on purpose:
// every one grows against the screen_miss corpus, never against guesses. ----
const INDIVIDUALS_ONLY = /\b(open (only )?to individuals\b|individuals? only\b|individual (artists|applicants|researchers|fellows|writers|scholars)\b|must be an individual\b|scholarships? (are )?for (students|individuals)\b)/i;
const GRANTEES_ONLY = /\b((current|existing|previous|past) grantees only|open (only )?to (current|existing|returning) grantees|renewal applications? only|by invitation only|invited applicants only)\b/i;
const GEO_RESTRICT = /\b(based in|located in|headquartered in|organizations? (in|within|of)|serving (residents of|communities (in|of)|the people of)|must (be|operate) (in|within)|within the state of|operating (in|within)|work(ing)? in|residents? of)\b/i;
const GEO_SOFT = /\b(priorit(y|ies|ize)|preference|preferred|primarily|especially|particular (interest|focus)|emphasis)\b/i;
const COUNTY_RE = /\b([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?) [Cc]ount(?:y|ies)\b/;
const BUDGET_MIN = /(?:annual |operating )?budgets? (?:of )?(?:at least|above|over|exceeding|greater than|no less than) \$?([\d,.]+)\s*(k|m|thousand|million)?/i;
const BUDGET_MAX = /(?:annual |operating )?budgets? (?:of )?(?:under|below|less than|not (?:to )?exceed(?:ing)?|up to|smaller than|no more than) \$?([\d,.]+)\s*(k|m|thousand|million)?/i;
const AUDIT_REQ = /\b(audited financial statements?|most recent (financial )?audit|independent audit)\b/i;
const MUST_SERVE = /\bmust (?:primarily |principally |exclusively )?serve\b|\bexclusively serv(?:e|ing)\b|\bprimarily serv(?:e|ing)\b/i;
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

/** The dollar figure a budget rule names, or null. */
function moneyAfter(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1].replace(/[,]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const mul = unit === "m" || unit === "million" ? 1_000_000 : unit === "k" || unit === "thousand" ? 1_000 : 1;
  return Math.round(n * mul);
}

/** "at least three years of operating history" -> 3, or null. */
function yearsRequired(text: string): number | null {
  const m = text.match(/\b(?:at least|minimum of|more than|a minimum) (\w+|\d+)\s*(?:\(\d+\)\s*)?(?:full |fiscal |consecutive )?years?(?: of)? (?:operating|operations?|existence|history|incorporation|being incorporated|in business|programming)\b/i)
    ?? text.match(/\boperating for (?:at least )?(\w+|\d+) years?\b/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const n = /^\d+$/.test(raw) ? Number(raw) : WORD_NUM[raw] ?? null;
  return n && n > 0 && n < 30 ? n : null;
}

/** The band's dollar range (patch 44), for budget floor/ceiling rules. */
const BAND_RANGE: Record<string, [number, number]> = {
  lt_100k: [0, 100_000], "100k_500k": [100_000, 500_000], "500k_1m": [500_000, 1_000_000],
  "1m_5m": [1_000_000, 5_000_000], "5m_10m": [5_000_000, 10_000_000], gt_10m: [10_000_000, Infinity],
};

/**
 * The one identifier a grant has, assigned once and used everywhere.
 *
 * Three things must agree or Ground Truth silently stops working: the key
 * mergeOverlay matches a correction against, the `grant_id` cached in
 * eligible_grant, and the `base_id` the review picker writes. They did not.
 * The merge keyed on the raw link while the cached row held a link qualified
 * by title slug and truncated to 400 characters, so a correction filed against
 * a real opportunity matched nothing, was neither applied nor appended, and
 * disappeared without an error.
 *
 * So ids are assigned here, before the merge, and carried through screening
 * and storage unchanged.
 *
 * The link is the base, because links are stable across runs in a way titles
 * are not. Truncation happens HERE rather than at the database, so the id that
 * is stored is byte-for-byte the id that was merged against.
 */
export const GRANT_ID_MAX = 400;

export function baseGrantId(g: { opportunity_number?: string; title?: string; name?: string }): string {
  const raw = g.opportunity_number || g.title || g.name || "untitled-opportunity";
  return raw.slice(0, GRANT_ID_MAX);
}

/**
 * Make ids unique within one run.
 *
 * Several distinct programmes often live on one landing page. Postgres rejects
 * a whole upsert batch that touches the same key twice, which once lost every
 * match in a run rather than just the duplicate — and a shared id would also
 * mean a correction to one programme silently editing its neighbour.
 *
 * Rows that are genuinely the same opportunity (same link AND same title) are
 * dropped; the rest are qualified with a slug of the title.
 */
export function qualifyGrantIds<T extends { opportunity_number?: string; title?: string; name?: string }>(
  list: T[],
): (T & { id: string })[] {
  const seenExact = new Set<string>();
  const usedIds = new Set<string>();
  const out: (T & { id: string })[] = [];

  for (const g of list) {
    const base = baseGrantId(g);
    const title = g.title ?? g.name ?? "";
    const exact = `${base}\u0000${title}`;
    if (seenExact.has(exact)) continue;
    seenExact.add(exact);

    let id = base;
    if (usedIds.has(id)) {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      // Truncation can make the qualified id identical to the base, which
      // would spin here forever. Shorten the base instead so the suffix always
      // survives, and give up after a bounded number of tries rather than
      // hanging a run.
      const room = Math.max(0, GRANT_ID_MAX - (slug.length + 12));
      const stem = base.slice(0, room) || base.slice(0, GRANT_ID_MAX - 12);
      id = `${stem}#${slug || usedIds.size}`;
      let n = 2;
      while (usedIds.has(id) && n < 500) id = `${stem}#${slug}-${n++}`;
    }
    usedIds.add(id);
    out.push({ ...g, id });
  }
  return out;
}

/**
 * Signal 1. What the rules can actually decide, and nothing more.
 *
 * Returns null to DROP the opportunity outright (closed, or structurally
 * impossible). Otherwise a verdict: "eligible" only when a rule affirmatively
 * matched, "check" whenever the honest answer is that a human must read it.
 *
 * The Watchlist (patch 26): with allowClosed, a closed call is no longer
 * dropped outright. It runs the full screen, and only if nothing blocks it
 * does it come back as "watch": the last cycle has closed but the fit is
 * real, so it is worth watching for the next one. Closed AND blocked is
 * still null; a lead that needs a caveat before it is even open is not a
 * lead worth a client's watchlist.
 */
export function screenGrant(
  g: GrantCard, p: EligibilityProfile, today = new Date(),
  opts?: { allowClosed?: boolean; /** For Granted reviewed this record (curated lists): never dropped by the US database default. */ reviewed?: boolean },
): ScreenedGrant | null {
  const title = g.title ?? g.name ?? g.opportunity_number ?? "Untitled opportunity";
  // The id is assigned once by qualifyGrantIds, before the merge, and must not
  // be recomputed here — a second opinion about a record's identity is exactly
  // how the merge key and the stored key drifted apart.
  const id = (g as { id?: string }).id ?? baseGrantId(g);
  const elig = g.eligibility ?? "";
  const ceiling = g.max_award ?? g.award_ceiling ?? null;

  // Closed is closed. Rolling opportunities carry no close_date and survive.
  // Under allowClosed a closed call is remembered and screened anyway: it can
  // still earn a place on the watchlist below, but never among open calls.
  let closed = false;
  if (g.close_date) {
    const d = new Date(g.close_date);
    if (!isNaN(d.getTime()) && d < today) {
      if (!opts?.allowClosed) return null;
      closed = true;
    }
  }

  // Two separate ledgers: what stops this being actionable, and what makes it
  // look genuinely aligned. A blocker always wins.
  const blockers: string[] = [];
  const positives: string[] = [];

  // Where the client stands (patch 47). Registered abroad, the tax status is
  // the only thing that makes an organization a 501(c)(3): the form's one
  // nonprofit choice is labelled "501(c)(3)", and a Kenyan NGO that picks it
  // is not one. Registered in the US, nothing changes.
  const abroad = isAbroad(p);
  const usEntity = hasUsEntity(p);
  const usSponsor = hasUsSponsor(p);
  const home = abroad ? (COUNTRY_NAME[p.country_code as string] ?? "another country") : null;
  const isNonprofit = abroad ? p.tax_status === "501c3" : (p.org_type === "nonprofit_501c3" || p.tax_status === "501c3");
  if (NONPROFIT_ONLY.test(elig)) {
    if (isNonprofit) positives.push("restricted to 501(c)(3)s, which you are");
    else if (abroad && !C3.test(elig) && p.org_type === "nonprofit_501c3") positives.push("restricted to nonprofits, which you are");
    else if (abroad && usSponsor && C3.test(elig)) blockers.push("requires 501(c)(3) status; open to you only through your US fiscal sponsor");
    else return null;                       // structurally impossible, not a "check"
  }
  if (GOV_ONLY.test(elig) && p.org_type !== "government" && p.org_type !== "tribal") return null;

  // ---- The hardened screen (patch 44; the feedback-loop session, 14 Nov). ----
  // Three rules EXCLUDE on unambiguous phrasing; the rest become NAMED
  // blockers that cap at "check", because a wrongly hidden grant is invisible
  // frustration while a wrongly surfaced one is visible frustration, and only
  // unambiguous text earns the invisible kind.

  // Individuals-only: an organization can never apply.
  if (p.applicant_type !== "individual" && INDIVIDUALS_ONLY.test(elig)) return null;
  // Current-grantees-only / renewal-only / by invitation: structurally closed to a newcomer.
  if (GRANTEES_ONLY.test(elig)) return null;

  // The geographic blocker, Shane's unacceptable case: restriction phrasing
  // naming states that do not include any of the client's. Softened phrasing
  // ("priority", "preference") and an unknown client state block instead of
  // excluding. Full state names only; bare codes collide with English.
  const clientStates = new Set([p.state_code, ...(p.service_area ?? [])].filter((x): x is string => !!x));
  const namedStates = statesNamed(elig);
  if (namedStates.length && GEO_RESTRICT.test(elig)) {
    const overlap = namedStates.some(c => clientStates.has(c));
    if (!overlap) {
      const where = namedStates.join(", ");
      // Patch 47: a client registered abroad has a known location, and it is
      // not a US state. "Location not on file" is only for a US client with no state.
      const located = clientStates.size > 0 || abroad;
      if (located && !GEO_SOFT.test(elig)) return null;   // restricted to states that are not yours
      blockers.push(clientStates.size
        ? `gives priority to ${where}; you are outside it`
        : abroad ? `gives priority to ${where}; you are registered in ${home}`
        : `appears restricted to ${where} and your location is not on file`);
    }
  }

  // ---- The international screen (patch 47; Shane, 15 Nov: hold for any
  // international client, starting with Africa). ----

  // US-only wording, for a client with no US entity. A US fiscal sponsor is a
  // real route, so it caps at "check" and says so instead of excluding.
  if (abroad && !usEntity && US_ONLY.test(elig)) {
    if (usSponsor) blockers.push("limited to US organizations; open to you only through your US fiscal sponsor");
    else if (GEO_SOFT.test(elig)) blockers.push(`gives priority to US organizations; you are registered in ${home}`);
    else return null;
  }
  // The country gate, for every client: a closed list of countries or regions
  // ("registered in Ghana, Kenya or Rwanda", "based in West Africa") that the
  // client is not in. Registration wording is answered by the country of
  // registration alone; presence and work wording by anywhere the client works.
  const outside = outsideRestriction(elig, p);
  if (outside) {
    if (!GEO_SOFT.test(elig)) return null;
    blockers.push(`gives priority to ${outside.label}; you are outside it`);
  }
  // The US database default: Ground Truth's base is US money. For a client
  // with no US entity and no US fiscal sponsor, a base record stays only when
  // its own text names a place the client works or says it funds beyond the
  // United States (the mirror of the EU rule in lib/open-data.ts). Records For
  // Granted reviewed (the overlay, curated lists) are never dropped by this:
  // a person already decided they belong.
  const fromBase = (g.source ?? "ledger") === "ledger" && !opts?.reviewed && !(g as { _overlay?: unknown })._overlay;
  if (abroad && !usEntity && !usSponsor && fromBase) {
    const said = `${title} ${elig} ${g.match_reason ?? ""}`;
    if (!placeNamed(said, p) && !BEYOND_US.test(said)) return null;
  }
  // County-level place restriction: resolve when we can, never claim when we cannot.
  const countyM = elig.match(COUNTY_RE);
  if (countyM) {
    const county = countyM[1];
    if (p.county && county.toLowerCase().includes(p.county.toLowerCase().replace(/\s*county\s*$/i, ""))) {
      positives.push(`names ${county} County, where you are`);
    } else {
      blockers.push(`appears restricted to ${county} County; check the boundary against where you work`);
    }
  }
  // Budget floors and ceilings against the profile's band.
  if (p.budget_band) {
    const [bandLo, bandHi] = BAND_RANGE[p.budget_band] ?? [0, Infinity];
    const min = moneyAfter(elig, BUDGET_MIN);
    if (min !== null && bandHi <= min) blockers.push(`requires an annual budget of at least $${min.toLocaleString("en-US")}; your profile says less`);
    const max = moneyAfter(elig, BUDGET_MAX);
    if (max !== null && bandLo >= max) blockers.push(`for organizations with budgets under $${max.toLocaleString("en-US")}; your profile says more`);
  }
  // Years in operation, once the profile (usually via the 990 import) knows the founding year.
  const yearsReq = yearsRequired(elig);
  if (yearsReq !== null && p.founded_year) {
    const age = today.getFullYear() - p.founded_year;
    if (age < yearsReq) blockers.push(`requires ${yearsReq} years of operating history; you are at about ${Math.max(0, age)}`);
  }
  // Audited financials: a months-long blocker, not a paperwork detail.
  if (AUDIT_REQ.test(elig) && p.audited_financials === false) {
    blockers.push("requires audited financial statements; your profile says you have none yet");
  }
  // Must-serve populations: eligibility wearing fit's clothes.
  const serveM = elig.match(MUST_SERVE);
  if (serveM) {
    const after = elig.slice((serveM.index ?? 0), (serveM.index ?? 0) + 120).toLowerCase();
    const served = (p.populations ?? []).find(x => x.length > 3 && after.includes(x.toLowerCase()));
    if (served) positives.push(`must-serve requirement matches your work with ${served}`);
    else blockers.push("requires primarily serving a named population; check that against who you serve");
  }

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
  // Abroad (patch 47): an NGO is invited by NGO words, never by "501(c)(3)";
  // a company also by the words funders use outside the US.
  const invite = abroad && !isNonprofit && p.org_type === "nonprofit_501c3" ? NGO_INVITE
    : p.org_type ? INVITES[p.org_type] : undefined;
  const invited = (!!invite && invite.test(elig)) || (abroad && p.org_type === "for_profit" && ENTERPRISE_INVITE.test(elig));
  if (invited) positives.push("eligibility text names your organization type");

  if (p.state_code && new RegExp(`\\b${p.state_code}\\b`).test(haystack)) {
    positives.push(`names ${p.state_code}`);
  }
  // A country or region the organization works in, named in the opportunity's
  // own text (international eligibility, 1 Nov 2026). The United States is left
  // out: nearly every US record names it, so it would say nothing.
  const placed = placeNamed(haystack, p);
  if (placed) positives.push(`names ${placed}`);
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
  // The missing-text cap (patch 44): with NO eligibility text the screen knows
  // nothing, and must never claim better than "check" off a title word. Short
  // text is still text: a real positive (the client's own state named) may
  // stand, and the screen_miss corpus will say if that is too generous.
  if (!elig.trim() && verdict !== "check") {
    verdict = "check";
    blockers.push("eligibility text not captured; needs a human read");
  }

  const reasons = [...blockers, ...positives];
  if (!reasons.length) reasons.push("topical alignment only; eligibility text needs a human read");

  // The watchlist rung (patch 26). Only clean fits make it: a closed call
  // that would already need a caveat while open is dropped, not watched, and
  // so is one with nothing going for it beyond topical similarity. The
  // watchlist is a promise about next year; it has to be earned.
  if (closed) {
    if (blockers.length || (!invited && !positives.length)) return null;
    verdict = "watch";
    reasons.unshift(`last cycle closed ${new Date(g.close_date!).toLocaleDateString("en-US")}; funders often run the same programme on a similar calendar each year`);
  }

  return {
    grant_id: id, title, verdict, reason: reasons.join("; "),
    close_date: g.close_date ?? null, award_ceiling: ceiling,
    funder: g.agency, source_site: g.source_site,
    website: g.website, eligibility: elig || undefined, caveat: g.caveat,
    money_kind: g.money_kind ?? "grants", currency: g.currency ?? null, source: g.source ?? "ledger",
  };
}



/** The first country or region of this profile that the text names, or null. */
export function placeNamed(text: string, p: EligibilityProfile): string | null {
  const countries = [...new Set([
    ...(isUsBased(p) ? [] : [p.country_code as string]),
    ...(p.countries_served ?? []),
  ])].filter(c => c && c !== "US");
  for (const c of countries) {
    if (textNames(text, countryNames(c))) return COUNTRY_NAME[c] ?? c;
  }
  for (const r of p.regions_served ?? []) {
    if (r === "north_america" || r === "global") continue;
    const hit = textNames(text, regionNames(r));
    if (hit) return hit.charAt(0).toUpperCase() + hit.slice(1);
  }
  return null;
}

/**
 * Drop rows that are the same opportunity twice.
 *
 * Ids are already unique by the time screening runs — qualifyGrantIds assigns
 * them before the merge so the merge key, the cached grant_id and the picker's
 * base_id are the same string. This is the safety net for the one case ids
 * alone cannot catch, and it no longer re-keys anything: re-keying here was
 * what put the stored id out of step with the key corrections were filed
 * against.
 */
export function dedupeScreened(list: ScreenedGrant[]): ScreenedGrant[] {
  const seen = new Set<string>();
  const out: ScreenedGrant[] = [];
  for (const g of list) {
    if (seen.has(g.grant_id)) continue;
    seen.add(g.grant_id);
    out.push(g);
  }
  return out;
}
