/**
 * The rules that decide what we say about a client when looking for money.
 *
 * The test that matters most is the quarantine one. A run for a healthtech
 * company returned patient-assistance funds and scholarships because the query
 * described who they serve. These pin the fix in code rather than in a prompt.
 */
import { describe, expect, test } from "vitest";
import {
  grantQueries, funderQueries, usableFacts, assessProfile, dedupeQueries,
  GRANT_FACETS, FUNDER_FACETS, type SearchProfile, type ProfileFact, type Facet,
} from "@/lib/search-profile";
import type { EligibilityProfile } from "@/lib/eligibility-fields";

const fact = (facet: Facet, text: string, o: Partial<ProfileFact> = {}): ProfileFact => ({
  facet, text, quote: `verbatim: ${text}`, documentId: "d1",
  documentTitle: "Strategic Plan 2026", layer: "II", subject: "organization", ...o,
});

const profile = (facts: ProfileFact[]): SearchProfile => ({
  facts, generatedAt: "2026-09-06T00:00:00Z", documentCount: 4, layers: ["I", "II", "III"],
});

const ELIG = {
  org_type: "for_profit", state_code: "OH", cause_areas: ["health"],
  populations: ["returning citizens"], service_area: ["Cuyahoga County"],
  budget_band: "100k_500k", federal_registration: "none", tax_status: null,
} as unknown as EligibilityProfile;

describe("subject quarantine", () => {
  test("a competitor's description never describes the client", () => {
    const p = profile([
      fact("work", "care coordination software"),
      fact("work", "a rival platform doing claims automation", { subject: "competitor" }),
    ]);
    const used = usableFacts(p, GRANT_FACETS).map(f => f.text);
    expect(used).toContain("care coordination software");
    expect(used).not.toContain("a rival platform doing claims automation");
  });

  test("a partner's programme never describes the client", () => {
    const p = profile([fact("work", "the hospital's discharge programme", { subject: "third_party" })]);
    expect(usableFacts(p, GRANT_FACETS)).toHaveLength(0);
  });
});

describe("grantQueries", () => {
  test("never describes who the client serves", () => {
    // The RE-Assist failure, pinned. Beneficiaries are excluded from GRANT
    // queries by construction, not by prompt wording.
    const p = profile([
      fact("identity", "healthtech company"),
      fact("beneficiaries", "low-income patients leaving incarceration"),
    ]);
    const qs = grantQueries(p, ELIG, "RE-Assist").join(" ").toLowerCase();
    expect(qs).toContain("healthtech");
    expect(qs).not.toContain("low-income patients");
    expect(GRANT_FACETS).not.toContain("beneficiaries");
  });

  test("leads with what they want funded when they have said it", () => {
    const p = profile([
      fact("identity", "healthtech company"),
      fact("need", "a clinical pilot of the discharge tool"),
    ]);
    const qs = grantQueries(p, ELIG, "RE-Assist");
    expect(qs.join(" ")).toContain("clinical pilot");
    expect(qs.length).toBeGreaterThan(1);   // several angles, not one blend
  });

  test("falls back to the eligibility profile when the Inven(s)tory says nothing", () => {
    const qs = grantQueries(profile([]), ELIG, "RE-Assist");
    expect(qs.length).toBeGreaterThan(0);
    expect(qs[0].toLowerCase()).toContain("for-profit");
  });

  test("evidence produces its own angle, for programmes wanting a track record", () => {
    const p = profile([
      fact("identity", "healthtech company"),
      fact("evidence", "readmissions down 22% across two hospital systems"),
    ]);
    expect(grantQueries(p, ELIG, "RE-Assist").some(q => q.includes("22%"))).toBe(true);
  });
});

describe("funderQueries", () => {
  test("DOES describe who they serve, because funders care", () => {
    // The asymmetry with grantQueries is the design, not an inconsistency.
    const p = profile([
      fact("identity", "healthtech company"),
      fact("beneficiaries", "people leaving incarceration"),
    ]);
    const qs = funderQueries(p, ELIG, "RE-Assist").join(" ");
    expect(qs).toContain("people leaving incarceration");
    expect(FUNDER_FACETS).toContain("beneficiaries");
  });

  test("uses stated geography over the profile's state code", () => {
    const p = profile([
      fact("identity", "nonprofit"),
      fact("geography", "Cuyahoga and Lorain counties"),
    ]);
    expect(funderQueries(p, ELIG, "Org").join(" ")).toContain("Cuyahoga and Lorain");
  });

  test("the two searches ask different questions", () => {
    const p = profile([
      fact("identity", "healthtech company"),
      fact("need", "a clinical pilot"),
      fact("beneficiaries", "returning citizens"),
    ]);
    expect(grantQueries(p, ELIG, "X").join(" ")).not.toBe(funderQueries(p, ELIG, "X").join(" "));
  });
});

describe("dedupeQueries", () => {
  test("three copies of one query is one query", () => {
    expect(dedupeQueries(["a nonprofit in Ohio", "A Nonprofit in Ohio!", "a nonprofit in Ohio"]))
      .toHaveLength(1);
  });
  test("fragments too short to retrieve anything are dropped", () => {
    expect(dedupeQueries(["health", "a healthtech company in Ohio"])).toHaveLength(1);
  });
});

describe("assessProfile", () => {
  test("no documents is not usable, and says why", () => {
    const h = assessProfile({ facts: [], generatedAt: "", documentCount: 0, layers: [] });
    expect(h.usable).toBe(false);
    expect(h.note).toContain("No documents");
  });

  test("documents that describe nothing about the org are not usable either", () => {
    // Four documents that are all about partners is a real case, and it should
    // not look like a working search.
    const p = profile([fact("work", "the hospital's programme", { subject: "third_party" })]);
    expect(assessProfile(p).usable).toBe(false);
  });

  test("a missing 'need' is usable but flagged, because it is the weaker search", () => {
    const p = profile([fact("identity", "nonprofit"), fact("work", "job training")]);
    const h = assessProfile(p);
    expect(h.usable).toBe(true);
    expect(h.missing).toContain("need");
    expect(h.note).toContain("what they want funded");
  });

  test("a complete profile reports what it was built from", () => {
    const p = profile([
      fact("identity", "nonprofit"), fact("work", "job training"),
      fact("need", "two more case managers"),
    ]);
    const h = assessProfile(p);
    expect(h.usable).toBe(true);
    expect(h.missing).toEqual([]);
    expect(h.note).toContain("4 document");
  });
});
