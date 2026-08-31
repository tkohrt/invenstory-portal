/**
 * The service's real response shape, taken from live find_grants output. These
 * are the exact values that made a whole match run report success while saving
 * nothing: prose in close_date, and "$500,000" written to a bigint column.
 */
import { describe, expect, test } from "vitest";
import { normalizeGrant, parseMoney, parseCloseDate, screenGrant } from "@/lib/grant-screen";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";

const startup: EligibilityProfile = { ...EMPTY_PROFILE, org_type: "for_profit", state_code: "OH" };

describe("parseMoney", () => {
  test("handles the display strings the service returns", () => {
    expect(parseMoney("$500,000")).toBe(500000);
    expect(parseMoney("$88")).toBe(88);
    expect(parseMoney(25000)).toBe(25000);
  });
  test("never returns NaN", () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("not a number")).toBeNull();
  });
});

describe("parseCloseDate", () => {
  test("prose deadlines become null, not an invalid date", () => {
    expect(parseCloseDate("no deadline listed")).toBeNull();
    expect(parseCloseDate("rolling")).toBeNull();
    expect(parseCloseDate("")).toBeNull();
    expect(parseCloseDate(null)).toBeNull();
  });
  test("real dates survive verbatim", () => {
    expect(parseCloseDate("2027-05-25")).toBe("2027-05-25");
    expect(parseCloseDate("2029-01-19")).toBe("2029-01-19");
  });
});

describe("normalizeGrant", () => {
  // Verbatim from a live find_grants call.
  const raw = {
    title: "Examining the Impact of Artificial Intelligence (AI) on Healthcare Safety (R18)",
    source: "grants.gov",
    status: "open",
    award_floor: null,
    award_ceiling: "$500,000",
    close_date: "2027-05-25",
    eligibility_ai_extracted: "Other Eligible Applicants include the following: Faith-based or Community-based Organizations",
    link: "https://www.grants.gov/search-results-detail/355419",
    confidence: "moderate",
  };

  test("maps the real field names onto the screener's shape", () => {
    const g = normalizeGrant(raw);
    expect(g.eligibility).toContain("Eligible Applicants");   // was eligibility_ai_extracted
    expect(g.website).toBe(raw.link);                          // was link
    // Was `source`, which is the scrape origin. The R18 activity code resolves
    // this to NIH; grants.gov is where it was listed, kept separately.
    expect(g.agency).toBe("NIH");
    expect(g.source_site).toBe("grants.gov");
    expect(g.max_award).toBe(500000);                          // was "$500,000"
    expect(g.close_date).toBe("2027-05-25");
  });

  test("the prose-deadline card no longer carries an unstorable date", () => {
    const g = normalizeGrant({ title: "Node Health", close_date: "no deadline listed", link: "https://nodehealth.org" });
    expect(g.close_date).toBeUndefined();
    const s = screenGrant(g, startup, new Date("2026-08-31"));
    expect(s).not.toBeNull();
    expect(s!.close_date).toBeNull();      // null is storable; "no deadline listed" was not
  });

  test("the link becomes the identifier, so rows are stable across runs", () => {
    expect(normalizeGrant(raw).opportunity_number).toBe(raw.link);
  });

  test("eligibility text now actually reaches the screener", () => {
    const g = normalizeGrant({ ...raw, eligibility_ai_extracted: "Open to 501(c)(3) organizations only." });
    expect(screenGrant(g, startup, new Date("2026-08-31"))).toBeNull();   // startup is filtered out
  });
});

/**
 * `source` is where a record was scraped from, not who funds it. A live run put
 * "WWW.UAB.EDU/EYEDOC" in the funder column for America's Seed Fund, which is
 * an NSF programme. Showing a plausible-looking wrong funder is worse than
 * showing nothing.
 */
describe("funder resolution", () => {
  test("a scrape origin never becomes the funder", () => {
    const g = normalizeGrant({ title: "America's Seed Fund - NSF SBIR/STTR", source: "WWW.UAB.EDU/EYEDOC" });
    expect(g.agency).not.toMatch(/uab/i);
  });

  test("a federal agency named in the title is resolved", () => {
    expect(normalizeGrant({ title: "America's Seed Fund - NSF SBIR/STTR", source: "WWW.UAB.EDU/EYEDOC" }).agency).toBe("NSF");
    expect(normalizeGrant({ title: "NHLBI SBIR Phase IIB Bridge Awards", source: "grants.gov" }).agency).toBe("NHLBI (NIH)");
    expect(normalizeGrant({ title: "Systems-Based Approaches (R01 Clinical Trial Optional)", source: "grants.gov" }).agency).toBe("NIH");
  });

  test("the scrape origin is kept, separately, for display as 'listed on'", () => {
    const g = normalizeGrant({ title: "Emerging Tech Fund", source: "https://WWW.RIGHTPLACE.ORG" });
    expect(g.source_site).toBe("https://WWW.RIGHTPLACE.ORG");
    expect(g.agency).toBeUndefined();
  });

  test("a real organisation name in source is kept as the funder", () => {
    expect(normalizeGrant({ title: "Community Fund", source: "Cleveland Foundation" }).agency).toBe("Cleveland Foundation");
  });
});
