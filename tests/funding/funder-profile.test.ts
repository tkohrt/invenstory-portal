import { describe, it, expect } from "vitest";
import { mergeProfile, profileKey, provenanceLine, type FieldProvenance } from "@/lib/funder-profile";

const PROV: FieldProvenance = { how: "verification", source_url: "https://x.org/grants", at: "2026-11-13T12:00:00Z" };

describe("mergeProfile", () => {
  it("fills stated fields with provenance and leaves absent ones alone", () => {
    const r = mergeProfile({ programs: "Old Fund" }, { programs: { ...PROV, how: "manual" } },
      { giving_cycle: "LOIs each January", assets_usd: "$4,200,000" }, PROV);
    expect(r.changed.sort()).toEqual(["assets_usd", "giving_cycle"]);
    expect(r.fields.programs).toBe("Old Fund");
    expect(r.fields.assets_usd).toBe(4_200_000);
    expect(r.meta.giving_cycle).toEqual(PROV);
    expect((r.meta.programs as FieldProvenance).how).toBe("manual");
  });

  it("never blanks: empty and junk incoming values are ignored", () => {
    const r = mergeProfile({ geography: "Ohio" }, {}, { geography: "", assets_usd: "lots", fy_year: 1200 }, PROV);
    expect(r.changed).toEqual([]);
    expect(r.fields.geography).toBe("Ohio");
  });

  it("ignores keys outside the dictionary", () => {
    const r = mergeProfile({}, {}, { access_mode: "open", name: "X Fund", programs: "Youth Fund" }, PROV);
    expect(r.changed).toEqual(["programs"]);
    expect(r.fields.access_mode).toBeUndefined();
  });

  it("an unchanged value does not rewrite provenance", () => {
    const old: FieldProvenance = { how: "manual", source_url: null, at: "2026-01-01T00:00:00Z" };
    const r = mergeProfile({ giving_cycle: "rolling" }, { giving_cycle: old }, { giving_cycle: "rolling" }, PROV);
    expect(r.changed).toEqual([]);
    expect(r.meta.giving_cycle).toEqual(old);
  });
});

describe("profileKey", () => {
  it("prefers the normalized EIN, falls back to the funder id", () => {
    expect(profileKey("34-1234567", "led_1")).toBe("341234567");
    expect(profileKey(null, "led_1")).toBe("led_1");
  });
});

describe("provenanceLine", () => {
  it("names the path and the day", () => {
    expect(provenanceLine(PROV)).toContain("Confirmed by For Granted");
  });
});
