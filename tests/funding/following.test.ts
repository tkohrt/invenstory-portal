/** Following (patch 66): the shared list, its dates and its order. */
import { describe, expect, it } from "vitest";
import { dateState, followRow, groupFollowing, followingSummary, rfpSnapshot, type FollowItem } from "@/lib/following";

const NOW = new Date("2026-11-18T12:00:00Z");
const item = (o: Partial<FollowItem>): FollowItem => ({ kind: "grant", target_id: "g1", title: "Youth Fund", detail: {}, saved_at: "2026-11-10T00:00:00Z", ...o });

describe("a date's standing", () => {
  it("within two weeks is closing, with the days counted", () => {
    expect(dateState("2026-11-25T23:00:00Z", NOW)).toEqual({ state: "closing", when: "Closes in 7 days (Nov 25, 2026)" });
    expect(dateState("2026-11-19T10:00:00Z", NOW).when).toBe("Closes tomorrow");
    expect(dateState("2026-11-18T20:00:00Z", NOW).when).toBe("Closes today");
    expect(dateState("2026-11-18", NOW).when).toBe("Closes today");
  });
  it("further out is open; past is closed; none says so", () => {
    expect(dateState("2027-03-03", NOW)).toEqual({ state: "open", when: "Closes Mar 3, 2027" });
    expect(dateState("2026-10-01", NOW)).toEqual({ state: "closed", when: "Closed Oct 1, 2026" });
    expect(dateState(null, NOW)).toEqual({ state: "none", when: "No date listed" });
    expect(dateState("soon", NOW).state).toBe("none");
  });
  it("a reopened call says so, with or without its new date", () => {
    expect(dateState("2027-01-15", NOW, true)).toEqual({ state: "reopened", when: "Open again, closes Jan 15, 2027" });
    expect(dateState(null, NOW, true)).toEqual({ state: "reopened", when: "Open again" });
  });
});

describe("one followed item", () => {
  it("a funder links to its dossier and carries no date", () => {
    const r = followRow(item({ kind: "funder", target_id: "ein:34 1234567/x", title: "Cleveland Foundation", detail: { url: "https://www.clevelandfoundation.org" } }), NOW);
    expect(r).toMatchObject({ label: "Funder", href: "/funding/funder/ein%3A34%201234567%2Fx", url: "https://www.clevelandfoundation.org", date: null, state: "none", updates: true });
  });
  it("an accelerator is called one, and shows its terms", () => {
    const r = followRow(item({ title: "ERA", detail: { money_kind: "programs", terms: "$150,000 on a SAFE for 6% equity", close_date: "2027-01-10" } }), NOW);
    expect(r.label).toBe("Accelerator, prize or competition");
    expect(r.terms).toBe("$150,000 on a SAFE for 6% equity");
  });
  it("an RFP is called an RFP, from its agency", () => {
    const r = followRow(item({ kind: "rfp", title: "IT modernization support", detail: { funder: "Ohio DAS", close_date: "2026-12-05T17:00:00Z", money_kind: "contracts" } }), NOW);
    expect(r).toMatchObject({ label: "RFP", who: "Ohio DAS", state: "open" });
  });
  it("a reopened grant shows its new cycle's title, date and link", () => {
    const r = followRow(item({ detail: { close_date: "2026-06-01", url: "https://old.org/2026" }, reopened_at: "2026-11-16T00:00:00Z",
      reopened_detail: { title: "Youth Fund 2027", close_date: "2027-02-01", url: "https://new.org/2027" } }), NOW);
    expect(r).toMatchObject({ title: "Youth Fund 2027", state: "reopened", url: "https://new.org/2027", date: "2027-02-01" });
  });
  it("updates are on unless switched off, including on rows from before the switch existed", () => {
    expect(followRow(item({}), NOW).updates).toBe(true);
    expect(followRow(item({ updates: null }), NOW).updates).toBe(true);
    expect(followRow(item({ updates: false }), NOW).updates).toBe(false);
  });
  it("only a real web address is ever a link", () => {
    expect(followRow(item({ detail: { url: "javascript:alert(1)" } }), NOW).url).toBeNull();
    expect(followRow(item({ kind: "funder", detail: { url: "ftp://x.org" } }), NOW).url).toBeNull();
  });
});

describe("the page's order", () => {
  const list = [
    item({ target_id: "closed-old", title: "Closed in June", detail: { close_date: "2026-06-01" } }),
    item({ target_id: "closed-new", title: "Closed in October", detail: { close_date: "2026-10-20" } }),
    item({ target_id: "far", title: "Far off", detail: { close_date: "2027-04-01" } }),
    item({ target_id: "soon", title: "Soon", detail: { close_date: "2026-11-24" } }),
    item({ target_id: "undated", title: "Rolling" }),
    item({ target_id: "again", title: "Back", detail: { close_date: "2026-05-01" }, reopened_at: "2026-11-16T00:00:00Z", reopened_detail: { close_date: "2027-01-05" } }),
    item({ kind: "funder", target_id: "f2", title: "Kresge Foundation" }),
    item({ kind: "funder", target_id: "f1", title: "Cleveland Foundation" }),
  ];
  const g = groupFollowing(list, NOW);
  it("reopened first, then soonest deadline, undated after dated, closed last with the most recent first", () => {
    expect(g.opportunities.map(r => r.target_id)).toEqual(["again", "soon", "far", "undated", "closed-new", "closed-old"]);
  });
  it("funders by name", () => {
    expect(g.funders.map(r => r.title)).toEqual(["Cleveland Foundation", "Kresge Foundation"]);
  });
  it("the summary counts both groups and what is pressing", () => {
    expect(followingSummary(g)).toBe("2 funders and 6 opportunities, 2 needing attention in the next two weeks.");
    expect(followingSummary(groupFollowing([item({ kind: "funder" })], NOW))).toBe("1 funder and 0 opportunities.");
  });
});

describe("the snapshot kept for an RFP", () => {
  it("title, agency, due date and an https link; nothing of the scoring", () => {
    expect(rfpSnapshot({ title: " IT modernization support ", agency: "Ohio DAS", due_at: "2026-12-05T17:00:00Z", description_url: "https://sam.gov/opp/1" }))
      .toEqual({ title: "IT modernization support", detail: { funder: "Ohio DAS", url: "https://sam.gov/opp/1", close_date: "2026-12-05T17:00:00Z", money_kind: "contracts" } });
  });
  it("a missing notice or an unsafe link degrades plainly", () => {
    expect(rfpSnapshot(null)).toEqual({ title: "An RFP", detail: { funder: null, url: null, close_date: null, money_kind: "contracts" } });
    expect(rfpSnapshot({ title: "X", description_url: "http://insecure.example/x" }).detail.url).toBeNull();
  });
});
