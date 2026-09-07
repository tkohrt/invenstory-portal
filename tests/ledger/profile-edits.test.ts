import { describe, it, expect } from "vitest";
import {
  applyProfileEdits, factId, grantQueries, GRANT_FACETS, usableFacts,
  type ProfileEdit, type ProfileFact, type SearchProfile,
} from "@/lib/search-profile";
import type { EligibilityProfile } from "@/lib/eligibility-fields";

const fact = (over: Partial<ProfileFact> = {}): ProfileFact => ({
  facet: "evidence", text: "mentored and advised hundreds of companies",
  quote: "I've mentored and advised hundreds and hundreds of companies",
  documentId: "doc-3", documentTitle: "Ashley Intro Call", layer: "III",
  subject: "organization", ...over,
});

const profile = (facts: ProfileFact[]): SearchProfile =>
  ({ facts, generatedAt: "", documentCount: 3, layers: ["III"] });

const elig = { org_type: "for_profit", state_code: "OH", cause_areas: ["health"] } as unknown as EligibilityProfile;

describe("factId", () => {
  it("is stable across a rebuild, because document, facet and quote are", () => {
    expect(factId(fact())).toBe(factId(fact()));
  });

  it("survives the CLAUSE being reworded by a later extraction", () => {
    // The judgment was passed on the underlying quote, not on the phrasing.
    expect(factId(fact())).toBe(factId(fact({ text: "advised many companies" })));
  });

  it("differs when the quote, the facet or the document differs", () => {
    const base = factId(fact());
    expect(factId(fact({ quote: "something else" }))).not.toBe(base);
    expect(factId(fact({ facet: "work" }))).not.toBe(base);
    expect(factId(fact({ documentId: "doc-9" }))).not.toBe(base);
  });
});

describe("applyProfileEdits", () => {
  it("a hidden line reaches no query at all", () => {
    const f = fact();
    const edits: ProfileEdit[] = [{ factId: factId(f), kind: "hide", text: null, facet: null, note: null }];
    const merged = applyProfileEdits([f, fact({ facet: "work", text: "care coordination platform", quote: "q2" })], edits);
    expect(merged.map(x => x.text)).not.toContain(f.text);
    // Not shown struck through and searched on anyway: gone from the source
    // the query builder reads.
    const qs = grantQueries(profile(merged), elig, "RE-Assist");
    expect(qs.join(" ")).not.toContain("hundreds of companies");
  });

  it("an edit replaces the clause and keeps the quote behind it", () => {
    const f = fact();
    const merged = applyProfileEdits([f], [
      { factId: factId(f), kind: "edit", text: "five-year hospital partnership", facet: "evidence", note: null },
    ]);
    expect(merged[0].text).toBe("five-year hospital partnership");
    expect(merged[0].quote).toBe(f.quote);
    expect(merged[0].origin).toBe("edited");
    expect(merged[0].originalText).toBe(f.text);
  });

  it("an added line goes to the front of its facet, so the query reaches it", () => {
    // The query builder takes the first few per facet. A line a person wrote
    // deliberately outranks anything the extractor ranked.
    const base = Array.from({ length: 5 }, (_, i) =>
      fact({ facet: "need", text: `extracted ${i}`, quote: `q${i}` }));
    const merged = applyProfileEdits(base, [
      { factId: "add-1", kind: "add", text: "two care coordinators in Cincinnati", facet: "need", note: null },
    ]);
    const needs = merged.filter(f => f.facet === "need");
    expect(needs[0].text).toBe("two care coordinators in Cincinnati");
    expect(grantQueries(profile(merged), elig, "RE-Assist").join(" "))
      .toContain("two care coordinators in Cincinnati");
  });

  it("an added line carries no quote and does not pretend to", () => {
    const merged = applyProfileEdits([], [
      { factId: "add-1", kind: "add", text: "a true thing", facet: "work", note: null },
    ]);
    expect(merged[0].quote).toBe("");
    expect(merged[0].origin).toBe("added");
    expect(merged[0].editId).toBe("add-1");
  });

  it("ignores an edit whose fact is gone, rather than resurrecting it", () => {
    const merged = applyProfileEdits([fact({ quote: "different" })], [
      { factId: "stale-id", kind: "edit", text: "x", facet: "work", note: null },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].origin).toBeUndefined();
  });

  it("keeps corrections working after a rebuild produces the same facts again", () => {
    const before = [fact()];
    const edits: ProfileEdit[] = [{ factId: factId(before[0]), kind: "hide", text: null, facet: null, note: null }];
    // A rebuild: same documents, same quotes, brand new array.
    const after = [fact()];
    expect(applyProfileEdits(after, edits)).toHaveLength(0);
  });

  it("does not let an added line bypass the subject quarantine", () => {
    const merged = applyProfileEdits([], [
      { factId: "add-1", kind: "add", text: "who they serve", facet: "beneficiaries", note: null },
    ]);
    // beneficiaries is excluded from GRANT_FACETS whoever wrote it.
    expect(usableFacts(profile(merged), GRANT_FACETS)).toHaveLength(0);
  });
});
