/** One opportunity, one entry (patch 68): when two sightings are the same opportunity, and what changed between them. */
import { describe, expect, it } from "vitest";
import {
  oppHost, funderKey, titleParts, sameTitle, sameCycle, sameOrigin, sameOpportunity, findTwin,
  changedFacts, applyChanges, changeLine, addSeen, MAX_SEEN,
} from "@/lib/opportunity";

describe("oppHost and funderKey", () => {
  it("reads the site from a link", () => {
    expect(oppHost("https://www.neh.gov/program/collections-stewardship#x")).toBe("neh.gov");
    expect(oppHost("HTTP://Kresge.org:443/a")).toBe("kresge.org");
    expect(oppHost("curated:abc:1:0")).toBeNull();
    expect(oppHost(null)).toBeNull();
  });
  it("keys a funder's name", () => {
    expect(funderKey("The Kresge Foundation")).toBe("kresgefoundation");
    expect(funderKey("Kresge  Foundation.")).toBe("kresgefoundation");
    expect(funderKey("  ")).toBeNull();
    expect(funderKey(null)).toBeNull();
  });
});

describe("sameTitle", () => {
  it("matches the cases the queue actually had", () => {
    expect(sameTitle("Techstars Boulder", "Techstars Boulder Accelerator")).toBe(true);
    expect(sameTitle("Collections Stewardship", "Collections Stewardship grant program")).toBe(true);
    expect(sameTitle("Y Combinator Winter 2027 Batch", "Y Combinator Winter 2027 batch application")).toBe(true);
  });
  it("allows a bare year on one side only", () => {
    expect(sameTitle("2027 Kresge Artist Fellowships", "Kresge Artist Fellowships")).toBe(true);
    expect(sameTitle("Kresge Artist Fellowships 2026", "Kresge Artist Fellowships 2027")).toBe(false);
  });
  it("keeps different programmes of one funder apart", () => {
    expect(sameTitle("Techstars Chicago", "Techstars Boston Accelerator")).toBe(false);
    expect(sameTitle("Techstars Healthcare Accelerator powered by Permanente Medicine", "Northwestern Medicine & Techstars Healthcare Accelerator")).toBe(false);
    expect(sameTitle("Landmarks of American History and Culture for Higher Education", "Landmarks of American History and Culture for K-12 Educators")).toBe(false);
  });
  it("keeps numbered rounds apart", () => {
    expect(sameTitle("Start-Up Chile BIG 13", "Start-Up Chile BIG 14")).toBe(false);
    expect(sameTitle("speedrun SR008 Residency", "speedrun SR009 Residency")).toBe(false);
  });
  it("never matches a title made only of generic words, or an empty one", () => {
    expect(sameTitle("Grant Program", "Grant Program")).toBe(false);
    expect(sameTitle("", "Techstars Boulder")).toBe(false);
    expect(sameTitle(null, null)).toBe(false);
  });
  it("splits words and numbers", () => {
    const p = titleParts("The 2027 Kresge Artist Fellowships (Round 3)");
    expect([...p.words].sort()).toEqual(["artist", "fellowships", "kresge", "round"]);
    expect([...p.numbers].sort()).toEqual(["2027", "3"]);
  });
});

describe("sameCycle and sameOrigin", () => {
  it("treats deadlines within 120 days, or a missing one, as the same round", () => {
    expect(sameCycle("2026-12-01", "2027-01-15")).toBe(true);
    expect(sameCycle("2026-12-01", null)).toBe(true);
    expect(sameCycle(null, null)).toBe(true);
    expect(sameCycle("2026-12-01", "2027-06-01")).toBe(false);
    expect(sameCycle("2026-12-01T23:59:00-05:00", "2026-12-02")).toBe(true);
  });
  it("needs the same site or the same funder", () => {
    const a = { title: "x", url: "https://www.neh.gov/a", funder: "NEH", close_date: null };
    expect(sameOrigin(a, { ...a, url: "https://neh.gov/b#c", funder: null })).toBe(true);
    expect(sameOrigin(a, { ...a, url: "https://news.example/x", funder: "neh" })).toBe(true);
    expect(sameOrigin(a, { ...a, url: "https://news.example/x", funder: "National Endowment for the Humanities" })).toBe(false);
    expect(sameOrigin({ ...a, url: null, funder: null }, { ...a, url: null, funder: null })).toBe(false);
  });
});

describe("sameOpportunity and findTwin", () => {
  const neh = { title: "Collections Stewardship", url: "https://www.neh.gov/program/collections-stewardship", funder: "National Endowment for the Humanities", close_date: "2027-01-14" };
  it("joins the same grant at two addresses on one site", () => {
    expect(sameOpportunity(neh, { ...neh, url: "https://www.neh.gov/program/collections-stewardship#collections-stewardship-2026", close_date: null })).toBe(true);
  });
  it("joins a news item to the funder's own page by the funder's name", () => {
    expect(sameOpportunity(neh, { ...neh, url: "https://insidephilanthropy.com/x", title: "Collections Stewardship grants" })).toBe(true);
  });
  it("does not join next year's round", () => {
    expect(sameOpportunity(neh, { ...neh, close_date: "2028-01-14" })).toBe(false);
  });
  it("does not join across sites and funders", () => {
    expect(sameOpportunity(neh, { ...neh, url: "https://other.example/a", funder: "Someone Else" })).toBe(false);
  });
  it("meets a person's decision first when several entries match", () => {
    const row = (id: string, status: string, created_at: string) => ({ ...neh, id, status, created_at });
    const onFile = [row("p", "proposed", "2026-11-01"), row("a", "approved", "2026-11-02"), row("r", "rejected", "2026-11-03"), row("s", "superseded", "2026-10-01")];
    expect(findTwin(neh, onFile)?.id).toBe("r");
    expect(findTwin(neh, onFile.filter(e => e.id !== "r"))?.id).toBe("a");
    expect(findTwin(neh, [row("p2", "proposed", "2026-11-05"), row("p1", "proposed", "2026-11-01")])?.id).toBe("p1");
    expect(findTwin(neh, [row("s", "superseded", "2026-10-01")])).toBeNull();
    expect(findTwin({ ...neh, title: "Something else entirely" }, onFile)).toBeNull();
  });
});

describe("changedFacts", () => {
  it("reports only facts the later sighting states differently", () => {
    const was = { close_date: "2026-12-01", max_award: 50000, notes: "x" };
    expect(changedFacts(was, { close_date: "2027-01-15", max_award: 50000 }).map(changeLine)).toEqual(["Deadline was 2026-12-01, now 2027-01-15"]);
    expect(changedFacts(was, { max_award: 75000 }).map(changeLine)).toEqual(["Largest award was $50,000, now $75,000"]);
  });
  it("never treats silence as a change", () => {
    expect(changedFacts({ close_date: "2026-12-01", max_award: 50000 }, { close_date: null, title: "T" })).toEqual([]);
    expect(changedFacts({ close_date: "2026-12-01" }, {})).toEqual([]);
    expect(changedFacts({ close_date: "2026-12-01" }, null)).toEqual([]);
  });
  it("reports a fact that was not on file", () => {
    expect(changedFacts({}, { close_date: "2027-01-15" }).map(changeLine)).toEqual(["Deadline now 2027-01-15 (none on file)"]);
  });
  it("ignores case and spacing in terms", () => {
    expect(changedFacts({ investment_terms: "$120k for 6%" }, { investment_terms: " $120K for 6% " })).toEqual([]);
  });
  it("lays the changes over what is on file and keeps the rest", () => {
    expect(applyChanges({ title: "T", close_date: "2026-12-01", notes: "kept" }, { title: "Other", close_date: "2027-01-15", notes: "dropped" }))
      .toEqual({ title: "T", close_date: "2027-01-15", notes: "kept" });
  });
});

describe("addSeen", () => {
  const s = (url: string) => ({ url, source: "NEH", at: "2026-11-19T12:00:00Z" });
  it("adds a new address once", () => {
    const one = addSeen([], s("https://a.example/1"));
    expect(one).toHaveLength(1);
    expect(addSeen(one, s("https://a.example/1"))).toHaveLength(1);
    expect(addSeen(one, s("https://a.example/2"))).toHaveLength(2);
  });
  it("skips the entry's own address and anything that is not a web address", () => {
    expect(addSeen([], s("https://a.example/1"), "https://a.example/1")).toEqual([]);
    expect(addSeen([], s("curated:x"))).toEqual([]);
  });
  it("keeps the newest and tolerates junk on file", () => {
    let list: unknown = "junk";
    for (let i = 0; i < MAX_SEEN + 5; i++) list = addSeen(list, s(`https://a.example/${i}`));
    expect(list as unknown[]).toHaveLength(MAX_SEEN);
    expect((list as { url: string }[])[MAX_SEEN - 1].url).toBe(`https://a.example/${MAX_SEEN + 4}`);
  });
});
