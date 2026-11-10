/**
 * Public international sources (patch 4 of the 1 Nov 2026 build). The World
 * Bank and EU decoders run against responses captured live on 1 November 2026.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  planOpenSources, searchPhrases, worldBankTerm, decodeWorldBank, decodeSedia, toGrantCard,
  keepForProfile, iatiQuery, decodeIatiFunders, iatiFunderRows, ukPeerIds, plainText, searchCountries,
  type OpenOpportunity,
} from "@/lib/open-data";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";
import { screenGrant } from "@/lib/grant-screen";

const fixture = (n: string) => JSON.parse(readFileSync(join(__dirname, "../fixtures/open-data", n), "utf8"));
const TODAY = new Date("2026-11-01T12:00:00Z");

const kenyan: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "for_profit", tax_status: "none", country_code: "KE",
  countries_served: ["UG"], cause_areas: ["technical assistance", "capacity building", "investment readiness"],
  funding_kinds: ["grants", "contracts"],
};
const ohio: EligibilityProfile = { ...EMPTY_PROFILE, org_type: "nonprofit_501c3", state_code: "OH", cause_areas: ["youth"] };

describe("planOpenSources", () => {
  test("a US-only profile searches none of them, so nothing changes for it", () => {
    expect(planOpenSources(ohio)).toEqual({ worldbank: null, eu: null, iati: null, threesixty: false, canada: null });
  });
  test("contracts bring World Bank notices for each country named, and EU tenders", () => {
    const plan = planOpenSources(kenyan);
    expect(plan.worldbank).toEqual({ countries: ["KE", "UG"] });
    expect(plan.eu?.types).toEqual(["0", "1", "2", "8"]);
    expect(plan.iati).toEqual({ countries: ["KE", "UG"] });
  });
  test("grants alone bring EU grants and IATI funders but no procurement", () => {
    const plan = planOpenSources({ ...kenyan, funding_kinds: ["grants"] });
    expect(plan.worldbank).toBeNull();
    expect(plan.eu?.types).toEqual(["1", "2", "8"]);
  });
  test("a stored investment choice (removed 9 Nov 2026) is ignored and reads as grants", () => {
    expect(planOpenSources({ ...kenyan, funding_kinds: ["investment"] }))
      .toEqual(planOpenSources({ ...kenyan, funding_kinds: ["grants"] }));
  });
  test("a region with no countries searches the region's members, capped", () => {
    expect(searchCountries({ ...ohio, international: true, regions_served: ["east_africa"] }, 3)).toEqual(["BI", "KM", "DJ"]);
  });
});

describe("search phrases", () => {
  test("short phrases from the cause areas, quoted and ORed for the World Bank", () => {
    const ph = searchPhrases({ ...kenyan, cause_areas: ["technical assistance", "a very long description of everything we do", "Capacity building", "capacity building"] });
    expect(ph).toEqual(["technical assistance", "Capacity building"]);
    expect(worldBankTerm(ph)).toBe('"technical assistance" OR "Capacity building"');
  });
});

describe("decodeWorldBank (live response, Kenya)", () => {
  const rows = decodeWorldBank(fixture("worldbank-kenya.json"), TODAY);
  test("keeps open notices with their deadline, buyer and a working link", () => {
    expect(rows.length).toBeGreaterThan(0);
    const r = rows.find(x => x.id === "wb:OP00478446")!;
    expect(r.close_date).toBe("2026-12-02");
    expect(r.funder).toBe("Ministry of Transport and Infrastructure (World Bank financed)");
    expect(r.url).toBe("https://projects.worldbank.org/en/projects-operations/procurement-detail/OP00478446");
    expect(r.money_kind).toBe("contracts");
    expect(r.countries).toEqual(["KE"]);
    expect(r.text).toContain("Country: Kenya");
    expect(r.text).not.toMatch(/<[a-z]/i);
  });
  test("drops contract awards, past deadlines and stale undated notices", () => {
    const synthetic = { procnotices: [
      { id: "A1", notice_type: "Contract Award", submission_deadline_date: "2026-12-30T00:00:00Z", bid_description: "x" },
      { id: "A2", notice_type: "Invitation for Bids", submission_deadline_date: "2026-10-01T00:00:00Z", bid_description: "x" },
      { id: "A3", notice_type: "Request for Expression of Interest", submission_date: "2026-05-01T00:00:00Z", bid_description: "x" },
      { id: "A4", notice_type: "Request for Expression of Interest", submission_date: "2026-10-20T00:00:00Z", bid_description: "kept" },
    ] };
    expect(decodeWorldBank(synthetic, TODAY).map(r => r.id)).toEqual(["wb:A4"]);
  });
  test("anything that is not the expected shape is nothing, not an error", () => {
    expect(decodeWorldBank(null)).toEqual([]);
    expect(decodeWorldBank({ procnotices: "no" })).toEqual([]);
  });
});

describe("decodeSedia (live response, mixed types)", () => {
  const rows = decodeSedia(fixture("sedia-mixed.json"), TODAY);
  test("keeps only calls whose own deadline is still ahead, whatever the index says", () => {
    expect(rows.every(r => (r.close_date ?? "") >= "2026-11-01")).toBe(true);
    expect(rows.map(r => r.id).some(id => id.startsWith("eu:1:"))).toBe(false);   // 2023 topics marked open
  });
  test("a EuropeAid call and an EU cascade call come through with their budget in euros", () => {
    const aid = rows.find(r => r.id.startsWith("eu:2:"))!;
    expect(aid.funder).toBe("European Commission (International Partnerships)");
    expect(aid.award).toBe(1_300_000);
    expect(aid.currency).toBe("EUR");
    const cascade = rows.find(r => r.id.startsWith("eu:8:"))!;
    expect(cascade.funder).toContain("EU cascade funding");
    expect(cascade.url.startsWith("https://ec.europa.eu/")).toBe(true);
  });
  test("a grant topic links to its page, not its JSON file", () => {
    const fake = { results: [{ url: "https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/X-1.json",
      metadata: { type: ["1"], title: ["T"], identifier: ["X-1"], deadlineDate: ["2027-01-01T17:00:00.000+0000"] } }] };
    expect(decodeSedia(fake, TODAY)[0].url).toBe("https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/X-1");
  });
});

describe("keepForProfile", () => {
  const eu = (text: string): OpenOpportunity => ({ id: "eu:1:x", source: "eu_ft", title: "Call", funder: "European Commission", url: "https://ec.europa.eu/x", close_date: "2027-01-01", award: null, currency: null, text, countries: [], money_kind: "grants" });
  test("an EU call for European consortia is not shown to a Nairobi consultancy", () => {
    expect(keepForProfile(eu("Horizon topic for consortia in Member States"), kenyan)).toBe(false);
  });
  test("it is shown when it names their country, Africa, or partner countries", () => {
    expect(keepForProfile(eu("Support to SMEs in Kenya"), kenyan)).toBe(true);
    expect(keepForProfile(eu("Open to organisations in third countries"), kenyan)).toBe(true);
    expect(keepForProfile(eu("EU-Africa business forum"), kenyan)).toBe(true);
  });
  test("a client in Europe sees every EU call", () => {
    expect(keepForProfile(eu("Horizon topic for consortia in Member States"), { ...kenyan, country_code: "DE" })).toBe(true);
  });
});

describe("into the screen", () => {
  test("a World Bank notice in Kenya is screened like any other record, and names Kenya", () => {
    const wb = decodeWorldBank(fixture("worldbank-kenya.json"), TODAY).find(x => x.id === "wb:OP00478446")!;
    const card = toGrantCard(wb);
    expect(card.opportunity_number).toBe("wb:OP00478446");
    const s = screenGrant({ ...card }, kenyan, TODAY)!;
    expect(s.source).toBe("worldbank");
    expect(s.money_kind).toBe("contracts");
    expect(s.reason).toContain("names Kenya");
  });
  test("a Ground Truth record keeps reading as a dollar grant", () => {
    const s = screenGrant({ title: "Youth grant", close_date: "2026-12-01" }, ohio, TODAY)!;
    expect([s.source, s.money_kind, s.currency]).toEqual(["ledger", "grants", null]);
  });
});

describe("IATI", () => {
  test("the query names the countries, running and planned activities, and the phrases", () => {
    expect(iatiQuery(["ke", "UG"], ['capacity "building"'])).toBe(
      'recipient_country_code:(KE OR UG) AND activity_status_code:(1 OR 2) AND (title_narrative:"capacity  building" OR description_narrative:"capacity  building")');
  });
  test("funders are the role-1 participants, counted across activities", () => {
    const json = { response: { docs: [
      { title_narrative: ["Market systems in Kenya"], activity_date_iso_date: ["2025-04-01"], recipient_country_code: ["KE"],
        participating_org_narrative: ["FCDO", "Practical Action"], participating_org_role: ["1", "4"], participating_org_ref: ["GB-GOV-1", "GB-CHC-1"] },
      { title_narrative: ["SME finance"], recipient_country_code: ["UG"],
        participating_org_narrative: ["FCDO"], participating_org_role: ["1"], participating_org_ref: ["GB-GOV-1"] },
      { title_narrative: ["Own programme"], recipient_country_code: ["KE"], reporting_org_narrative: ["Mastercard Foundation"], reporting_org_ref: "CA-CRA-1" },
    ] } };
    const f = decodeIatiFunders(json);
    expect(f.map(x => [x.name, x.activity_count])).toEqual([["FCDO", 2], ["Mastercard Foundation", 1]]);
    expect(f[0].countries).toEqual(["KE", "UG"]);
    const rows = iatiFunderRows(f);
    expect(rows[0].funder_id).toBe("iati:gb-gov-1");
    expect(rows[0].match_reason).toContain("2 running activities in Kenya, Uganda");
    expect(rows[0].access_mode).toBe("unknown");
    expect(rows[0].source).toBe("iati");
  });
  test("an unexpected answer is no funders", () => {
    expect(decodeIatiFunders({})).toEqual([]);
  });
  test("implementers become the funder's peers, and planned activities are kept apart (patch 8)", () => {
    const json = { response: { docs: [
      { title_narrative: ["Youth enterprise Kenya"], activity_status_code: ["2"], recipient_country_code: ["KE"],
        participating_org_narrative: ["FCDO", "Practical Action", "FCDO"], participating_org_role: ["1", "4", "4"], participating_org_ref: ["GB-GOV-1", "GB-CHC-247257", "GB-GOV-1"] },
      { title_narrative: ["Incubator support facility"], activity_status_code: "1", activity_date_iso_date: ["2027-03-01"], recipient_country_code: ["KE"],
        participating_org_narrative: ["FCDO", "Kenya Climate Innovation Center"], participating_org_role: ["1", "4"], participating_org_ref: ["GB-GOV-1", ""] },
    ] } };
    const [f] = decodeIatiFunders(json);
    expect(f.peers.map(p => p.name)).toEqual(["Practical Action", "Kenya Climate Innovation Center"]);
    expect(f.planned).toEqual([{ title: "Incubator support facility", year: "2027" }]);
    expect(f.activities.map(a => a.title)).toEqual(["Youth enterprise Kenya"]);
    expect(ukPeerIds([f])).toEqual(["GB-CHC-247257"]);
    const [row] = iatiFunderRows([f]);
    expect(row.from_graph).toBe(true);
    expect(row.evidence.map(e => e.name)).toEqual(["Practical Action", "Kenya Climate Innovation Center"]);
    expect(row.match_reason).toContain("1 running activity in Kenya");
    expect(row.match_reason).toContain('planning 1 more ("Incubator support facility", 2027)');
  });
});

test("plainText strips tags and decodes entities", () => {
  expect(plainText("<p><strong>A&nbsp;&amp;&#39;B</strong></p><script>x</script>")).toBe("A &'B");
});
