/** Sources for Funder Matches (patch 11 of the 1 Nov 2026 build). */
import { describe, expect, test } from "vitest";
import {
  SOURCES, resolveSources, planFromSources, canChange, summaryLine, lastRunBySource, runText, sourcesForKind,
  autoDecision, SOURCE_BY_ID,
} from "@/lib/sources";
import { planOpenSources } from "@/lib/open-data";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";

const kenyan: EligibilityProfile = {
  ...EMPTY_PROFILE, org_type: "for_profit", tax_status: "none", country_code: "KE",
  countries_served: ["UG"], cause_areas: ["technical assistance"], funding_kinds: ["grants", "contracts"],
};
const ohio: EligibilityProfile = { ...EMPTY_PROFILE, org_type: "nonprofit_501c3", state_code: "OH", cause_areas: ["youth"] };
const get = (states: ReturnType<typeof resolveSources>, id: string) => states.find(s => s.id === id)!;

describe("the source list", () => {
  test("every source has a name, a sentence and no em dash", () => {
    for (const s of SOURCES) {
      expect(s.name).toBeTruthy();
      expect(s.what).toMatch(/\.$/);
      expect(s.what + s.name).not.toMatch(/—/);
    }
  });
  test("Ground Truth is always searched and cannot be changed", () => {
    const st = get(resolveSources(ohio, { ledger: { mode: "off", locked: false, setByRole: "admin" } } as never), "ledger");
    expect(st.on).toBe(true);
    expect(canChange(st, { role: "admin", preview: false, selfSearch: true })).toBe(false);
  });
});

describe("Automatic follows Funding Eligibility", () => {
  test("a US-only client searches Ground Truth and the web, nothing public", () => {
    const states = resolveSources(ohio, {});
    expect(states.filter(s => s.on).map(s => s.id).sort()).toEqual(["ledger", "web"]);
    expect(get(states, "worldbank").why).toMatch(/US only/);
  });
  test("a Kenyan grants and contracts client searches everything that fits", () => {
    const on = resolveSources(kenyan, {}).filter(s => s.on).map(s => s.id).sort();
    expect(on).toEqual(["canada", "eu_ft", "iati", "ledger", "threesixty", "web", "worldbank"]);
  });
  test("a kind not sought turns its source off, and says which kind", () => {
    const st = get(resolveSources({ ...kenyan, funding_kinds: ["grants"] }, {}), "worldbank");
    expect(st.on).toBe(false);
    expect(st.why).toBe("Off because you are not looking for contracts and RFPs.");
  });
  test("the reason names what is sought", () => {
    expect(autoDecision(SOURCE_BY_ID.eu_ft, kenyan).why).toBe("On because you are looking for grants and contracts and RFPs outside the US.");
    expect(autoDecision(SOURCE_BY_ID.iati, { ...kenyan, funding_kinds: ["contracts"] }).why)
      .toBe("Off because you are not looking for grants or accelerators, prizes and competitions.");
    expect(autoDecision(SOURCE_BY_ID.canada, kenyan).why).toBe("On because you are looking for grants outside the US.");
  });
});

describe("choices", () => {
  test("Off by For Granted wins over Automatic, and says whose", () => {
    const st = get(resolveSources(kenyan, { worldbank: { mode: "off", locked: true, setByRole: "admin" } }, {}, "client"), "worldbank");
    expect(st.on).toBe(false);
    expect(st.why).toBe("Turned off by For Granted and locked.");
    expect(canChange(st, { role: "client", preview: false, selfSearch: true })).toBe(false);
    expect(canChange(st, { role: "admin", preview: false, selfSearch: false })).toBe(true);
  });
  test("a client changes only with self-service on, and never in preview", () => {
    const st = get(resolveSources(kenyan, {}), "eu_ft");
    expect(canChange(st, { role: "client", preview: false, selfSearch: false })).toBe(false);
    expect(canChange(st, { role: "client", preview: false, selfSearch: true })).toBe(true);
    expect(canChange(st, { role: "admin", preview: true, selfSearch: true })).toBe(false);
  });
  test("On for a US-only client runs the World Bank globally", () => {
    const states = resolveSources(ohio, { worldbank: { mode: "on", locked: false, setByRole: "client" } }, {}, "client");
    expect(get(states, "worldbank").on).toBe(true);
    expect(get(states, "worldbank").why).toBe("Turned on by you.");
    expect(planFromSources(ohio, states).worldbank).toEqual({ countries: [] });
  });
  test("a source that needs countries cannot run without them, even when turned on", () => {
    const st = get(resolveSources(ohio, { iati: { mode: "on", locked: false, setByRole: "admin" } }), "iati");
    expect(st.on).toBe(false);
    expect(st.unavailable).toMatch(/countries/);
  });
  test("360Giving is off while IATI is off", () => {
    const states = resolveSources(kenyan, { iati: { mode: "off", locked: false, setByRole: "admin" } });
    expect(get(states, "threesixty").on).toBe(false);
    expect(get(states, "threesixty").why).toBe("Needs International aid data (IATI), which is off.");
    expect(planFromSources(kenyan, states).threesixty).toBe(false);
  });
  test("a source with no key is unavailable whatever the choice", () => {
    const states = resolveSources(kenyan, { iati: { mode: "on", locked: false, setByRole: "admin" } }, { iati: "Not set up yet." });
    expect(get(states, "iati").on).toBe(false);
    expect(get(states, "iati").unavailable).toBe("Not set up yet.");
  });
});

describe("the plan", () => {
  test("all Automatic plans exactly what planOpenSources plans", () => {
    for (const p of [kenyan, ohio, { ...kenyan, funding_kinds: ["investment"] }]) {
      expect(planFromSources(p, resolveSources(p, {}))).toEqual(planOpenSources(p));
    }
  });
  test("EU turned on for an investment-only client asks for every call type", () => {
    const p = { ...kenyan, funding_kinds: ["investment"] };
    const states = resolveSources(p, { eu_ft: { mode: "on", locked: false, setByRole: "admin" } });
    expect(planFromSources(p, states).eu).toEqual({ types: ["0", "1", "2", "8"] });
  });
  test("summary counts what is searched", () => {
    expect(summaryLine(resolveSources(ohio, {}))).toBe("Searching 2 of 7 sources");
  });
});

describe("the last run", () => {
  test("adds up Ground Truth and keeps public notes, never query text", () => {
    const r = lastRunBySource([
      { track: "grants", text: "youth mentoring Ohio", ok: true, results: 10 },
      { track: "funders", text: "funders of youth", ok: true, results: 5 },
      { track: "open:iati", text: "aid to KE (did not answer in time)", ok: false, results: 0 },
      { track: "open:canada", text: "federal grants to KE", ok: true, results: 1 },
    ]);
    expect(r.ledger).toEqual({ ok: true, results: 15, note: null });
    expect(runText(r.iati)).toBe("Last run: did not answer in time.");
    expect(runText(r.canada)).toBe("1 result on the last run.");
    expect(runText(r.worldbank)).toBe("Not searched on the last run.");
  });
  test("a note naming a setting, or Ground Truth's query text, never reaches the panel", () => {
    const r = lastRunBySource([
      { track: "open:iati", text: "aid to KE (skipped: IATI_API_KEY is not set)", ok: false, results: 0 },
      { track: "grants", text: "youth mentoring (Ohio only)", ok: false, results: 0 },
    ]);
    expect(r.iati?.note).toBeNull();
    expect(r.ledger?.note).toBeNull();
    expect(runText(r.iati)).toBe("Did not answer on the last run.");
  });
  test("Funding Eligibility notes name the sources each kind switches on", () => {
    expect(sourcesForKind("contracts")).toEqual(["EU Funding & Tenders Portal", "World Bank procurement notices"]);
    expect(sourcesForKind("investment")).toEqual([]);
  });
});
