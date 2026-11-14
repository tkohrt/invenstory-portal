import { describe, it, expect } from "vitest";
import { parse990PFGrants, grantStats, recipientNorm, rateSentence } from "@/lib/irs990-grants";

const XML_2024 = `<Return><ReturnData><IRS990PF>
<SupplementaryInformationGrp>
<GrantOrContributionPdDurYrGrp>
  <RecipientBusinessName><BusinessNameLine1Txt>The Example Fund, Inc.</BusinessNameLine1Txt></RecipientBusinessName>
  <RecipientUSAddress><CityNm>Cleveland</CityNm><StateAbbreviationCd>OH</StateAbbreviationCd></RecipientUSAddress>
  <GrantOrContributionPurposeTxt>General operating support &amp; youth programs</GrantOrContributionPurposeTxt>
  <Amt>50000</Amt>
</GrantOrContributionPdDurYrGrp>
<GrantOrContributionPdDurYrGrp>
  <RecipientBusinessName><BusinessNameLine1Txt>New Horizons Collective</BusinessNameLine1Txt></RecipientBusinessName>
  <RecipientUSAddress><StateAbbreviationCd>NY</StateAbbreviationCd></RecipientUSAddress>
  <Amt>10000</Amt>
</GrantOrContributionPdDurYrGrp>
<GrantOrContributionPdDurYrGrp>
  <RecipientPersonNm>Jane Scholar</RecipientPersonNm>
  <Amt>5000</Amt>
</GrantOrContributionPdDurYrGrp>
</SupplementaryInformationGrp>
</IRS990PF></ReturnData></Return>`;

const XML_2023 = `<Return>
<GrantOrContriPaidDurYear>
  <RecipientBusinessName><BusinessNameLine1>EXAMPLE FUND INC</BusinessNameLine1></RecipientBusinessName>
  <Amount>45000</Amount>
</GrantOrContriPaidDurYear>
<GrantOrContriPaidDurYear>
  <RecipientBusinessName><BusinessNameLine1>Old Guard Society</BusinessNameLine1></RecipientBusinessName>
  <Amount>20000</Amount>
</GrantOrContriPaidDurYear>
</Return>`;

describe("parse990PFGrants", () => {
  it("reads the modern schema: names, amounts, purpose, state", () => {
    const g = parse990PFGrants(XML_2024);
    expect(g).toHaveLength(3);
    expect(g[0].recipient).toBe("The Example Fund, Inc.");
    expect(g[0].amount).toBe(50_000);
    expect(g[0].purpose).toContain("youth programs");
    expect(g[0].recipient_state).toBe("OH");
    expect(g[2].recipient).toBe("Jane Scholar");
  });
  it("reads the older vintage's names", () => {
    const g = parse990PFGrants(XML_2023);
    expect(g).toHaveLength(2);
    expect(g[0].amount).toBe(45_000);
  });
  it("returns empty on junk, never throws", () => {
    expect(parse990PFGrants("<html>not a filing</html>")).toEqual([]);
  });
});

describe("recipientNorm", () => {
  it("makes the same grantee one name across dress", () => {
    expect(recipientNorm("The Example Fund, Inc.")).toBe(recipientNorm("EXAMPLE FUND INC"));
  });
});

describe("grantStats", () => {
  const y2024 = parse990PFGrants(XML_2024);
  const y2023 = parse990PFGrants(XML_2023);
  it("computes count, total and median", () => {
    const s = grantStats(2024, y2024, null);
    expect(s.grants_count).toBe(3);
    expect(s.grants_total_usd).toBe(65_000);
    expect(s.typical_grant_usd).toBe(10_000);
    expect(s.new_grantee_rate).toBeNull();
  });
  it("the new-grantee rate compares normalized names across years", () => {
    const s = grantStats(2024, y2024, { year: 2023, grants: y2023 });
    // Example Fund repeats (dress differs); New Horizons and Jane Scholar are new: 2 of 3.
    expect(s.new_grantee_rate).toBe(67);
    expect(s.prior_year).toBe(2023);
  });
  it("rateSentence reads the number honestly", () => {
    const s = grantStats(2024, y2024, { year: 2023, grants: y2023 });
    expect(rateSentence(s)).toContain("67%");
    expect(rateSentence(grantStats(2024, y2024, null))).toBeNull();
  });
});
