/**
 * Web discovery (patch 5 of the 1 Nov 2026 build): what is asked, what is kept,
 * what becomes a Ground Truth proposal and which clients an approved find reaches.
 */
import { describe, expect, test } from "vitest";
import {
  discoveryAngles, placePhrase, discoverUser, clientFacts, parseLeads, urlKey, groundLeads, overlayDraft,
  amountNumber, currencyOf, geographyCodes, additionFits, sourcesFrom, MAX_ANGLES, type Lead,
} from "@/lib/web-discovery";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";

const kenyan: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "for_profit", tax_status: "none", country_code: "KE", countries_served: ["UG"],
  regions_served: ["east_africa"], cause_areas: ["technical assistance", "investment readiness"], populations: ["small businesses"],
  funding_kinds: ["contracts", "programs", "grants"],
};
const ohio: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "nonprofit_501c3", tax_status: "501c3", state_code: "OH", cause_areas: ["youth mentoring"],
};
const TODAY = "2026-11-01";

describe("what is asked", () => {
  test("one question per kind sought, in order, plus funders when grants are wanted, capped", () => {
    const a = discoveryAngles(kenyan, "consulting firm", "technical assistance to incubators");
    expect(a.map(x => x.key)).toEqual(["contracts", "programs", "grants", "funders"]);
    expect(a.length).toBeLessThanOrEqual(MAX_ANGLES);
    expect(a[0].question).toContain("a consulting firm offering technical assistance to incubators could bid on in Kenya, Uganda and East Africa");
  });
  test("a profile that only wants grants asks about grants and funders", () => {
    expect(discoveryAngles(ohio, "", "").map(x => x.key)).toEqual(["grants", "funders"]);
    expect(placePhrase(ohio)).toBe(" in OH");
  });
  test("client facts go inside an untrusted fence", () => {
    const u = discoverUser(discoveryAngles(kenyan, "", "")[0], clientFacts(kenyan, "Berman Consulting", ["What they do: incubator support"]), TODAY);
    expect(u).toContain("Today is 2026-11-01.");
    const fenceStart = u.indexOf("CLIENT_CONTEXT");
    expect(fenceStart).toBeGreaterThan(-1);
    expect(u.indexOf("Berman Consulting")).toBeGreaterThan(fenceStart);
    expect(u).toContain('money_kind "contracts"');
  });
});

describe("reading the answer", () => {
  test("finds the JSON inside a fence or a sentence, and nothing in rubbish", () => {
    expect(parseLeads('Here you go:\n```json\n{"leads":[{"title":"A"}]}\n```')).toHaveLength(1);
    expect(parseLeads("no json at all")).toEqual([]);
    expect(parseLeads('{"leads": "nope"}')).toEqual([]);
  });
  test("one key per page, whatever the tracking and slashes", () => {
    expect(urlKey("https://www.Example.org/calls/2026/?utm_source=x&b=2&a=1#top"))
      .toBe("example.org/calls/2026?a=1&b=2");
    expect(urlKey("ftp://example.org/x")).toBeNull();
    expect(urlKey("not a url")).toBeNull();
  });
  test("pages from results and citations, once each", () => {
    const blocks = [
      { type: "server_tool_use" },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.org/x", title: "A", page_age: "1 day" }] },
      { type: "text", text: "...", citations: [{ type: "web_search_result_location", url: "https://a.org/x" }, { url: "https://b.org/y", title: "B" }] },
    ];
    expect(sourcesFrom(blocks).map(s => s.url)).toEqual(["https://a.org/x", "https://b.org/y"]);
  });
});

describe("groundLeads", () => {
  const sources = ["https://fund.example.org/calls/sme-2026", "https://www.other.org/"];
  test("keeps a page the search returned, flags one only on a returned site, drops the rest", () => {
    const leads = groundLeads([
      { title: "SME call", url: "https://fund.example.org/calls/sme-2026/", deadline: "2026-12-15" },
      { title: "Guessed page", url: "https://other.org/apply-now", deadline: null },
      { title: "Invented", url: "https://made-up.example.com/call" },
    ], sources, "grants", TODAY);
    expect(leads.map(l => [l.title, l.grounded])).toEqual([["SME call", "exact"], ["Guessed page", "site"]]);
  });
  test("drops past deadlines, reads rolling, and keeps the kind it was asked for", () => {
    const leads = groundLeads([
      { title: "Closed", url: "https://fund.example.org/calls/sme-2026", deadline: "2026-10-01" },
      { title: "Rolling", url: "https://other.org/", deadline: "rolling", money_kind: "lottery" },
    ], sources, "contracts", TODAY);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ title: "Rolling", rolling: true, deadline: null, money_kind: "contracts", kind: "opportunity" });
  });
  test("the funders question returns funders", () => {
    const [l] = groundLeads([{ title: "X Foundation", funder: "X Foundation", url: "https://other.org/" }], sources, "funders", TODAY);
    expect(l.kind).toBe("funder");
  });
  test("text a client reads carries no links of its own", () => {
    const [l] = groundLeads([{ title: "T", url: "https://other.org/", why: "See https://evil.example/x and www.evil.example now" }], sources, "grants", TODAY);
    expect(l.why).toBe("See and now");
  });
  test("a missing title or URL is nothing", () => {
    expect(groundLeads([{ url: "https://other.org/" }, { title: "No url" }], sources, "grants", TODAY)).toEqual([]);
  });
});

describe("as a Ground Truth proposal", () => {
  const lead: Lead = {
    kind: "opportunity", money_kind: "contracts", title: "TA for incubators", funder: "GIZ", url: "https://giz.de/call",
    url_key: "giz.de/call", deadline: "2026-12-01", rolling: false, amount: "EUR 250,000", geography: "Kenya and Uganda",
    eligibility: "Consulting firms", why: "They support incubators.", quote: "Deadline 1 December 2026", grounded: "exact",
  };
  test("an opportunity uses the record's own field names, so it screens once approved", () => {
    const d = overlayDraft(lead, ["technical assistance"]);
    expect(d.kind).toBe("grant");
    expect(d.fields).toMatchObject({
      title: "TA for incubators", agency: "GIZ", website: "https://giz.de/call", close_date: "2026-12-01",
      max_award: 250000, currency: "EUR", money_kind: "contracts", discovered_via: "web", geography: ["KE", "UG"],
    });
    expect(String(d.fields.notes)).toContain("They support incubators.");
  });
  test("a funder becomes a funder record", () => {
    const d = overlayDraft({ ...lead, kind: "funder", funder: "Mastercard Foundation", eligibility: "Invitation only" }, []);
    expect(d.kind).toBe("funder");
    expect(d.fields).toMatchObject({ name: "Mastercard Foundation", access_note: "Invitation only" });
  });
  test("amounts and currencies", () => {
    expect(amountNumber("Up to $50,000")).toBe(50000);
    expect(amountNumber("EUR 1.2 million")).toBe(1_200_000);
    expect(amountNumber("varies")).toBeNull();
    expect(currencyOf("KSh 2,000,000")).toBe("KES");
    expect(geographyCodes("East Africa, mainly Kenya")).toEqual(["KE", "region:east_africa"]);
  });
});

describe("additionFits: which clients an approved web find reaches", () => {
  const row = (fields: Record<string, unknown>, surfaced: string | null = "t-cary") => ({ surfaced_for_tenant: surfaced, fields });
  test("records a person entered are untouched", () => {
    expect(additionFits(row({ name: "Anything" }, null), "t-ohio", ohio)).toBe(true);
  });
  test("always reaches the client it was found for", () => {
    expect(additionFits(row({ discovered_via: "web", geography: ["KE"] }), "t-cary", kenyan)).toBe(true);
  });
  test("a Kenya tender does not reach an Ohio youth charity", () => {
    expect(additionFits(row({ discovered_via: "web", geography: ["KE"], topics: ["technical assistance"] }), "t-ohio", ohio)).toBe(false);
  });
  test("reaches another client in the same place with a shared cause word", () => {
    const other = { ...kenyan, cause_areas: ["technical assistance for farmers"] };
    expect(additionFits(row({ discovered_via: "web", geography: ["region:east_africa"], topics: ["technical assistance"] }), "t-other", other)).toBe(true);
  });
  test("same place but nothing in common is left out", () => {
    const other = { ...kenyan, cause_areas: ["maternal health"], populations: ["mothers"] };
    expect(additionFits(row({ discovered_via: "web", geography: ["KE"], topics: ["technical assistance"] }), "t-other", other)).toBe(false);
  });
});
