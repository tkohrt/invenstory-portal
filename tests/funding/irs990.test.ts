import { describe, it, expect } from "vitest";
import { cleanEin, parseProPublica, funderProfileFrom, summaryDocText, budgetBandFrom } from "@/lib/irs990";

const API = {
  organization: { name: "The Example Fund", ntee_code: "T20" },
  filings_with_data: [
    { tax_prd_yr: 2022, formtype: 2, totrevenue: 900_000, totfuncexpns: 700_000, totassetsend: 4_000_000, pdf_url: "https://x/2022.pdf" },
    { tax_prd_yr: 2024, formtype: 2, totrevenue: 1_200_000, totfuncexpns: 800_000, totassetsend: 5_000_000, grntspayableend: 650_000, pdf_url: "https://x/2024.pdf" },
  ],
  filings_without_data: [],
};

describe("cleanEin", () => {
  it("accepts nine digits in any dress, rejects the rest", () => {
    expect(cleanEin("34-1234567")).toBe("341234567");
    expect(cleanEin(" 341234567 ")).toBe("341234567");
    expect(cleanEin("12345")).toBeNull();
  });
});

describe("parseProPublica", () => {
  it("maps filings newest first with form names", () => {
    const org = parseProPublica(API, "341234567");
    expect(org?.name).toBe("The Example Fund");
    expect(org?.filings.map(f => f.year)).toEqual([2024, 2022]);
    expect(org?.filings[0].form).toBe("990-PF");
    expect(org?.filings[0].grants_paid).toBe(650_000);
    expect(org?.postcard_only).toBe(false);
  });

  it("marks a postcard-only filer and tolerates junk", () => {
    const org = parseProPublica({ organization: { name: "Tiny Org" }, filings_with_data: [], filings_without_data: [{ tax_prd_yr: 2025 }] }, "341234567");
    expect(org?.postcard_only).toBe(true);
    expect(parseProPublica({ nonsense: true }, "341234567")).toBeNull();
  });
});

describe("funderProfileFrom", () => {
  it("fills only what the latest filing states", () => {
    const org = parseProPublica(API, "341234567")!;
    expect(funderProfileFrom(org)).toEqual({ fy_year: 2024, assets_usd: 5_000_000, annual_giving_usd: 650_000 });
  });
});

describe("summaryDocText", () => {
  it("labels every figure with its filing year and links the filing", () => {
    const t = summaryDocText(parseProPublica(API, "341234567")!, "341234567");
    expect(t).toContain("filing year 2024");
    expect(t).toContain("https://x/2024.pdf");
    expect(t).toContain("not the current budget");
  });
  it("says the honest postcard line", () => {
    const org = parseProPublica({ organization: { name: "Tiny Org" }, filings_with_data: [], filings_without_data: [{}] }, "341234567")!;
    expect(summaryDocText(org, "341234567")).toContain("990-N e-postcard");
  });
});

describe("budgetBandFrom", () => {
  it("maps revenue to the eligibility bands", () => {
    expect(budgetBandFrom(80_000)?.band).toBe("lt_100k");
    expect(budgetBandFrom(1_200_000)?.band).toBe("1m_5m");
    expect(budgetBandFrom(50_000_000)?.band).toBe("gt_10m");
  });
});
